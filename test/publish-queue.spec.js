import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	finalizeReadyAlbums,
	notifyQueued,
	publishDuePosts,
	publishOne,
	recoverStuckPosts,
} from '../src/telegram/publishQueue.js';
import {
	appendItem,
	claimForPublish,
	createQueuedPost,
	finalizePost,
	getPost,
	saveSourceRule,
} from '../src/telegram/db/postQueue.js';
import { CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';

/**
 * تست موتور انتشار با یک کلاینت تلگرام قلابی.
 * هیچ درخواست شبکه‌ای زده نمی‌شود، ولی همان تصمیم‌هایی گرفته می‌شود که در تولید:
 * claim، انتخاب متد، ذخیره‌ی نتیجه، تلاش مجدد و ویرایش پیش‌نمایش.
 */

const NOW = 1_800_000_000;
const TARGET = -1001234567890;
const SOURCE = -1009876543210;
const ADMIN_CHAT = 555;

class FakeApi {
	constructor() {
		this.calls = [];
		this.failWith = null;
		this.sendId = 1000;
	}

	async _send(method, args) {
		this.calls.push({ method, args });
		if (this.failWith) {
			const err = new Error(this.failWith.description ?? 'boom');
			err.error_code = this.failWith.error_code;
			throw err;
		}
		if (method === 'sendMediaGroup') {
			return args[1].map(() => ({ message_id: ++this.sendId }));
		}
		if (method === 'sendMessage') return { message_id: ++this.sendId };
		return { message_id: ++this.sendId };
	}

	sendMessage(...args) {
		return this._send('sendMessage', args);
	}
	sendPhoto(...args) {
		return this._send('sendPhoto', args);
	}
	sendVideo(...args) {
		return this._send('sendVideo', args);
	}
	sendDocument(...args) {
		return this._send('sendDocument', args);
	}
	sendAudio(...args) {
		return this._send('sendAudio', args);
	}
	sendVoice(...args) {
		return this._send('sendVoice', args);
	}
	sendAnimation(...args) {
		return this._send('sendAnimation', args);
	}
	sendSticker(...args) {
		return this._send('sendSticker', args);
	}
	sendMediaGroup(...args) {
		return this._send('sendMediaGroup', args);
	}
	async editMessageText(...args) {
		this.calls.push({ method: 'editMessageText', args });
		if (this.editFails) throw new Error('message to edit not found');
		return true;
	}
	async copyMessage(...args) {
		this.calls.push({ method: 'copyMessage', args });
		return { message_id: ++this.sendId };
	}
	async answerCallbackQuery(...args) {
		this.calls.push({ method: 'answerCallbackQuery', args });
		return true;
	}

	methods() {
		return this.calls.map((c) => c.method);
	}
	/** فقط ارسال‌ها به کانال مقصد (اعلان‌های ادمین هم با sendMessage می‌روند) */
	channelCalls() {
		return this.calls.filter(
			(c) => ['sendMessage', 'sendPhoto', 'sendMediaGroup', 'sendVideo'].includes(c.method) && c.args[0] === TARGET,
		);
	}

	adminMessages() {
		return this.calls.filter((c) => c.method === 'sendMessage' && c.args[0] === ADMIN_CHAT);
	}
}

let api;

beforeAll(async () => {
	await createScheduleTables(env.my_database);
	await env.my_database.exec(CHANNELS_TABLE);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
	await env.my_database.exec('DELETE FROM channels;');
	await env.my_database
		.prepare('INSERT INTO channels (channel_id, title, username) VALUES (?, ?, ?)')
		.bind(TARGET, 'کانال مقصد', 'target_chan')
		.run();

	api = new FakeApi();
	await saveSourceRule(env.my_database, {
		sourceChannelId: SOURCE,
		sourceTitle: 'مبدأ',
		sourceUsername: 'source_chan',
		targetChannelId: TARGET,
		delayMinutes: 30,
		enabled: true,
		notifyChatId: ADMIN_CHAT,
		addedBy: 7,
		now: NOW,
	});
});

/** یک پست زمان‌بندی‌شده با آیتم‌های دلخواه */
async function queuePost(items, { publishAt = NOW, createdBy = ADMIN_CHAT, createdAt = NOW } = {}) {
	const db = env.my_database;
	const id = await createQueuedPost(db, {
		sourceChannelId: SOURCE,
		sourceTitle: 'مبدأ',
		sourceUsername: 'source_chan',
		targetChannelId: TARGET,
		mediaGroupId: null,
		createdBy,
		now: createdAt,
	});
	for (const item of items) await appendItem(db, id, item, createdAt);
	await finalizePost(db, id, publishAt, createdAt);
	return id;
}

const textItem = (text = 'سلام', entities = null) => ({
	sourceMessageId: 1,
	kind: 'text',
	fileId: null,
	text,
	entities,
	extra: null,
});

const photoItem = (id, fileId, caption = null) => ({
	sourceMessageId: id,
	kind: 'photo',
	fileId,
	text: caption,
	entities: null,
	extra: { width: 100, height: 100 },
});

describe('publishOne', () => {
	it('publishes a due text post once and stores the message id', async () => {
		const id = await queuePost([textItem('سلام دنیا', [{ type: 'bold', offset: 0, length: 4 }])]);

		const result = await publishOne(api, env.my_database, id, NOW);
		expect(result).toEqual({ ok: true, status: 'published' });

		const posts = api.channelCalls();
		expect(posts).toHaveLength(1);
		expect(posts[0].method).toBe('sendMessage');
		expect(posts[0].args[0]).toBe(TARGET);
		expect(posts[0].args[1]).toBe('سلام دنیا');
		expect(posts[0].args[2].entities).toEqual([{ type: 'bold', offset: 0, length: 4 }]);

		const post = await getPost(env.my_database, id);
		expect(post.status).toBe('published');
		expect(post.publishedMessageId).toBe(1001);
		expect(post.publishedAt).toBe(NOW);
	});

	it('never sends the same post twice (cron tick + "publish now" click)', async () => {
		const id = await queuePost([textItem()]);

		expect(await publishOne(api, env.my_database, id, NOW)).toMatchObject({ status: 'published' });
		expect(await publishOne(api, env.my_database, id, NOW)).toEqual({ ok: false, status: 'skipped' });
		expect(api.channelCalls()).toHaveLength(1);
	});

	it('sends an album with sendMediaGroup and keeps the first message id', async () => {
		const id = await queuePost([photoItem(1, 'file-a', 'اول'), photoItem(2, 'file-b')]);

		const result = await publishOne(api, env.my_database, id, NOW);
		expect(result.ok).toBe(true);

		const call = api.channelCalls()[0];
		expect(call.method).toBe('sendMediaGroup');
		expect(call.args[1]).toHaveLength(2);
		expect(call.args[1][0]).toMatchObject({ type: 'photo', media: 'file-a', caption: 'اول' });
		expect((await getPost(env.my_database, id)).publishedMessageId).toBe(1001);
	});

	it('edits the existing preview message instead of spamming a new one', async () => {
		const id = await queuePost([textItem()]);

		// اعلان اولیه‌ی صف (پیام تازه)
		await notifyQueued(api, env.my_database, id, NOW);
		const queuedMessages = api.adminMessages().length;
		const previewMessageId = (await getPost(env.my_database, id)).previewMessageId;
		expect(previewMessageId).toBeGreaterThan(0);

		await publishOne(api, env.my_database, id, NOW);

		// پس از انتشار، همان پیام پیش‌نمایش ویرایش می‌شود (نه پیام تازه)
		const edits = api.calls.filter((c) => c.method === 'editMessageText');
		expect(edits).toHaveLength(1);
		expect(edits[0].args[0]).toBe(ADMIN_CHAT);
		expect(edits[0].args[1]).toBe(previewMessageId);
		expect(edits[0].args[2]).toContain('منتشر شد');
		// تنها پیام تازه‌ی ادمین، همان پیش‌نمایش اولیه است
		expect(api.adminMessages()).toHaveLength(queuedMessages);
	});

	it('sends a fresh preview when the old one was deleted', async () => {
		const id = await queuePost([textItem()]);
		await notifyQueued(api, env.my_database, id, NOW);
		api.editFails = true;

		await publishOne(api, env.my_database, id, NOW);

		const sends = api.adminMessages();
		expect(sends.length).toBe(2); // پیش‌نمایش اولیه + پیش‌نمایش تازه پس از ویرایش ناموفق
		expect(sends[sends.length - 1].args[1]).toContain('منتشر شد');
	});

	it('schedules a retry for a temporary telegram error', async () => {
		const id = await queuePost([textItem()]);
		api.failWith = { error_code: 500, description: 'Internal Server Error' };

		const result = await publishOne(api, env.my_database, id, NOW);
		expect(result).toEqual({ ok: false, status: 'retry-scheduled' });

		const post = await getPost(env.my_database, id);
		expect(post.status).toBe('scheduled');
		expect(post.attempts).toBe(1);
		expect(post.publishAt).toBe(NOW + 180);
		expect(post.lastError).toContain('Internal Server Error');
	});

	it('gives up on a permanent error and tells the admin', async () => {
		const id = await queuePost([textItem()]);
		api.failWith = { error_code: 403, description: 'Forbidden: bot is not a member' };

		const result = await publishOne(api, env.my_database, id, NOW);
		expect(result).toEqual({ ok: false, status: 'failed' });

		const post = await getPost(env.my_database, id);
		expect(post.status).toBe('failed');
		expect(post.lastError).toContain('Forbidden');

		const failureNotice = api.adminMessages().pop();
		expect(failureNotice.args[0]).toBe(ADMIN_CHAT);
		expect(failureNotice.args[1]).toContain('ناموفق');
	});

	it('fails an unsupported post immediately instead of retrying it three times', async () => {
		const id = await queuePost([{ sourceMessageId: 1, kind: 'photo', fileId: null, text: null, entities: null, extra: null }]);

		const result = await publishOne(api, env.my_database, id, NOW);
		expect(result).toEqual({ ok: false, status: 'failed' });
		expect(api.channelCalls()).toHaveLength(0);

		const post = await getPost(env.my_database, id);
		expect(post.status).toBe('failed');
		expect(post.attempts).toBe(1);
	});

	it('does nothing for a canceled post', async () => {
		const id = await queuePost([textItem()]);
		await env.my_database.prepare("UPDATE post_queue SET status = 'canceled' WHERE id = ?").bind(id).run();

		expect(await publishOne(api, env.my_database, id, NOW)).toEqual({ ok: false, status: 'skipped' });
		expect(api.channelCalls()).toHaveLength(0);
	});
});

describe('publishDuePosts (cron entry)', () => {
	it('publishes only what is due and respects the batch limit', async () => {
		const due1 = await queuePost([textItem('یکی')], { publishAt: NOW - 60 });
		const due2 = await queuePost([textItem('دو')], { publishAt: NOW - 30 });
		const future = await queuePost([textItem('بعداً')], { publishAt: NOW + 600 });

		const result = await publishDuePosts(env, { api, now: NOW });
		expect(result.published).toBe(2);

		expect((await getPost(env.my_database, due1)).status).toBe('published');
		expect((await getPost(env.my_database, due2)).status).toBe('published');
		expect((await getPost(env.my_database, future)).status).toBe('scheduled');
		expect(api.channelCalls()).toHaveLength(2);
	});

	it('does not stop the queue when one post is broken', async () => {
		await queuePost([textItem('اول')], { publishAt: NOW - 60 });
		await queuePost([], { publishAt: NOW - 50 }); // پست خالی → غیرقابل ارسال

		const result = await publishDuePosts(env, { api, now: NOW });
		expect(result.published).toBe(1);
		// پست خالی بدون ارسال، failed می‌شود
		expect(result.failed).toBe(0);
		expect(api.channelCalls()).toHaveLength(1);
	});

	it('runs the same post only once even if the tick repeats', async () => {
		await queuePost([textItem()], { publishAt: NOW - 10 });

		await publishDuePosts(env, { api, now: NOW });
		await publishDuePosts(env, { api, now: NOW });
		expect(api.channelCalls()).toHaveLength(1);
	});
});

describe('albums', () => {
	it('finalizes a collecting album after the grace period and schedules it from the first item', async () => {
		const db = env.my_database;
		const id = await createQueuedPost(db, {
			sourceChannelId: SOURCE,
			sourceTitle: 'مبدأ',
			sourceUsername: 'source_chan',
			targetChannelId: TARGET,
			mediaGroupId: 'alb-1',
			createdBy: ADMIN_CHAT,
			now: NOW,
		});
		await appendItem(db, id, photoItem(1, 'a'), NOW, NOW + 20);
		await appendItem(db, id, photoItem(2, 'b'), NOW + 3, NOW + 23);

		// هنوز مهلت تمام نشده
		expect(await finalizeReadyAlbums(db, NOW + 10)).toEqual([]);
		expect((await getPost(db, id)).status).toBe('collecting');

		expect(await finalizeReadyAlbums(db, NOW + 23)).toEqual([id]);
		const post = await getPost(db, id);
		expect(post.status).toBe('scheduled');
		// انتشار = اولین آیتم + تأخیر قانون (۳۰ دقیقه)
		expect(post.publishAt).toBe(NOW + 1800);

		// و بعد از رسیدن زمان، به‌صورت آلبوم منتشر می‌شود
		const result = await publishDuePosts(env, { api, now: NOW + 1800 });
		expect(result.published).toBe(1);
		expect(api.channelCalls()[0].method).toBe('sendMediaGroup');
		expect(api.channelCalls()[0].args[1]).toHaveLength(2);
	});

	it('notifies the admin about a freshly finalized album', async () => {
		const db = env.my_database;
		const id = await createQueuedPost(db, {
			sourceChannelId: SOURCE,
			targetChannelId: TARGET,
			mediaGroupId: 'alb-2',
			createdBy: ADMIN_CHAT,
			now: NOW,
		});
		await appendItem(db, id, photoItem(1, 'a'), NOW, NOW + 20);

		await publishDuePosts(env, { api, now: NOW + 25 });

		// اعلان صف باید به چت ادمین رفته باشد، ضمن اینکه آلبوم هنوز منتشر نشده
		const notifications = api.adminMessages();
		expect(notifications.length).toBeGreaterThan(0);
		expect(notifications[0].args[0]).toBe(ADMIN_CHAT);
		expect(notifications[0].args[1]).toContain('صف');
		expect(api.channelCalls()).toHaveLength(0);
	});
});

describe('stuck posts', () => {
	it('marks a post left in publishing as failed WITHOUT resending it', async () => {
		const id = await queuePost([textItem()], { publishAt: NOW });

		expect(await claimForPublish(env.my_database, id, NOW)).toBe(true);
		// Worker وسط ارسال مرده است؛ ۱۱ دقیقه بعد
		const later = NOW + 11 * 60;

		const recovered = await recoverStuckPosts(api, env.my_database, later);
		expect(recovered).toBe(1);

		const post = await getPost(env.my_database, id);
		expect(post.status).toBe('failed');
		expect(post.lastError).toContain('بررسی');
		expect(api.channelCalls()).toHaveLength(0);
	});

	it('leaves a fresh publishing post alone', async () => {
		const id = await queuePost([textItem()], { publishAt: NOW });
		await claimForPublish(env.my_database, id, NOW);

		expect(await recoverStuckPosts(api, env.my_database, NOW + 60)).toBe(0);
		expect((await getPost(env.my_database, id)).status).toBe('publishing');
	});
});
