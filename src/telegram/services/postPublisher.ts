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
import { MAX_CAPTION_LENGTH, splitTextWithEntities } from '../../core/text/split.js';
import type { HtmlTextEntity } from '../../core/text/htmlToEntities.js';

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
	/** چند پیام پشت‌سرهم (متن بلندتر از سقف تلگرام، یا کپشن + ادامه‌ی متن) */
	| { method: 'sequence'; steps: PublishPlan[]; items: number }
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

/**
 * مرجعی که تلگرام برای رسانه می‌پذیرد:
 *   ۱. `file_id` (حالت ادمین؛ پایدارترین راه)
 *   ۲. `sourceUrl` (حالت پیش‌نمایش وب، وقتی نشد فایل را به تلگرام بدهیم)
 */
export function mediaRef(item: PostItem): string | null {
	if (item.fileId) return item.fileId;
	const raw = item.extra ?? {};
	const url = raw.sourceUrl;
	return typeof url === 'string' && url.length > 0 ? url : null;
}

/** JSON تلگرام برای entities؛ همیشه آرایه‌ی تازه (نه رفرنس مشترک) */
function entitiesOf(item: PostItem): unknown[] | undefined {
	return item.entities && item.entities.length > 0 ? item.entities : undefined;
}

/** entities آیتم به شکل قابل‌استفاده برای شکستن متن */
function entityList(item: PostItem): HtmlTextEntity[] {
	return (item.entities ?? []) as HtmlTextEntity[];
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
function textPlan(chatId: number, text: string, entities: unknown[]): PublishPlan {
	const other: Record<string, unknown> = {};
	if (entities.length > 0) other.entities = entities;
	return { method: 'sendMessage', args: [chatId, text, other], items: 1 };
}

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
		const parts = splitTextWithEntities(text, entityList(items[0]));
		if (parts.length === 1) return textPlan(targetChannelId, parts[0].text, parts[0].entities as unknown[]);
		return {
			method: 'sequence',
			items: 1,
			steps: parts.map((part) => textPlan(targetChannelId, part.text, part.entities as unknown[])),
		};
	}

	// ── پست تک‌آیتمی رسانه‌ای ──
	if (items.length === 1) {
		const item = items[0];
		const method = SINGLE_MEDIA_METHOD[item.kind];
		const ref = mediaRef(item);
		if (!method || !ref) {
			return { method: 'unsupported', reason: 'این نوع رسانه پشتیبانی نمی‌شود.', items: 1 };
		}
		const other: Record<string, unknown> = { ...mediaExtra(item) };

		// کپشن سقف ۱۰۲۴ کاراکتر دارد؛ باقی متن در پیام بعدی می‌آید (نه اینکه گم شود)
		const captionParts = item.text && item.text.trim()
			? splitTextWithEntities(item.text, entityList(item), MAX_CAPTION_LENGTH)
			: [];
		if (captionParts.length > 0) {
			other.caption = captionParts[0].text;
			if (captionParts[0].entities.length > 0) other.caption_entities = captionParts[0].entities;
		}

		const plan: PublishPlan = { method, args: [targetChannelId, ref, other], items: 1 };
		const overflow = captionParts.slice(1);
		if (overflow.length === 0) return plan;
		return {
			method: 'sequence',
			items: 1,
			steps: [plan, ...overflow.map((part) => textPlan(targetChannelId, part.text, part.entities))],
		};
	}

	// ── آلبوم (۲ تا ۱۰ آیتم) ──
	if (items.length > 10) {
		return { method: 'unsupported', reason: 'آلبوم بیش از ۱۰ آیتم دارد.', items: items.length };
	}

	const missingRef = items.find((item) => !mediaRef(item));
	if (missingRef) {
		return { method: 'unsupported', reason: 'یکی از رسانه‌های آلبوم مرجعی برای ارسال ندارد.', items: items.length };
	}

	const media = items.map((item) => {
		const type = item.kind === 'video' ? 'video' : item.kind === 'document' ? 'document' : 'photo';
		const entry: Record<string, unknown> = { type, media: mediaRef(item) };
		if (item.text && item.text.trim()) {
			// سقف کپشن هر آیتم ۱۰۲۴ است؛ بیشتر از آن در پیام جدا نمی‌گنجد
			const caption = splitTextWithEntities(item.text, entityList(item), MAX_CAPTION_LENGTH)[0];
			entry.caption = caption.text;
			if (caption.entities.length > 0) entry.caption_entities = caption.entities;
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

	// چند پیام: اگر یکی شکست بخورد، همان شکست برگردانده می‌شود تا ادمین بداند
	// پست ناقص منتشر شده (نسبت به سکوت، صادقانه‌تر است).
	if (plan.method === 'sequence') {
		let firstId: number | null = null;
		for (const step of plan.steps) {
			const result = await executePublishPlan(api, step);
			if (!result.ok) {
				return { ok: false, messageId: firstId, error: result.error, errorCode: result.errorCode };
			}
			if (firstId === null) firstId = result.messageId;
		}
		return { ok: firstId !== null, messageId: firstId, error: null, errorCode: null };
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
