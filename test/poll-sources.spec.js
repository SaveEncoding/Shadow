import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { pollDueSources, pollOneSource, shouldPoll, MAX_POLL_FAILURES } from '../src/telegram/pollSources.js';
import {
	getPollSource,
	getPost,
	getSourceRule,
	listActivePollSources,
	listPendingPosts,
	saveSourceRule,
} from '../src/telegram/db/postQueue.js';
import { publicSourceChannelId } from '../src/core/schedule/publicFeed.js';
import { publishDuePosts } from '../src/telegram/publishQueue.js';
import { CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';
import { feedPage } from './helpers/feedFixture.js';

/**
 * تست پولر «کانال بدون عضویت بات»:
 * پیش‌نمایش وب قلابی + D1 واقعی + کلاینت تلگرام قلابی.
 */

const NOW = 1_800_000_000;
const TARGET = -1001234567890;
const ADMIN_CHAT = 555;
const USERNAME = 'shadow_news';

class FakeApi {
	constructor() {
		this.calls = [];
		this.failSpool = false;
	}

	async _send(method, args) {
		this.calls.push({ method, args });
		if (method === 'sendMediaGroup') return args[1].map(() => ({ message_id: 1 }));
		if (method === 'sendPhoto') {
			if (this.failSpool) {
				const err = new Error('Bad Request: wrong file identifier');
				err.error_code = 400;
				throw err;
			}
			return { message_id: 700, photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'spooled-photo', width: 800, height: 400 }] };
		}
		if (method === 'sendVideo') {
			if (this.failSpool) throw new Error('Bad Request: failed to get HTTP URL content');
			return { message_id: 701, video: { file_id: 'spooled-video', width: 640, height: 360 } };
		}
		if (method === 'sendMessage') return { message_id: 702 };
		return { message_id: 703 };
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

	adminSends() {
		return this.calls.filter((c) => c.method === 'sendMessage' && c.args[0] === ADMIN_CHAT);
	}
}

let api;
let feedPosts;
const fakeFetch = async () => new Response(feedPage(feedPosts), { status: 200 });

async function addPublicRule(overrides = {}) {
	await saveSourceRule(env.my_database, {
		sourceChannelId: publicSourceChannelId(USERNAME),
		sourceTitle: `@${USERNAME}`,
		sourceUsername: USERNAME,
		targetChannelId: TARGET,
		delayMinutes: 30,
		addedBy: 7,
		notifyChatId: ADMIN_CHAT,
		pollUsername: USERNAME,
		now: NOW,
		...overrides,
	});
	return getSourceRule(env.my_database, publicSourceChannelId(USERNAME));
}

async function setCursor(cursorMessageId) {
	const rule = await getSourceRule(env.my_database, publicSourceChannelId(USERNAME));
	await env.my_database
		.prepare('UPDATE post_poll_sources SET cursor_message_id = ? WHERE rule_id = ?')
		.bind(cursorMessageId, rule.id)
		.run();
}

async function activeSources() {
	return listActivePollSources(env.my_database, { limit: 10 });
}

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
	feedPosts = [];
});

describe('adding a public source', () => {
	it('stores the username and starts with a cursor on the newest post', async () => {
		const rule = await addPublicRule();

		expect(rule.pollUsername).toBe(USERNAME);
		expect(rule.sourceChannelId).toBe(publicSourceChannelId(USERNAME));

		const poll = await getPollSource(env.my_database, rule.id);
		expect(poll.username).toBe(USERNAME);
		expect(poll.cursorMessageId).toBe(0);

		const sources = await activeSources();
		expect(sources).toHaveLength(1);
		expect(sources[0].rule.targetChannelId).toBe(TARGET);
	});

	it('is listed only while the rule is enabled', async () => {
		const rule = await addPublicRule();
		await env.my_database.prepare('UPDATE post_sources SET enabled = 0 WHERE id = ?').bind(rule.id).run();
		expect(await activeSources()).toHaveLength(0);
	});
});

describe('pollOneSource', () => {
	it('does not dump the channel archive on the first poll', async () => {
		await addPublicRule();
		feedPosts = [
			{ channel: USERNAME, id: 10, html: 'قدیمی' },
			{ channel: USERNAME, id: 11, html: 'تازه' },
		];

		const [source] = await activeSources();
		const outcome = await pollOneSource({ db: env.my_database, api, now: NOW, fetchImpl: fakeFetch }, source);

		expect(outcome).toMatchObject({ queued: 0, error: null });
		expect(await listPendingPosts(env.my_database, TARGET)).toHaveLength(0);

		const poll = await getPollSource(env.my_database, source.ruleId);
		expect(poll.cursorMessageId).toBe(11);
	});

	it('queues a brand new post with the rule delay and notifies the admin', async () => {
		await addPublicRule();
		await setCursor(10);
		feedPosts = [
			{ channel: USERNAME, id: 10, html: 'قدیمی' },
			{ channel: USERNAME, id: 12, html: 'خبر <b>تازه</b> از کانال' },
		];

		const [source] = await activeSources();
		const outcome = await pollOneSource({ db: env.my_database, api, now: NOW, fetchImpl: fakeFetch }, source);
		expect(outcome.queued).toBe(1);

		const pending = await listPendingPosts(env.my_database, TARGET);
		expect(pending).toHaveLength(1);
		expect(pending[0].publishAt).toBe(NOW + 30 * 60);
		expect(pending[0].sourceChannelId).toBe(publicSourceChannelId(USERNAME));
		expect(pending[0].items[0].text).toBe('خبر تازه از کانال');
		expect(pending[0].items[0].entities).toEqual([{ type: 'bold', offset: 4, length: 4 }]);

		// پیش‌نمایش برای ادمین رفته است
		const preview = api.adminSends()[0];
		expect(preview.args[1]).toContain('تازه');

		// کِرسر جلو رفته تا دوباره کپی نشود
		const poll = await getPollSource(env.my_database, source.ruleId);
		expect(poll.cursorMessageId).toBe(12);

		const again = await pollOneSource({ db: env.my_database, api, now: NOW + 60, fetchImpl: fakeFetch }, source);
		expect(again.queued).toBe(0);
		expect(await listPendingPosts(env.my_database, TARGET)).toHaveLength(1);
	});

	it('takes a photo, spools a durable file_id and deletes the temporary message', async () => {
		await addPublicRule();
		await setCursor(20);
		feedPosts = [
			{
				channel: USERNAME,
				id: 21,
				html: 'عکس با کپشن',
				media: [{ kind: 'photo', url: 'https://cdn.example/one.jpg' }],
			},
		];

		const [source] = await activeSources();
		await pollOneSource({ db: env.my_database, api, now: NOW, fetchImpl: fakeFetch }, source);

		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(post.items[0].kind).toBe('photo');
		expect(post.items[0].fileId).toBe('spooled-photo'); // از تلگرام گرفته شده
		expect(post.items[0].text).toBe('عکس با کپشن');
		expect(post.items[0].extra).toMatchObject({ sourceUrl: 'https://cdn.example/one.jpg', width: 800, height: 400 });

		// پیام موقت در چت ادمین پاک شده است
		const deleted = api.calls.find((c) => c.method === 'deleteMessage');
		expect(deleted.args).toEqual([ADMIN_CHAT, 700]);
	});

	it('falls back to the web URL when the file cannot be spooled', async () => {
		await addPublicRule();
		await setCursor(30);
		api.failSpool = true;
		feedPosts = [{ channel: USERNAME, id: 31, media: [{ kind: 'photo', url: 'https://cdn.example/two.jpg' }] }];

		const [source] = await activeSources();
		const outcome = await pollOneSource({ db: env.my_database, api, now: NOW, fetchImpl: fakeFetch }, source);
		expect(outcome.queued).toBe(1);

		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(post.items[0].fileId).toBeNull();
		expect(post.items[0].extra).toMatchObject({ sourceUrl: 'https://cdn.example/two.jpg' });
	});

	it('keeps album items together in one post', async () => {
		await addPublicRule();
		await setCursor(40);
		feedPosts = [
			{
				channel: USERNAME,
				id: 41,
				html: 'آلبوم',
				media: [
					{ kind: 'photo', url: 'https://cdn.example/a.jpg' },
					{ kind: 'photo', url: 'https://cdn.example/b.jpg' },
					{ kind: 'photo', url: 'https://cdn.example/c.jpg' },
				],
			},
		];

		const [source] = await activeSources();
		await pollOneSource({ db: env.my_database, api, now: NOW, fetchImpl: fakeFetch }, source);

		const posts = await listPendingPosts(env.my_database, TARGET);
		expect(posts).toHaveLength(1);
		expect(posts[0].items).toHaveLength(3);
		expect(posts[0].items[0].text).toBe('آلبوم');
	});

	it('skips unsupported content without stopping the batch', async () => {
		await addPublicRule();
		await setCursor(50);
		feedPosts = [
			{ channel: USERNAME, id: 51, extraHtml: '<div class="tgme_widget_message_poll">x</div>' },
			{ channel: USERNAME, id: 52, html: 'پست سالم' },
		];

		const [source] = await activeSources();
		const outcome = await pollOneSource({ db: env.my_database, api, now: NOW, fetchImpl: fakeFetch }, source);

		expect(outcome).toMatchObject({ queued: 1, skipped: 1 });
		const posts = await listPendingPosts(env.my_database, TARGET);
		expect(posts).toHaveLength(1);
		expect(posts[0].items[0].text).toBe('پست سالم');
	});

	it('records a fetch error and backs off after repeated failures', async () => {
		await addPublicRule();
		const [source] = await activeSources();

		const failing = async () => new Response('nope', { status: 503 });
		const outcome = await pollOneSource({ db: env.my_database, api, now: NOW, fetchImpl: failing }, source);
		expect(outcome.error).toContain('در دسترس نیست');

		const poll = await getPollSource(env.my_database, source.ruleId);
		expect(poll.failures).toBe(1);
		expect(poll.lastError).toContain('در دسترس نیست');

		// بعد از چند خطا، مدتی رهایش می‌کنیم
		await env.my_database
			.prepare('UPDATE post_poll_sources SET failures = ? WHERE rule_id = ?')
			.bind(MAX_POLL_FAILURES, source.ruleId)
			.run();
		expect(shouldPoll({ ...poll, failures: MAX_POLL_FAILURES, lastPolledAt: NOW }, NOW + 60)).toBe(false);
		expect(shouldPoll({ ...poll, failures: MAX_POLL_FAILURES, lastPolledAt: NOW }, NOW + 20 * 60)).toBe(true);
	});
});

describe('from web preview to the channel', () => {
	it('publishes the polled post with the spooled file_id at the scheduled time', async () => {
		await addPublicRule({ delayMinutes: 15 });
		await setCursor(80);
		feedPosts = [
			{
				channel: USERNAME,
				id: 81,
				html: 'خبر <b>مهم</b>',
				media: [{ kind: 'photo', url: 'https://cdn.example/live.jpg' }],
			},
		];

		const [source] = await activeSources();
		await pollDueSources(env, { api, now: NOW, fetchImpl: fakeFetch, sources: [source] });

		const [queued] = await listPendingPosts(env.my_database, TARGET);
		expect(queued.publishAt).toBe(NOW + 15 * 60);

		// پیش از موعد چیزی منتشر نمی‌شود
		api.calls = [];
		await publishDuePosts(env, { api, now: NOW + 60, fetchImpl: async () => new Response(feedPage([]), { status: 200 }) });
		expect(api.calls.filter((c) => c.args?.[0] === TARGET)).toHaveLength(0);

		// در زمان مقرر، با file_id پایدار (نه URL) ارسال می‌شود
		api.calls = [];
		await publishDuePosts(env, { api, now: NOW + 15 * 60, fetchImpl: async () => new Response(feedPage([]), { status: 200 }) });

		const sent = api.calls.find((c) => c.method === 'sendPhoto' && c.args[0] === TARGET);
		expect(sent).toBeTruthy();
		expect(sent.args[1]).toBe('spooled-photo');
		expect(sent.args[2].caption).toBe('خبر مهم');
		expect(sent.args[2].caption_entities).toEqual([{ type: 'bold', offset: 4, length: 3 }]);

		const post = await getPost(env.my_database, queued.id);
		expect(post.status).toBe('published');
	});

	it('publishes with the web URL when the file could not be spooled', async () => {
		await addPublicRule({ delayMinutes: 1 });
		await setCursor(90);
		api.failSpool = true;
		feedPosts = [{ channel: USERNAME, id: 91, html: 'فقط عکس', media: [{ kind: 'photo', url: 'https://cdn.example/x.jpg' }] }];

		const [source] = await activeSources();
		await pollDueSources(env, { api, now: NOW, fetchImpl: fakeFetch, sources: [source] });

		api.calls = [];
		await publishDuePosts(env, { api, now: NOW + 60, fetchImpl: async () => new Response(feedPage([]), { status: 200 }) });

		const sent = api.calls.find((c) => c.method === 'sendPhoto' && c.args[0] === TARGET);
		expect(sent.args[1]).toBe('https://cdn.example/x.jpg');
	});
});

describe('pollDueSources', () => {
	it('polls the active sources of the minute tick', async () => {
		await addPublicRule();
		await setCursor(60);
		feedPosts = [{ channel: USERNAME, id: 61, html: 'پست تازه' }];

		const result = await pollDueSources(env, {
			api,
			now: NOW,
			fetchImpl: fakeFetch,
			sources: await activeSources(),
		});

		expect(result).toMatchObject({ polled: 1, queued: 1, failed: 0 });
	});

	it('one broken source does not stop the others', async () => {
		await addPublicRule();
		await setCursor(70);
		await saveSourceRule(env.my_database, {
			sourceChannelId: publicSourceChannelId('broken_chan'),
			sourceTitle: '@broken_chan',
			sourceUsername: 'broken_chan',
			targetChannelId: TARGET,
			delayMinutes: 5,
			addedBy: 7,
			notifyChatId: ADMIN_CHAT,
			pollUsername: 'broken_chan',
			now: NOW,
		});
		await env.my_database
			.prepare('UPDATE post_poll_sources SET cursor_message_id = 5 WHERE username = ?')
			.bind('broken_chan')
			.run();

		feedPosts = [{ channel: USERNAME, id: 71, html: 'پست تازه' }];

		const mixedFetch = async (url) => {
			if (String(url).includes('broken_chan')) throw new Error('boom');
			return new Response(feedPage(feedPosts), { status: 200 });
		};

		const result = await pollDueSources(env, {
			api,
			now: NOW,
			fetchImpl: mixedFetch,
			sources: await activeSources(),
		});

		expect(result.queued).toBe(1);
		expect(result.failed).toBe(1);
	});
});
