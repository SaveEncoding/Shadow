import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { publishOne } from '../src/telegram/publishQueue.js';
import { appendItem, createQueuedPost, finalizePost, getPost } from '../src/telegram/db/postQueue.js';
import { CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';

/**
 * آیتمی که `file_id` ندارد (منبع وبی که اسپول نشده) در لحظه‌ی انتشار باید
 * تلگرام بتواند لینکش را خودش بگیرد؛ اگر نتواند، کل پست شکست می‌خورد
 * (`failed to get HTTP URL content`). این تست‌ها دو چیز را تثبیت می‌کنند:
 *   ۱. درست پیش از ارسال، دوباره برای گرفتن `file_id` تلاش می‌کنیم؛
 *   ۲. وقتی نشد، پیامِ شکست می‌گوید چرا (نه اینکه تقصیرِ دسترسی باشد).
 */

const NOW = 1_800_000_000;
const TARGET = -1001234567890;
const SOURCE = -1009876543210;
const ADMIN_CHAT = 555;
const CDN = 'https://cdn4.telegram-cdn.org/file/abc123.jpg';

/** کلاینتی که فقط برای ارسال به چت ادمین `file_id` می‌دهد (نقشِ اسپول) */
class SpoolApi {
	constructor({ spoolFails = false, publishFails = null } = {}) {
		this.calls = [];
		this.spoolFails = spoolFails;
		this.publishFails = publishFails;
		this.nextId = 1000;
	}

	_record(method, args) {
		this.calls.push({ method, args });
	}

	async sendPhoto(chatId, photo) {
		this._record('sendPhoto', [chatId, photo]);
		if (chatId === ADMIN_CHAT) {
			if (this.spoolFails) {
				const err = new Error('Bad Request: failed to get HTTP URL content');
				err.error_code = 400;
				throw err;
			}
			return { message_id: ++this.nextId, photo: [{ file_id: 'file-from-spool', width: 800, height: 600 }] };
		}
		if (this.publishFails) {
			const err = new Error(this.publishFails);
			err.error_code = 400;
			throw err;
		}
		return { message_id: ++this.nextId, photo: [{ file_id: 'x', width: 1, height: 1 }] };
	}

	async sendVideo(chatId, video) {
		this._record('sendVideo', [chatId, video]);
		return { message_id: ++this.nextId, video: { file_id: 'video-from-spool' } };
	}

	async sendMessage(chatId, text) {
		this._record('sendMessage', [chatId, text]);
		return { message_id: ++this.nextId };
	}

	async editMessageText(chatId, messageId, text) {
		this._record('editMessageText', [chatId, messageId, text]);
		return true;
	}

	async deleteMessage(chatId, messageId) {
		this._record('deleteMessage', [chatId, messageId]);
		return true;
	}

	async copyMessage() {
		return { message_id: ++this.nextId };
	}
	async answerCallbackQuery() {
		return true;
	}

	texts() {
		return this.calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => String(c.args.at(-1)));
	}
}

async function queueUrlOnlyPost() {
	const db = env.my_database;
	const id = await createQueuedPost(db, {
		sourceChannelId: SOURCE,
		sourceTitle: 'مبدأ',
		sourceUsername: 'source_chan',
		targetChannelId: TARGET,
		mediaGroupId: null,
		createdBy: ADMIN_CHAT,
		now: NOW,
	});
	await appendItem(
		db,
		id,
		{ sourceMessageId: 11, kind: 'photo', fileId: null, text: 'عکس وب', entities: null, extra: { sourceUrl: CDN } },
		NOW,
	);
	await finalizePost(db, id, NOW, NOW);
	return id;
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
		.bind(TARGET, 'کانال مقصد', 'target_chan')
		.run();
});

describe('re-spooling right before publish', () => {
	it('takes a file_id before sending, so the publish no longer depends on the URL', async () => {
		const postId = await queueUrlOnlyPost();
		const api = new SpoolApi();

		const result = await publishOne(api, env.my_database, postId, NOW + 10);

		expect(result.status).toBe('published');
		// ارسالِ نهایی به کانال با file_id است، نه با لینک
		const toChannel = api.calls.filter((c) => c.method === 'sendPhoto' && c.args[0] === TARGET);
		expect(toChannel).toHaveLength(1);
		expect(toChannel[0].args[1]).toBe('file-from-spool');
		// پیام موقتِ اسپول پاک شده است
		expect(api.calls.some((c) => c.method === 'deleteMessage')).toBe(true);
		// و برای تلاشِ بعدی ذخیره شده است
		expect((await getPost(env.my_database, postId)).items[0].fileId).toBe('file-from-spool');
	});
});
