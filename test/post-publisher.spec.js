import { describe, it, expect } from 'vitest';
import { buildPublishPlan, describeTelegramError, executePublishPlan, publishPost } from '../src/telegram/services/postPublisher.js';
import { channelPostLink } from '../src/telegram/publishQueue.js';

const TARGET = -1001234567890;

function post(items, overrides = {}) {
	return {
		id: 1,
		sourceChannelId: -100999,
		sourceTitle: 'مبدأ',
		sourceUsername: 'src',
		targetChannelId: TARGET,
		mediaGroupId: null,
		status: 'scheduled',
		publishAt: 0,
		finalizeAt: null,
		createdAt: 0,
		updatedAt: 0,
		publishedAt: null,
		publishedMessageId: null,
		attempts: 0,
		lastError: null,
		createdBy: null,
		previewChatId: null,
		previewMessageId: null,
		edited: false,
		items,
		...overrides,
	};
}

const textItem = (text, entities = null) => ({
	sourceMessageId: 1,
	kind: 'text',
	fileId: null,
	text,
	entities,
	extra: null,
});

const mediaItem = (kind, fileId, caption = null, extra = null) => ({
	sourceMessageId: 2,
	kind,
	fileId,
	text: caption,
	entities: null,
	extra,
});

describe('buildPublishPlan', () => {
	it('sends a text post with its entities so formatting survives', () => {
		const entities = [{ type: 'bold', offset: 0, length: 4 }];
		const plan = buildPublishPlan(post([textItem('سلام دنیا', entities)]), TARGET);
		expect(plan.method).toBe('sendMessage');
		expect(plan.args[0]).toBe(TARGET);
		expect(plan.args[1]).toBe('سلام دنیا');
		expect(plan.args[2].entities).toEqual(entities);
	});

	it('sends a single photo with caption, caption entities and size', () => {
		const item = { ...mediaItem('photo', 'file-1', 'کپشن', { width: 1200, height: 800 }) };
		item.entities = [{ type: 'italic', offset: 0, length: 4 }];
		const plan = buildPublishPlan(post([item]), TARGET);
		expect(plan.method).toBe('sendPhoto');
		expect(plan.args[1]).toBe('file-1');
		expect(plan.args[2]).toMatchObject({
			caption: 'کپشن',
			caption_entities: [{ type: 'italic', offset: 0, length: 4 }],
			width: 1200,
			height: 800,
		});
	});

	it('maps every supported single media kind to its API method', () => {
		const cases = {
			photo: 'sendPhoto',
			video: 'sendVideo',
			document: 'sendDocument',
			audio: 'sendAudio',
			voice: 'sendVoice',
			animation: 'sendAnimation',
			sticker: 'sendSticker',
		};
		for (const [kind, method] of Object.entries(cases)) {
			const plan = buildPublishPlan(post([mediaItem(kind, `file-${kind}`)]), TARGET);
			expect(plan.method).toBe(method);
			expect(plan.args[1]).toBe(`file-${kind}`);
		}
	});

	it('marks videos as streaming-capable', () => {
		const plan = buildPublishPlan(post([mediaItem('video', 'v1', null, { width: 720, height: 1280, duration: 12 })]), TARGET);
		expect(plan.args[2]).toMatchObject({ width: 720, height: 1280, duration: 12, supports_streaming: true });
	});

	it('puts the album caption on the first item only', () => {
		// رگرسیون: کپشنِ آیتم‌های بعدی در تلگرام دیده نمی‌شود ولی پردازش می‌شود؛
		// یک لینکِ شکسته در آن‌ها کل آلبوم را با WEBPAGE_CURL_FAILED رد می‌کرد.
		const plan = buildPublishPlan(post([mediaItem('photo', 'a', 'متن'), mediaItem('photo', 'b', 'https://x.test/a')]), TARGET);
		const media = plan.args[1];
		expect(media[0]).toMatchObject({ type: 'photo', media: 'a', caption: 'متن' });
		expect(media[1]).toMatchObject({ type: 'photo', media: 'b' });
		expect(media[1].caption).toBeUndefined();
		expect(media[1].caption_entities).toBeUndefined();
	});

	it('hoists the album caption when the first item has none', () => {
		const item = { ...mediaItem('photo', 'b', 'کپشن اصلی'), sourceMessageId: 2 };
		item.entities = [{ type: 'bold', offset: 0, length: 5 }];
		const plan = buildPublishPlan(post([mediaItem('photo', 'a'), item]), TARGET);
		const media = plan.args[1];
		expect(media[0]).toMatchObject({ media: 'a', caption: 'کپشن اصلی' });
		expect(media[0].caption_entities).toEqual([{ type: 'bold', offset: 0, length: 5 }]);
		expect(media[1].caption).toBeUndefined();
	});

	it('groups several items into one album', () => {
		const plan = buildPublishPlan(post([mediaItem('photo', 'a', 'اول'), mediaItem('photo', 'b'), mediaItem('video', 'c')]), TARGET);
		expect(plan.method).toBe('sendMediaGroup');
		expect(plan.args[0]).toBe(TARGET);
		const media = plan.args[1];
		expect(media).toHaveLength(3);
		expect(media[0]).toMatchObject({ type: 'photo', media: 'a', caption: 'اول' });
		expect(media[1]).toMatchObject({ type: 'photo', media: 'b' });
		expect(media[2]).toMatchObject({ type: 'video', media: 'c' });
		expect(plan.items).toBe(3);
	});

	it('refuses to publish an empty or unsupported post', () => {
		expect(buildPublishPlan(post([]), TARGET).method).toBe('unsupported');
		expect(buildPublishPlan(post([]), TARGET)).toMatchObject({ items: 0 });
		expect(buildPublishPlan(post([textItem('   ')]), TARGET).method).toBe('unsupported');
		expect(buildPublishPlan(post([mediaItem('unsupported', null)]), TARGET).method).toBe('unsupported');
		// عکس بدون file_id قابل ارسال نیست
		expect(buildPublishPlan(post([mediaItem('photo', null)]), TARGET).method).toBe('unsupported');
	});

	it('rejects albums with more than 10 items (Telegram limit)', () => {
		const items = Array.from({ length: 11 }, (_, i) => ({ ...mediaItem('photo', `f${i}`), sourceMessageId: i }));
		expect(buildPublishPlan(post(items), TARGET).method).toBe('unsupported');
	});
});

describe('buildPublishPlan — web sources', () => {
	it('sends media from a URL when no file_id is available', () => {
		const item = { ...mediaItem('photo', null, 'کپشن'), extra: { sourceUrl: 'https://cdn.example/a.jpg' } };
		const plan = buildPublishPlan(post([item]), TARGET);
		expect(plan.method).toBe('sendPhoto');
		expect(plan.args[1]).toBe('https://cdn.example/a.jpg');
	});

	it('prefers a real file_id over the URL', () => {
		const item = { ...mediaItem('photo', 'file-9'), extra: { sourceUrl: 'https://cdn.example/a.jpg' } };
		expect(buildPublishPlan(post([item]), TARGET).args[1]).toBe('file-9');
	});

	it('splits a long text post into several messages (Telegram limit)', () => {
		const long = 'کلمه '.repeat(1500); // ~۷۵۰۰ کاراکتر
		const plan = buildPublishPlan(post([textItem(long)]), TARGET);

		expect(plan.method).toBe('sequence');
		expect(plan.steps.length).toBeGreaterThan(1);
		for (const step of plan.steps) {
			expect(step.method).toBe('sendMessage');
			expect(step.args[1].length).toBeLessThanOrEqual(4096);
		}
	});

	it('moves caption overflow into a follow-up message', () => {
		const caption = 'ا'.repeat(1500);
		const item = mediaItem('photo', 'f1', caption);
		const plan = buildPublishPlan(post([item]), TARGET);

		expect(plan.method).toBe('sequence');
		expect(plan.steps[0].method).toBe('sendPhoto');
		expect(plan.steps[0].args[2].caption.length).toBeLessThanOrEqual(1024);
		expect(plan.steps[1].method).toBe('sendMessage');
	});

	it('refuses an album item without any media reference', () => {
		const plan = buildPublishPlan(post([mediaItem('photo', 'a'), mediaItem('photo', null)]), TARGET);
		expect(plan.method).toBe('unsupported');
	});
});

describe('executePublishPlan', () => {
	function stubApi(handler) {
		const calls = [];
		const api = {};
		for (const method of [
			'sendMessage',
			'sendPhoto',
			'sendVideo',
			'sendDocument',
			'sendAudio',
			'sendVoice',
			'sendAnimation',
			'sendSticker',
			'sendMediaGroup',
		]) {
			api[method] = async (...args) => {
				calls.push({ method, args });
				return handler(method, args);
			};
		}
		return { api, calls };
	}

	it('runs the planned method on the client', async () => {
		const { api, calls } = stubApi(() => ({ message_id: 321 }));
		const result = await executePublishPlan(api, buildPublishPlan(post([textItem('سلام')]), TARGET));

		expect(result).toEqual({ ok: true, messageId: 321, error: null, errorCode: null });
		expect(calls[0].method).toBe('sendMessage');
	});

	it('takes the first message id of an album', async () => {
		const { api } = stubApi(() => [{ message_id: 500 }, { message_id: 501 }]);
		const plan = buildPublishPlan(post([mediaItem('photo', 'a'), mediaItem('photo', 'b')]), TARGET);
		const result = await executePublishPlan(api, plan);
		expect(result.messageId).toBe(500);
	});

	it('turns a telegram error into a structured failure instead of throwing', async () => {
		const { api } = stubApi(() => {
			const err = new Error('Forbidden: bot is not a member of the channel chat');
			err.error_code = 403;
			throw err;
		});
		const result = await executePublishPlan(api, buildPublishPlan(post([textItem('سلام')]), TARGET));

		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe(403);
		expect(result.error).toContain('not a member');
	});

	it('retries the album without the item Telegram could not fetch', async () => {
		// رگرسیونِ واقعی: یک آلبوم ۴ عکسی که آیتم چهارمش فقط URL داشت و تلگرام
		// نتوانست آن را بگیرد ⇒ `WEBPAGE_CURL_FAILED` و کل آلبوم رد شد.
		const { api, calls } = stubApi((method, args) => {
			if (method !== 'sendMediaGroup') return { message_id: 1 };
			if (args[1].length === 4) {
				const err = new Error('Bad Request: failed to send message #4 with the error message "WEBPAGE_CURL_FAILED"');
				err.error_code = 400;
				throw err;
			}
			return args[1].map((_, index) => ({ message_id: 900 + index }));
		});

		const items = [
			mediaItem('photo', 'file-1', 'کپشن آلبوم'),
			{ ...mediaItem('photo', 'file-2'), sourceMessageId: 2 },
			{ ...mediaItem('photo', 'file-3'), sourceMessageId: 3 },
			{ ...mediaItem('photo', null, null, {}), sourceMessageId: 4, extra: { sourceUrl: 'https://cdn.example/4.jpg' } },
		];

		const result = await executePublishPlan(api, buildPublishPlan(post(items), TARGET));

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(2);
		expect(calls[1].method).toBe('sendMediaGroup');
		expect(calls[1].args[1]).toHaveLength(3);
		// کپشن روی آیتم اولِ آلبوم کوتاه‌شده حفظ می‌شود
		expect(calls[1].args[1][0]).toMatchObject({ media: 'file-1', caption: 'کپشن آلبوم' });
		expect(calls[1].args[1].map((entry) => entry.media)).not.toContain('https://cdn.example/4.jpg');
	});

	it('falls back to a single media send when only one item survives', async () => {
		const { api, calls } = stubApi((method, args) => {
			if (method === 'sendMediaGroup') {
				const err = new Error('Bad Request: failed to send message #2 with the error message "WEBPAGE_CURL_FAILED"');
				err.error_code = 400;
				throw err;
			}
			return { message_id: 77 };
		});

		const items = [
			mediaItem('photo', 'file-1', 'کپشن'),
			{ ...mediaItem('photo', null), sourceMessageId: 2, extra: { sourceUrl: 'https://cdn.example/2.jpg' } },
		];
		const result = await executePublishPlan(api, buildPublishPlan(post(items), TARGET));

		expect(result.ok).toBe(true);
		expect(result.messageId).toBe(77);
		expect(calls[1].method).toBe('sendPhoto');
		expect(calls[1].args[1]).toBe('file-1');
		expect(calls[1].args[2]).toMatchObject({ caption: 'کپشن' });
	});

	it('does not retry errors that are not about fetching a URL', async () => {
		const { api, calls } = stubApi(() => {
			const err = new Error('Forbidden: bot was kicked from the channel chat');
			err.error_code = 403;
			throw err;
		});

		const items = [
			mediaItem('photo', 'file-1'),
			{ ...mediaItem('photo', null), sourceMessageId: 2, extra: { sourceUrl: 'https://cdn.example/2.jpg' } },
		];
		const result = await executePublishPlan(api, buildPublishPlan(post(items), TARGET));

		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe(403);
		expect(calls).toHaveLength(1);
	});

	it('gives up when every album item is a URL and Telegram cannot fetch it', async () => {
		const { api, calls } = stubApi(() => {
			const err = new Error('Bad Request: failed to send message #1 with the error message "WEBPAGE_CURL_FAILED"');
			err.error_code = 400;
			throw err;
		});

		const items = [
			{ ...mediaItem('photo', null, 'کپشن'), extra: { sourceUrl: 'https://cdn.example/1.jpg' } },
			{ ...mediaItem('photo', null), sourceMessageId: 2, extra: { sourceUrl: 'https://cdn.example/2.jpg' } },
		];
		const result = await executePublishPlan(api, buildPublishPlan(post(items), TARGET));

		expect(result.ok).toBe(false);
		expect(result.error).toContain('WEBPAGE_CURL_FAILED');
		// آیتم نام‌برده حذف می‌شود و بقیه یک بار دیگر امتحان می‌شوند؛ وقتی آن‌ها هم
		// URL باشند و باز شکست بخورند، خطا به همان شکل قبل برمی‌گردد.
		expect(calls[0].args[1]).toHaveLength(2);
		expect(calls[1].method).toBe('sendPhoto');
		expect(calls).toHaveLength(2);
	});

	it('reports unsupported plans without touching the network', async () => {
		const { api, calls } = stubApi(() => ({ message_id: 1 }));
		const result = await executePublishPlan(api, buildPublishPlan(post([]), TARGET));
		expect(result.ok).toBe(false);
		expect(result.error).toContain('قابل ارسال');
		expect(calls).toHaveLength(0);
	});

	it('runs every step of a sequence and returns the first message id', async () => {
		let next = 0;
		const { api, calls } = stubApi(() => ({ message_id: ++next }));
		const long = 'کلمه '.repeat(1500);
		const result = await executePublishPlan(api, buildPublishPlan(post([textItem(long)]), TARGET));

		expect(result.ok).toBe(true);
		expect(result.messageId).toBe(1);
		expect(calls.length).toBeGreaterThan(1);
	});

	it('stops a sequence on the first failure and reports it', async () => {
		let call = 0;
		const { api, calls } = stubApi(() => {
			call++;
			if (call === 2) {
				const err = new Error('Bad Request: message is too long');
				err.error_code = 400;
				throw err;
			}
			return { message_id: call };
		});
		const long = 'کلمه '.repeat(1500);
		const result = await executePublishPlan(api, buildPublishPlan(post([textItem(long)]), TARGET));

		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe(400);
		expect(calls).toHaveLength(2);
	});

	it('publishPost is a plan+execute shortcut', async () => {
		const { api } = stubApi(() => ({ message_id: 9 }));
		const result = await publishPost(api, post([textItem('سلام')]), TARGET);
		expect(result).toMatchObject({ ok: true, messageId: 9 });
	});
});

describe('describeTelegramError', () => {
	it('reads the telegram error shape', () => {
		expect(describeTelegramError({ error_code: 429, description: 'Too Many Requests' })).toEqual({
			message: 'Too Many Requests',
			code: 429,
		});
	});

	it('falls back for unknown errors', () => {
		expect(describeTelegramError(new Error('boom'))).toEqual({ message: 'boom', code: null });
		expect(describeTelegramError(null).message).toBe('خطای نامشخص تلگرام');
	});
});

describe('channelPostLink', () => {
	it('builds a t.me link when the channel has a username', () => {
		expect(channelPostLink('my_channel', 42)).toBe('https://t.me/my_channel/42');
	});
	it('returns null without username or message id', () => {
		expect(channelPostLink(null, 42)).toBeNull();
		expect(channelPostLink('my_channel', null)).toBeNull();
	});
});
