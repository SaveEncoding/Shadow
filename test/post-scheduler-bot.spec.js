import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createBot, executionCtxStorage } from '../src/telegram/bot.js';
import { postSchedulerFeature } from '../src/telegram/features/postScheduler.js';
import { getPost, getSourceRule } from '../src/telegram/db/postQueue.js';
import { CHANNEL_ADMINS_TABLE, CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';
import { getPollSource, listRulesForTarget } from '../src/telegram/db/postQueue.js';
import { publicSourceChannelId } from '../src/core/schedule/publicFeed.js';
import { feedPage } from './helpers/feedFixture.js';

/**
 * تست یکپارچه‌ی «بات واقعی + فیچر زمان‌بندی پست».
 *
 * مثل تست شطرنج، یک `Bot` واقعی grammY با شبکه‌ی قلابی می‌سازیم: middlewareها،
 * regex های callback_data و ترتیب ثبت‌ها همان چیزی است که در تولید اجرا می‌شود.
 */

const BOT_INFO = {
	id: 999,
	is_bot: true,
	first_name: 'Shadow',
	username: 'shadow_test_bot',
	can_join_groups: true,
	can_read_all_group_messages: false,
	supports_inline_queries: false,
};

const USER = { id: 777, is_bot: false, first_name: 'Ali', language_code: 'fa' };
const CHAT = { id: 777, type: 'private', first_name: 'Ali' };
const TARGET = -1001234567890;
const SOURCE = -1009876543210;

/** وضعیت بات در کانال‌ها؛ تست می‌تواند تغییرش دهد */
let memberStatus = 'administrator';
/** @type {Array<{ method: string, payload: any }>} */
let calls = [];
let editFails = false;

function fakeResult(method, payload) {
	switch (method) {
		case 'getMe':
			return BOT_INFO;
		case 'getChatMember':
			return { status: memberStatus, user: BOT_INFO, can_post_messages: true };
		case 'sendMessage':
			return { message_id: 50, date: 0, chat: { id: payload.chat_id, type: payload.chat_id === USER.id ? 'private' : 'channel' }, text: payload.text };
		case 'editMessageText':
			if (editFails) {
				const err = new Error('Bad Request: message to edit not found');
				err.error_code = 400;
				throw err;
			}
			return { message_id: 50, date: 0, chat: { id: 1, type: 'private' }, text: payload.text ?? '' };
		case 'sendChatAction':
		case 'answerCallbackQuery':
			return true;
		default:
			if (method.startsWith('send')) {
				return { message_id: 60, date: 0, chat: { id: payload.chat_id } };
			}
			return true;
	}
}

async function setupBot() {
	calls = [];
	const bot = createBot({ ...env, TELEGRAM_TOKEN: '123:test', TELEGRAM_WEBHOOK_SECRET: 'secret' });
	postSchedulerFeature(bot, env);
	bot.api.config.use((prev, method, payload) => {
		calls.push({ method, payload });
		try {
			return Promise.resolve({ ok: true, result: fakeResult(method, payload) });
		} catch (err) {
			return Promise.reject(err);
		}
	});
	await bot.init();
	calls = [];
	return bot;
}

let updateId = 1;

function messageUpdate(text, extra = {}) {
	return {
		update_id: updateId++,
		message: {
			message_id: 10,
			date: 1_700_000_000,
			chat: CHAT,
			from: USER,
			text,
			entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
			...extra,
		},
	};
}

/** فوروارد یک پست کانال به چت خصوصی بات */
function forwardedUpdate({ from = { id: SOURCE, title: 'کانال مبدأ', username: 'source_chan', type: 'channel' }, text = 'پست کانال', messageId = 101 } = {}) {
	return {
		update_id: updateId++,
		message: {
			message_id: messageId,
			date: 1_700_000_000,
			chat: CHAT,
			from: USER,
			text,
			forward_origin: {
				type: 'channel',
				date: 1_700_000_000,
				chat: from,
				message_id: messageId,
			},
		},
	};
}

function channelPostUpdate({ chatId = SOURCE, messageId = 500, text = 'خبر تازه' } = {}) {
	return {
		update_id: updateId++,
		channel_post: {
			message_id: messageId,
			date: 1_700_000_000,
			chat: { id: chatId, type: 'channel', title: 'کانال مبدأ', username: 'source_chan' },
			text,
		},
	};
}

function callbackUpdate(data, from = USER) {
	return {
		update_id: updateId++,
		callback_query: {
			id: String(updateId),
			from,
			chat_instance: 'ci',
			data,
			message: { message_id: 50, date: 1_700_000_000, chat: CHAT, text: 'previous' },
		},
	};
}

async function dispatch(bot, update) {
	const pending = [];
	await executionCtxStorage.run(
		{ waitUntil: (promise) => pending.push(promise), passThroughOnException: () => {} },
		() => bot.handleUpdate(update),
	);
	await Promise.all(pending);
}

const lastCall = (method) => [...calls].reverse().find((c) => c.method === method);
const allTexts = () =>
	calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => c.payload.text ?? '');
const lastScreenText = () => {
	const call = lastCall('editMessageText') ?? lastCall('sendMessage');
	return call?.payload.text ?? '';
};
const callbacksOf = (payload) => (payload?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
const lastCallbacks = () => callbacksOf(lastCall('editMessageText')?.payload ?? lastCall('sendMessage')?.payload);
const toasts = () =>
	calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.payload.text ?? '');
const channelMessages = () => calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === TARGET);

/** صفحه‌ی پیش‌نمایش وب؛ تست می‌تواند عوضش کند */
let feedHtml = '';
let fetchCalls = [];

function stubFeed(html) {
	feedHtml = html;
	vi.stubGlobal('fetch', async (url) => {
		fetchCalls.push(String(url));
		return new Response(feedHtml, { status: 200 });
	});
}

beforeAll(async () => {
	await createScheduleTables(env.my_database);
	await env.my_database.exec(CHANNELS_TABLE);
	await env.my_database.exec(CHANNEL_ADMINS_TABLE);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, last_name TEXT, language_code TEXT, role INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));',
	);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS user_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP));',
	);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
	await env.my_database.exec('DELETE FROM channels;');
	await env.my_database.exec('DELETE FROM channel_admins;');
	memberStatus = 'administrator';
	editFails = false;

	await env.my_database
		.prepare('INSERT INTO channels (channel_id, title, username) VALUES (?, ?, ?)')
		.bind(TARGET, 'کانال من', 'my_channel')
		.run();
	await env.my_database
		.prepare('INSERT INTO channel_admins (channel_id, user_id) VALUES (?, ?)')
		.bind(TARGET, USER.id)
		.run();

	fetchCalls = [];
	stubFeed(feedPage([{ channel: 'my_pub_chan', id: 5, html: 'آخرین پست' }]));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function addSourceRule() {
	const db = env.my_database;
	// از مسیر واقعی UI: انتخاب «افزودن منبع» و بعد فوروارد
	const bot = await setupBot();
	await dispatch(bot, callbackUpdate(`ps:src:${TARGET}`));
	await dispatch(bot, forwardedUpdate());
	return bot;
}

describe('screens', () => {
	it('/schedule shows the hub with a button per channel', async () => {
		const bot = await setupBot();
		await dispatch(bot, messageUpdate('/schedule'));

		expect(lastScreenText()).toContain('کانال من');
		expect(lastCallbacks()).toContain(`ps:c:${TARGET}`);
	});

	it('the hub explains what to do when there is no channel yet', async () => {
		await env.my_database.exec('DELETE FROM channel_admins;');
		const bot = await setupBot();
		await dispatch(bot, messageUpdate('/post'));

		expect(lastScreenText()).toContain('کانالی');
	});

	it('the channel page offers adding a source, a manual copy and the queue', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:c:${TARGET}`));

		const buttons = lastCallbacks();
		expect(buttons).toContain(`ps:src:${TARGET}`);
		expect(buttons).toContain(`ps:man:${TARGET}`);
		expect(buttons).toContain(`ps:q:${TARGET}`);
		expect(lastScreenText()).toContain('کانال من');
	});
});

describe('adding a source channel', () => {
	it('registers the source when a post of it is forwarded', async () => {
		const bot = await addSourceRule();

		const texts = allTexts();
		expect(texts.some((t) => t.includes('ثبت شد'))).toBe(true);

		const rule = await getSourceRule(env.my_database, SOURCE);
		expect(rule.targetChannelId).toBe(TARGET);
		expect(rule.sourceTitle).toBe('کانال مبدأ');
		expect(rule.sourceUsername).toBe('source_chan');
		expect(rule.notifyChatId).toBe(USER.id); // پیش‌نمایش به چت خصوصی سازنده
		expect(rule.delayMinutes).toBe(30);

		// بررسی ادمین‌بودن بات در کانال مبدأ انجام شده است
		const check = calls.find((c) => c.method === 'getChatMember');
		expect(check.payload.chat_id).toBe(SOURCE);
		expect(bot).toBeTruthy();
	});

	it('refuses a source channel where the bot is not an admin', async () => {
		memberStatus = 'member';
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:src:${TARGET}`));
		await dispatch(bot, forwardedUpdate());

		expect(allTexts().some((t) => t.includes('ادمین'))).toBe(true);
		expect(await getSourceRule(env.my_database, SOURCE)).toBeNull();
	});

	it('/cancel closes the waiting-for-forward session', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:src:${TARGET}`));
		await dispatch(bot, messageUpdate('/cancel'));

		expect(allTexts().some((t) => t.includes('لغو شد'))).toBe(true);

		// دیگر منتظر فوروارد نیستیم: فوروارد بعدی قانون نمی‌سازد
		await dispatch(bot, forwardedUpdate());
		expect(await getSourceRule(env.my_database, SOURCE)).toBeNull();
	});

	it('refuses a message that is not a forward from a channel', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:src:${TARGET}`));
		await dispatch(bot, messageUpdate('سلام، این فوروارد نیست'));

		expect(allTexts().some((t) => t.includes('فوروارد'))).toBe(true);
		expect(await getSourceRule(env.my_database, SOURCE)).toBeNull();
	});
});

describe('capturing channel posts', () => {
	it('queues a new post of the source channel and notifies the admin', async () => {
		const bot = await addSourceRule();
		calls = [];

		await dispatch(bot, channelPostUpdate({ text: 'خبر فوری' }));

		// اعلان صف به چت خصوصی ادمین
		const notice = calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === USER.id);
		expect(notice).toBeTruthy();
		expect(notice.payload.text).toContain('صف');
		expect(notice.payload.text).toContain('خبر فوری');

		// دکمه‌های ویرایش/انتشار/لغو روی همان پیام
		const buttons = callbacksOf(notice.payload);
		expect(buttons.some((b) => b.startsWith('ps:pub:'))).toBe(true);
		expect(buttons.some((b) => b.startsWith('ps:txt:'))).toBe(true);
		expect(buttons.some((b) => b.startsWith('ps:del:'))).toBe(true);

		// هنوز چیزی در کانال مقصد منتشر نشده است
		expect(channelMessages()).toHaveLength(0);
	});

	it('does not copy posts of an unknown channel', async () => {
		const bot = await setupBot();
		await dispatch(bot, channelPostUpdate({ chatId: -100555, text: 'از کانال دیگر' }));

		expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
	});
});

describe('editing before publish', () => {
	it('saves the edited text and publishes exactly that text', async () => {
		const bot = await addSourceRule();
		await dispatch(bot, channelPostUpdate({ text: 'متن اولیه' }));

		const post = (await env.my_database.prepare('SELECT id FROM post_queue ORDER BY id DESC LIMIT 1').first());
		const postId = Number(post.id);

		await dispatch(bot, callbackUpdate(`ps:txt:${postId}`));
		expect(lastScreenText()).toContain('متن جدید');

		await dispatch(bot, messageUpdate('متن ویرایش‌شده توسط ادمین'));

		const stored = await getPost(env.my_database, postId);
		expect(stored.edited).toBe(true);
		expect(stored.items[0].text).toBe('متن ویرایش‌شده توسط ادمین');

		// «انتشار الان»
		calls = [];
		await dispatch(bot, callbackUpdate(`ps:pub:${postId}`));

		const sent = channelMessages();
		expect(sent).toHaveLength(1);
		expect(sent[0].payload.text).toBe('متن ویرایش‌شده توسط ادمین');
		expect((await getPost(env.my_database, postId)).status).toBe('published');
	});

	it('/cancel leaves the edit session without touching the post', async () => {
		const bot = await addSourceRule();
		await dispatch(bot, channelPostUpdate({ text: 'متن اولیه' }));
		const postId = Number((await env.my_database.prepare('SELECT id FROM post_queue ORDER BY id DESC LIMIT 1').first()).id);

		await dispatch(bot, callbackUpdate(`ps:txt:${postId}`));
		await dispatch(bot, messageUpdate('/cancel'));

		const stored = await getPost(env.my_database, postId);
		expect(stored.items[0].text).toBe('متن اولیه');
		expect(stored.edited).toBe(false);
	});
});

describe('queue management', () => {
	async function queueOne() {
		const bot = await addSourceRule();
		await dispatch(bot, channelPostUpdate({ text: 'پست در صف' }));
		const postId = Number((await env.my_database.prepare('SELECT id FROM post_queue ORDER BY id DESC LIMIT 1').first()).id);
		return { bot, postId };
	}

	it('shows pending posts in the queue', async () => {
		const { bot } = await queueOne();
		await dispatch(bot, callbackUpdate(`ps:q:${TARGET}`));

		expect(lastScreenText()).toContain('پست در صف');
	});

	it('cancels a post so it is never published', async () => {
		const { bot, postId } = await queueOne();
		await dispatch(bot, callbackUpdate(`ps:del:${postId}`));

		expect((await getPost(env.my_database, postId)).status).toBe('canceled');
		expect(toasts().some((t) => t.includes('لغو'))).toBe(true);
	});

	it('reschedules a post with a preset delay', async () => {
		const { bot, postId } = await queueOne();
		const before = (await getPost(env.my_database, postId)).publishAt;

		await dispatch(bot, callbackUpdate(`ps:dp:p${postId}`));
		expect(lastCallbacks().some((b) => b.startsWith(`ps:ds:p${postId}:`))).toBe(true);

		await dispatch(bot, callbackUpdate(`ps:ds:p${postId}:180`));
		const after = await getPost(env.my_database, postId);
		expect(after.publishAt).toBeGreaterThan(before);
		expect(after.status).toBe('scheduled');
	});

	it('changes the delay of a rule', async () => {
		const bot = await addSourceRule();
		await dispatch(bot, callbackUpdate(`ps:dp:r${SOURCE}`));
		await dispatch(bot, callbackUpdate(`ps:ds:r${SOURCE}:120`));

		expect((await getSourceRule(env.my_database, SOURCE)).delayMinutes).toBe(120);
	});

	it('toggles and deletes a rule', async () => {
		const bot = await addSourceRule();

		await dispatch(bot, callbackUpdate(`ps:tog:${SOURCE}`));
		expect((await getSourceRule(env.my_database, SOURCE)).enabled).toBe(false);

		await dispatch(bot, callbackUpdate(`ps:tog:${SOURCE}`));
		expect((await getSourceRule(env.my_database, SOURCE)).enabled).toBe(true);

		await dispatch(bot, callbackUpdate(`ps:rdel:${SOURCE}`));
		expect(await getSourceRule(env.my_database, SOURCE)).toBeNull();
	});

	it('rejects buttons pressed by someone who is not a channel admin', async () => {
		const { bot, postId } = await queueOne();
		calls = [];

		const stranger = { id: 1234, is_bot: false, first_name: 'Sara' };
		await dispatch(bot, callbackUpdate(`ps:pub:${postId}`, stranger));

		expect(toasts().some((t) => t.includes('دسترسی'))).toBe(true);
		expect((await getPost(env.my_database, postId)).status).toBe('scheduled');
	});
});

describe('public channel (bot is not a member)', () => {
	it('asks for the @username and explains the limits', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));

		const text = lastScreenText();
		expect(text).toContain('@my_channel');
		expect(text).toContain('پیش‌نمایش');
		expect(text).toContain('خصوصی');
	});

	it('registers the source and starts from the newest post', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));
		await dispatch(bot, messageUpdate('@my_pub_chan'));

		const rules = await listRulesForTarget(env.my_database, TARGET);
		expect(rules).toHaveLength(1);
		expect(rules[0].pollUsername).toBe('my_pub_chan');
		expect(rules[0].sourceChannelId).toBe(publicSourceChannelId('my_pub_chan'));

		const poll = await getPollSource(env.my_database, rules[0].id);
		expect(poll.cursorMessageId).toBe(5); // آرشیو یک‌جا سرازیر نمی‌شود

		expect(fetchCalls[0]).toContain('t.me/s/my_pub_chan');
		expect(allTexts().some((t) => t.includes('وصل شد'))).toBe(true);
	});

	it('accepts the username without @ and in any case', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));
		await dispatch(bot, messageUpdate('My_Pub_Chan'));

		const rules = await listRulesForTarget(env.my_database, TARGET);
		expect(rules[0].pollUsername).toBe('my_pub_chan');
	});

	it('rejects an invalid address but keeps the session open', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));
		await dispatch(bot, messageUpdate('نه'));

		expect(allTexts().some((t) => t.includes('درست نیست'))).toBe(true);
		expect(await listRulesForTarget(env.my_database, TARGET)).toHaveLength(0);

		// جلسه باز است: آدرس درست بعدی پذیرفته می‌شود
		await dispatch(bot, messageUpdate('my_pub_chan'));
		expect(await listRulesForTarget(env.my_database, TARGET)).toHaveLength(1);
	});

	it('reports a channel without a public preview', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));

		vi.unstubAllGlobals();
		vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }));
		await dispatch(bot, messageUpdate('ghost_chan'));

		expect(allTexts().some((t) => t.includes('پیدا نشد'))).toBe(true);
		expect(await listRulesForTarget(env.my_database, TARGET)).toHaveLength(0);
	});

	it('does not add the same channel twice', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));
		await dispatch(bot, messageUpdate('my_pub_chan'));

		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));
		await dispatch(bot, messageUpdate('@my_pub_chan'));

		expect(allTexts().some((t) => t.includes('از قبل'))).toBe(true);
		expect(await listRulesForTarget(env.my_database, TARGET)).toHaveLength(1);
	});

	it('sends the t.me link for a web post instead of trying to copy it', async () => {
		const bot = await setupBot();
		const db = env.my_database;
		const { createQueuedPost, appendItem, finalizePost } = await import('../src/telegram/db/postQueue.js');
		const { feedItemKey } = await import('../src/telegram/pollSources.js');

		const postId = await createQueuedPost(db, {
			sourceChannelId: publicSourceChannelId('my_pub_chan'),
			sourceTitle: '@my_pub_chan',
			sourceUsername: 'my_pub_chan',
			targetChannelId: TARGET,
			mediaGroupId: null,
			createdBy: USER.id,
			now: 1_800_000_000,
		});
		await appendItem(db, postId, {
			sourceMessageId: feedItemKey(77, 0),
			kind: 'text',
			fileId: null,
			text: 'پست وب',
			entities: null,
			extra: null,
		}, 1_800_000_000);
		await finalizePost(db, postId, 1_800_001_800, 1_800_000_000);

		await dispatch(bot, callbackUpdate(`ps:view:${postId}`));

		// کپی از کانال انجام نشده؛ لینک عمومی پست رفته است
		expect(calls.some((c) => c.method === 'copyMessage')).toBe(false);
		const link = calls.find((c) => c.method === 'sendMessage' && String(c.payload.text).includes('t.me'));
		expect(link.payload.text).toBe('https://t.me/my_pub_chan/77');
	});

	it('marks the source as public on the channel screen', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:pubsrc:${TARGET}`));
		await dispatch(bot, messageUpdate('my_pub_chan'));

		await dispatch(bot, callbackUpdate(`ps:c:${TARGET}`));
		expect(lastScreenText()).toContain('بدون عضویت');
	});

	it('offers public mode when the bot is not an admin of a forwarded public channel', async () => {
		memberStatus = 'member';
		const bot = await setupBot();

		await dispatch(bot, callbackUpdate(`ps:src:${TARGET}`));
		await dispatch(bot, forwardedUpdate());

		const offer = [...calls].reverse().find((c) => c.method === 'sendMessage' && c.payload.reply_markup);
		expect(callbacksOf(offer.payload)).toContain(`ps:usepub:${TARGET}:source_chan`);

		// با زدن دکمه، همان کانال بدون عضویت وصل می‌شود
		await dispatch(bot, callbackUpdate(`ps:usepub:${TARGET}:source_chan`));
		const rules = await listRulesForTarget(env.my_database, TARGET);
		expect(rules[0].pollUsername).toBe('source_chan');
	});

	it('does not offer public mode for a channel without a username', async () => {
		memberStatus = 'member';
		const bot = await setupBot();

		await dispatch(bot, callbackUpdate(`ps:src:${TARGET}`));
		await dispatch(bot, forwardedUpdate({ from: { id: -100777, title: 'کانال خصوصی', type: 'channel' } }));

		const texts = allTexts();
		expect(texts.some((t) => t.includes('ادمین نیست'))).toBe(true);
		expect(texts.some((t) => t.includes('بدون عضویت'))).toBe(false);
	});
});

describe('manual copy', () => {
	it('queues a forwarded post into the target channel', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate(`ps:man:${TARGET}`));
		await dispatch(bot, forwardedUpdate({ text: 'پستی که خودم انتخاب کردم' }));

		const post = await env.my_database.prepare('SELECT * FROM post_queue ORDER BY id DESC LIMIT 1').first();
		expect(post).toBeTruthy();
		expect(post.source_channel_id).toBe(0);
		expect(post.status).toBe('scheduled');

		const stored = await getPost(env.my_database, Number(post.id));
		expect(stored.items[0].text).toBe('پستی که خودم انتخاب کردم');
	});
});
