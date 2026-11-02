import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	MAX_X_FAILURES,
	MIN_X_POLL_SECONDS,
	X_BACKOFF_SECONDS,
	pollDueXSources,
	pollOneXSource,
	shouldPollX,
} from '../src/telegram/xPoll.js';
import {
	getPost,
	getSourceRule,
	getXSource,
	listActiveXSources,
	listPendingPosts,
	saveSourceRule,
	upsertXSource,
} from '../src/telegram/db/postQueue.js';
import { xItemKey, xSourceChannelId } from '../src/core/sources/x.js';
import { publishDuePosts } from '../src/telegram/publishQueue.js';
import { CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';

const NOW = 1_800_000_000;
const TARGET = -1001234567890;
const ADMIN_CHAT = 555;
const HANDLE = 'openai';

class FakeApi {
	constructor() {
		this.calls = [];
		this.failSpool = false;
	}

	async _send(method, args) {
		this.calls.push({ method, args });
		if (method === 'sendPhoto') {
			if (this.failSpool) throw new Error('Bad Request: failed to get HTTP URL content');
			return { message_id: 800, photo: [{ file_id: 'x-photo', width: 1200, height: 800 }] };
		}
		if (method === 'sendMessage') return { message_id: 801 };
		if (method === 'sendMediaGroup') return args[1].map(() => ({ message_id: 802 }));
		return { message_id: 803 };
	}

	sendMessage(...a) {
		return this._send('sendMessage', a);
	}
	sendPhoto(...a) {
		return this._send('sendPhoto', a);
	}
	sendVideo(...a) {
		return this._send('sendVideo', a);
	}
	sendDocument(...a) {
		return this._send('sendDocument', a);
	}
	sendAudio(...a) {
		return this._send('sendAudio', a);
	}
	sendVoice(...a) {
		return this._send('sendVoice', a);
	}
	sendAnimation(...a) {
		return this._send('sendAnimation', a);
	}
	sendSticker(...a) {
		return this._send('sendSticker', a);
	}
	sendMediaGroup(...a) {
		return this._send('sendMediaGroup', a);
	}
	async editMessageText(...a) {
		this.calls.push({ method: 'editMessageText', args: a });
		return true;
	}
	async copyMessage(...a) {
		this.calls.push({ method: 'copyMessage', args: a });
		return { message_id: 1 };
	}
	async answerCallbackQuery(...a) {
		this.calls.push({ method: 'answerCallbackQuery', args: a });
		return true;
	}
	async deleteMessage(...a) {
		this.calls.push({ method: 'deleteMessage', args: a });
		return true;
	}

	channelSends() {
		return this.calls.filter((c) => c.args?.[0] === TARGET);
	}
	adminSends() {
		return this.calls.filter((c) => c.method === 'sendMessage' && c.args[0] === ADMIN_CHAT);
	}
}

let api;
let timeline;
let fetchCalls = [];

/** فچ قلابی: هم lookup کاربر، هم خط زمانی */
async function fakeFetch(url) {
	fetchCalls.push(String(url));
	if (String(url).includes('/2/users/by/username/')) {
		return new Response(JSON.stringify({ data: { id: '42', username: HANDLE, name: 'OpenAI' } }), { status: 200 });
	}
	if (String(url).includes('/2/users/42/tweets')) {
		const tweets = timeline;
		const includes = { media: [] };
		// رسانه‌ها را از خود پست‌ها می‌سازیم تا تست ساده بماند
		for (const tweet of tweets) {
			for (const media of tweet.__media ?? []) includes.media.push(media);
		}
		return new Response(JSON.stringify({ data: tweets.map(({ __media, ...rest }) => rest), includes }), { status: 200 });
	}
	return new Response('{}', { status: 404 });
}

const tweet = (id, text, extra = {}) => ({ id, text, created_at: '2026-10-24T10:00:00.000Z', ...extra });

async function addXRule(overrides = {}) {
	await saveSourceRule(env.my_database, {
		sourceChannelId: xSourceChannelId(HANDLE),
		sourceTitle: `@${HANDLE}`,
		sourceUsername: HANDLE,
		targetChannelId: TARGET,
		delayMinutes: 30,
		addedBy: 7,
		notifyChatId: ADMIN_CHAT,
		xHandle: HANDLE,
		now: NOW,
		...overrides,
	});
	const rule = await getSourceRule(env.my_database, xSourceChannelId(HANDLE));
	// ثبت اولیه هم یک بار خوانده است؛ در تست، زمان را آزاد می‌گذاریم
	await env.my_database.prepare('UPDATE post_x_sources SET last_polled_at = NULL WHERE rule_id = ?').bind(rule.id).run();
	return rule;
}

async function setCursor(cursorId, extra = {}) {
	const rule = await getSourceRule(env.my_database, xSourceChannelId(HANDLE));
	await upsertXSource(env.my_database, { ruleId: rule.id, handle: HANDLE, now: NOW, cursorId });
	if (Object.keys(extra).length > 0) {
		const sets = Object.keys(extra).map((key) => `${key} = ?`).join(', ');
		await env.my_database
			.prepare(`UPDATE post_x_sources SET ${sets} WHERE rule_id = ?`)
			.bind(...Object.values(extra), rule.id)
			.run();
	}
	return rule;
}

const provider = { kind: 'official', token: 'tok' };

beforeAll(async () => {
	await createScheduleTables(env.my_database);
	await env.my_database.exec(CHANNELS_TABLE);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
	await env.my_database.exec('DELETE FROM channels;');
	await env.my_database
		.prepare('INSERT INTO channels (channel_id, title, username) VALUES (?, ?, ?)')
		.bind(TARGET, 'کانال من', 'my_channel')
		.run();

	api = new FakeApi();
	timeline = [];
	fetchCalls = [];
});

describe('registration', () => {
	it('stores the handle, a rule and an empty cursor', async () => {
		const rule = await addXRule();

		expect(rule.xHandle).toBe(HANDLE);
		expect(rule.pollUsername).toBeNull();
		expect(rule.sourceChannelId).toBe(xSourceChannelId(HANDLE));

		const source = await getXSource(env.my_database, rule.id);
		expect(source.handle).toBe(HANDLE);
		expect(source.cursorId).toBeNull();

		const active = await listActiveXSources(env.my_database, { limit: 5 });
		expect(active).toHaveLength(1);
		expect(active[0].rule.targetChannelId).toBe(TARGET);
	});

	it('is not polled while the rule is disabled', async () => {
		const rule = await addXRule();
		await env.my_database.prepare('UPDATE post_sources SET enabled = 0 WHERE id = ?').bind(rule.id).run();
		expect(await listActiveXSources(env.my_database, { limit: 5 })).toHaveLength(0);
	});
});

describe('shouldPollX', () => {
	const row = (over) => ({ ruleId: 1, handle: HANDLE, userId: null, cursorId: null, lastPolledAt: null, lastError: null, failures: 0, ...over });

	it('never polls the same account more often than the cost guard allows', () => {
		expect(shouldPollX(row({ lastPolledAt: null }), NOW)).toBe(true);
		expect(shouldPollX(row({ lastPolledAt: NOW - 60 }), NOW)).toBe(false);
		expect(shouldPollX(row({ lastPolledAt: NOW - MIN_X_POLL_SECONDS }), NOW)).toBe(true);
	});

	it('backs off after repeated failures', () => {
		const failing = row({ failures: MAX_X_FAILURES, lastPolledAt: NOW });
		expect(shouldPollX(failing, NOW + 60)).toBe(false);
		expect(shouldPollX(failing, NOW + X_BACKOFF_SECONDS)).toBe(true);
	});
});

describe('pollOneXSource', () => {
	it('does not dump the account archive on the first poll', async () => {
		await addXRule();
		timeline = [tweet('100', 'پست قدیمی'), tweet('101', 'پست تازه')];

		const [source] = await listActiveXSources(env.my_database, { limit: 5 });
		const outcome = await pollOneXSource({ db: env.my_database, api, now: NOW, provider, fetchImpl: fakeFetch }, source);

		expect(outcome.queued).toBe(0);
		expect(await listPendingPosts(env.my_database, TARGET)).toHaveLength(0);

		const stored = await getXSource(env.my_database, source.ruleId);
		expect(stored.cursorId).toBe('101');
		expect(stored.userId).toBe('42'); // برای صرفه‌جویی در هزینه‌ی lookup بعدی
	});

	it('queues a new tweet with the delay, notifies the admin and advances the cursor', async () => {
		await addXRule();
		await setCursor('200');
		timeline = [tweet('201', 'خبر تازه از X')];

		const [source] = await listActiveXSources(env.my_database, { limit: 5 });
		const outcome = await pollOneXSource({ db: env.my_database, api, now: NOW, provider, fetchImpl: fakeFetch }, source);
		expect(outcome.queued).toBe(1);

		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(post.publishAt).toBe(NOW + 30 * 60);
		expect(post.sourceChannelId).toBe(xSourceChannelId(HANDLE));
		expect(post.sourceUsername).toBe(HANDLE);
		expect(post.items[0]).toMatchObject({ kind: 'text', text: 'خبر تازه از X', fileId: null });

		// پیش‌نمایش در چت ادمین
		expect(api.adminSends()[0].args[1]).toContain('خبر تازه از X');
		expect((await getXSource(env.my_database, source.ruleId)).cursorId).toBe('201');

		// همان پست دوباره کپی نمی‌شود
		await pollOneXSource({ db: env.my_database, api, now: NOW + 600, provider, fetchImpl: fakeFetch }, source);
		expect(await listPendingPosts(env.my_database, TARGET)).toHaveLength(1);
	});

	it('copies the images of a tweet as an album and spools durable file ids', async () => {
		await addXRule();
		await setCursor('300');
		timeline = [
			tweet('301', 'دو عکس', {
				attachments: { media_keys: ['k1', 'k2'] },
				__media: [
					{ media_key: 'k1', type: 'photo', url: 'https://pbs.twimg.com/media/1.jpg', width: 1200, height: 800 },
					{ media_key: 'k2', type: 'photo', url: 'https://pbs.twimg.com/media/2.jpg', width: 800, height: 800 },
				],
			}),
		];

		const [source] = await listActiveXSources(env.my_database, { limit: 5 });
		await pollOneXSource({ db: env.my_database, api, now: NOW, provider, fetchImpl: fakeFetch }, source);

		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(post.items).toHaveLength(2);
		expect(post.items.map((i) => i.kind)).toEqual(['photo', 'photo']);
		expect(post.items[0].fileId).toBe('x-photo');
		expect(post.items[0].text).toBe('دو عکس');
		expect(post.items[1].text).toBeNull();
		expect(post.items[0].sourceMessageId).toBe(xItemKey('301', 0));
		expect(post.items[1].sourceMessageId).toBe(xItemKey('301', 1));

		// پیام موقت spool پاک شده است
		expect(api.calls.some((c) => c.method === 'deleteMessage')).toBe(true);
	});

	it('falls back to the image url when spooling fails', async () => {
		await addXRule();
		await setCursor('400');
		api.failSpool = true;
		timeline = [
			tweet('401', 'عکس', {
				attachments: { media_keys: ['k1'] },
				__media: [{ media_key: 'k1', type: 'photo', url: 'https://pbs.twimg.com/media/x.jpg' }],
			}),
		];

		const [source] = await listActiveXSources(env.my_database, { limit: 5 });
		await pollOneXSource({ db: env.my_database, api, now: NOW, provider, fetchImpl: fakeFetch }, source);

		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(post.items[0].fileId).toBeNull();
		expect(post.items[0].extra).toMatchObject({ sourceUrl: 'https://pbs.twimg.com/media/x.jpg' });
	});

	it('keeps the text and appends the original link when a video could not be copied', async () => {
		await addXRule();
		await setCursor('500');
		timeline = [
			tweet('501', 'ویدیوی معرفی', {
				attachments: { media_keys: ['v1'] },
				__media: [{ media_key: 'v1', type: 'video', preview_image_url: 'https://pbs.twimg.com/media/v.jpg' }],
			}),
		];

		const [source] = await listActiveXSources(env.my_database, { limit: 5 });
		await pollOneXSource({ db: env.my_database, api, now: NOW, provider, fetchImpl: fakeFetch }, source);

		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(post.items[0].kind).toBe('text');
		expect(post.items[0].text).toContain('ویدیوی معرفی');
		expect(post.items[0].text).toContain('https://x.com/openai/status/501');
	});

	it('records a provider error and counts the failure', async () => {
		await addXRule();
		const [source] = await listActiveXSources(env.my_database, { limit: 5 });

		const outcome = await pollOneXSource(
			{
				db: env.my_database,
				api,
				now: NOW,
				provider,
				fetchImpl: async () => new Response('{}', { status: 401 }),
			},
			source,
		);

		expect(outcome.error).toContain('کلید X');
		const stored = await getXSource(env.my_database, source.ruleId);
		expect(stored.failures).toBe(1);
		expect(stored.lastError).toContain('کلید X');
	});

	it('does nothing when X is not configured', async () => {
		await addXRule();
		await setCursor('600');
		timeline = [tweet('601', 'توییت')];

		const [source] = await listActiveXSources(env.my_database, { limit: 5 });
		const outcome = await pollOneXSource(
			{ db: env.my_database, api, now: NOW, provider: { kind: 'none' }, fetchImpl: fakeFetch },
			source,
		);

		expect(outcome.error).toContain('پیکربندی نشده');
		expect(await listPendingPosts(env.my_database, TARGET)).toHaveLength(0);
	});
});

describe('pollDueXSources', () => {
	it('polls the sources that are due and skips the ones polled recently', async () => {
		await addXRule();
		await setCursor('700', { last_polled_at: NOW - 60 });
		timeline = [tweet('701', 'تازه')];

		const sources = await listActiveXSources(env.my_database, { limit: 5 });
		const skipped = await pollDueXSources(env, { api, now: NOW, sources, provider, fetchImpl: fakeFetch });
		expect(skipped.polled).toBe(0);

		const polled = await pollDueXSources(env, {
			api,
			now: NOW + MIN_X_POLL_SECONDS,
			sources,
			provider,
			fetchImpl: fakeFetch,
		});
		expect(polled.polled).toBe(1);
		expect(polled.queued).toBe(1);
	});

	it('one broken account does not stop the others', async () => {
		await addXRule();
		await setCursor('800');
		await saveSourceRule(env.my_database, {
			sourceChannelId: xSourceChannelId('broken'),
			sourceTitle: '@broken',
			sourceUsername: 'broken',
			targetChannelId: TARGET,
			delayMinutes: 5,
			addedBy: 7,
			notifyChatId: ADMIN_CHAT,
			xHandle: 'broken',
			now: NOW,
		});
		await env.my_database
			.prepare('UPDATE post_x_sources SET cursor_id = ?, last_polled_at = NULL WHERE handle = ?')
			.bind('100', 'broken')
			.run();

		timeline = [tweet('801', 'از حساب سالم')];
		const mixedFetch = async (url) => {
			if (String(url).includes('broken')) throw new Error('boom');
			return fakeFetch(url);
		};

		const result = await pollDueXSources(env, {
			api,
			now: NOW,
			sources: await listActiveXSources(env.my_database, { limit: 5 }),
			provider,
			fetchImpl: mixedFetch,
		});

		expect(result.queued).toBe(1);
		expect(result.failed).toBe(1);
	});
});

describe('end to end', () => {
	it('publishes the polled tweet to the channel at the scheduled time', async () => {
		await addXRule({ delayMinutes: 10 });
		await setCursor('900');
		timeline = [tweet('901', 'خبر مهم از X')];

		await pollDueXSources(env, {
			api,
			now: NOW,
			sources: await listActiveXSources(env.my_database, { limit: 5 }),
			provider,
			fetchImpl: fakeFetch,
		});

		const [queued] = await listPendingPosts(env.my_database, TARGET);
		api.calls = [];

		// پیش از موعد منتشر نمی‌شود
		await publishDuePosts(env, { api, now: NOW + 60, fetchImpl: async () => new Response('{}', { status: 200 }) });
		expect(api.channelSends()).toHaveLength(0);

		await publishDuePosts(env, {
			api,
			now: NOW + 10 * 60,
			fetchImpl: async () => new Response('{}', { status: 200 }),
		});

		const sent = api.channelSends()[0];
		expect(sent.method).toBe('sendMessage');
		expect(sent.args[1]).toBe('خبر مهم از X');
		expect((await getPost(env.my_database, queued.id)).status).toBe('published');
	});

	it('publishes an x album with the spooled photo', async () => {
		await addXRule({ delayMinutes: 1 });
		await setCursor('950');
		timeline = [
			tweet('951', 'کپشن آلبوم', {
				attachments: { media_keys: ['p1'] },
				__media: [{ media_key: 'p1', type: 'photo', url: 'https://pbs.twimg.com/media/z.jpg' }],
			}),
		];

		await pollDueXSources(env, {
			api,
			now: NOW,
			sources: await listActiveXSources(env.my_database, { limit: 5 }),
			provider,
			fetchImpl: fakeFetch,
		});

		api.calls = [];
		await publishDuePosts(env, { api, now: NOW + 60, fetchImpl: async () => new Response('{}', { status: 200 }) });

		const sent = api.channelSends().find((c) => c.method === 'sendPhoto');
		expect(sent.args[1]).toBe('x-photo'); // file_id پایدار، نه URL
		expect(sent.args[2].caption).toBe('کپشن آلبوم');
	});
});
