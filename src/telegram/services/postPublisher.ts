/**
 * انتشار یک پست از صف در کانال مقصد.
 *
 * طراحی دو مرحله‌ای (مثل «نقشه‌ی اجرا» در معماری مدیا):
 *   ۱. `buildPublishPlan` کاملاً خالص است و فقط می‌گوید «چه متدی با چه آرگومان‌هایی».
 *   ۲. `executePublishPlan` آن را روی کلاینت تلگرام اجرا می‌کند.
 *
 * چرا دوباره از file_id ارسال می‌کنیم و از `copyMessage` استفاده نمی‌کنیم؟
 *   - `copyMessage` اجازه‌ی تغییر **متن** را نمی‌دهد (فقط کپشن)، پس ویرایش ادمین بی‌اثر می‌شد.
 *   - اگر پست مبدأ حذف شود، `copyMessage` شکست می‌خورد؛ file_id مستقل از پیام مبدأ است.
 *   - یک مسیر کد به‌جای دو مسیر (کپی دست‌نخورده و ارسال ویرایش‌شده).
 */

import type { PostItem, QueuePost } from '../../core/schedule/types.js';

/** حداقل رابطی که از کلاینت تلگرام لازم داریم (تا در تست قابل جایگزینی باشد) */
export interface PublisherApi {
	sendMessage(chatId: number, text: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendPhoto(chatId: number, photo: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendVideo(chatId: number, video: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendDocument(chatId: number, document: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendAudio(chatId: number, audio: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendVoice(chatId: number, voice: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendAnimation(chatId: number, animation: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendSticker(chatId: number, sticker: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
	sendMediaGroup(
		chatId: number,
		media: unknown[],
		other?: Record<string, unknown>,
	): Promise<Array<{ message_id: number }>>;
}

/** متدهای تلگرامی که برای ارسال استفاده می‌کنیم */
export type SendMethod =
	| 'sendMessage'
	| 'sendPhoto'
	| 'sendVideo'
	| 'sendDocument'
	| 'sendAudio'
	| 'sendVoice'
	| 'sendAnimation'
	| 'sendSticker'
	| 'sendMediaGroup';

export type PublishPlan =
	| { method: SendMethod; args: unknown[]; items: number }
	| { method: 'unsupported'; reason: string; items: number };

const SINGLE_MEDIA_METHOD: Record<string, SendMethod> = {
	photo: 'sendPhoto',
	video: 'sendVideo',
	document: 'sendDocument',
	audio: 'sendAudio',
	voice: 'sendVoice',
	animation: 'sendAnimation',
	sticker: 'sendSticker',
};

/** JSON تلگرام برای entities؛ همیشه آرایه‌ی تازه (نه رفرنس مشترک) */
function entitiesOf(item: PostItem): unknown[] | undefined {
	return item.entities && item.entities.length > 0 ? item.entities : undefined;
}

function mediaExtra(item: PostItem): Record<string, unknown> {
	const extra: Record<string, unknown> = {};
	const raw = item.extra ?? {};
	if (typeof raw.width === 'number') extra.width = raw.width;
	if (typeof raw.height === 'number') extra.height = raw.height;
	if (typeof raw.duration === 'number') extra.duration = raw.duration;
	if (item.kind === 'video') extra.supports_streaming = true;
	return extra;
}

/**
 * نقشه‌ی ارسال. خروجی خالص است: هیچ I/O ندارد.
 * @param post پست صف (آیتم‌ها مرتب‌شده)
 * @param targetChannelId کانال مقصد
 */
export function buildPublishPlan(post: QueuePost, targetChannelId: number): PublishPlan {
	const items = post.items.filter((item) => item.kind !== 'unsupported');

	if (items.length === 0) {
		return { method: 'unsupported', reason: 'این پست محتوای قابل ارسالی ندارد.', items: 0 };
	}

	// ── پست تک‌آیتمی متنی ──
	if (items.length === 1 && items[0].kind === 'text') {
		const text = items[0].text ?? '';
		if (!text.trim()) {
			return { method: 'unsupported', reason: 'متن پست خالی است.', items: 1 };
		}
		const other: Record<string, unknown> = {};
		const entities = entitiesOf(items[0]);
		if (entities) other.entities = entities;
		return { method: 'sendMessage', args: [targetChannelId, text, other], items: 1 };
	}

	// ── پست تک‌آیتمی رسانه‌ای ──
	if (items.length === 1) {
		const item = items[0];
		const method = SINGLE_MEDIA_METHOD[item.kind];
		if (!method || !item.fileId) {
			return { method: 'unsupported', reason: 'این نوع رسانه پشتیبانی نمی‌شود.', items: 1 };
		}
		const other: Record<string, unknown> = { ...mediaExtra(item) };
		if (item.text && item.text.trim()) {
			other.caption = item.text;
			const entities = entitiesOf(item);
			if (entities) other.caption_entities = entities;
		}
		return { method, args: [targetChannelId, item.fileId, other], items: 1 };
	}

	// ── آلبوم (۲ تا ۱۰ آیتم) ──
	if (items.length > 10) {
		return { method: 'unsupported', reason: 'آلبوم بیش از ۱۰ آیتم دارد.', items: items.length };
	}

	const media = items.map((item) => {
		const type = item.kind === 'video' ? 'video' : item.kind === 'document' ? 'document' : 'photo';
		const entry: Record<string, unknown> = { type, media: item.fileId };
		if (item.text && item.text.trim()) {
			entry.caption = item.text;
			const entities = entitiesOf(item);
			if (entities) entry.caption_entities = entities;
		}
		if (type === 'video') {
			const raw = item.extra ?? {};
			if (typeof raw.width === 'number') entry.width = raw.width;
			if (typeof raw.height === 'number') entry.height = raw.height;
			if (typeof raw.duration === 'number') entry.duration = raw.duration;
			entry.supports_streaming = true;
		}
		return entry;
	});

	return { method: 'sendMediaGroup', args: [targetChannelId, media, {}], items: items.length };
}

/** استخراج کد/متن خطای تلگرام به شکل یکسان */
export function describeTelegramError(err: unknown): { message: string; code: number | null } {
	const anyErr = err as { description?: string; message?: string; error_code?: number; name?: string } | null;
	const message =
		anyErr?.description || anyErr?.message || (anyErr?.name ? String(anyErr.name) : '') || 'خطای نامشخص تلگرام';
	const code = typeof anyErr?.error_code === 'number' ? anyErr.error_code : null;
	return { message, code };
}

/**
 * اجرای نقشه روی کلاینت. خطاها گرفته و به شکل ساختاری برگردانده می‌شوند
 * تا حلقه‌ی کرون هرگز با یک پست خراب متوقف نشود.
 */
export async function executePublishPlan(
	api: PublisherApi,
	plan: PublishPlan,
): Promise<{ ok: boolean; messageId: number | null; error: string | null; errorCode: number | null }> {
	if (plan.method === 'unsupported') {
		return { ok: false, messageId: null, error: plan.reason, errorCode: null };
	}

	try {
		const fn = (api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[plan.method];
		if (typeof fn !== 'function') {
			return { ok: false, messageId: null, error: `متد ${plan.method} در کلاینت موجود نیست.`, errorCode: null };
		}
		const result = (await fn.apply(api, plan.args)) as { message_id?: number } | Array<{ message_id?: number }>;
		const messageId = Array.isArray(result)
			? (result[0]?.message_id ?? null)
			: (result?.message_id ?? null);
		return { ok: true, messageId: messageId === null ? null : Number(messageId), error: null, errorCode: null };
	} catch (err) {
		const { message, code } = describeTelegramError(err);
		return { ok: false, messageId: null, error: message, errorCode: code };
	}
}

/** میان‌بر: نقشه + اجرا */
export async function publishPost(api: PublisherApi, post: QueuePost, targetChannelId: number) {
	const plan = buildPublishPlan(post, targetChannelId);
	return executePublishPlan(api, plan);
}
