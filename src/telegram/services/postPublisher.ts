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

import { toPersianDigits } from '../../core/schedule/timing.js';
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
	sendMediaGroup(chatId: number, media: unknown[], other?: Record<string, unknown>): Promise<Array<{ message_id: number }>>;
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

/** یک فراخوانی واقعیِ تلگرام (همه‌ی مراحل یک `sequence` از همین نوع‌اند) */
export type SingleStepPlan = { method: SendMethod; args: unknown[]; items: number };

export type PublishPlan =
	| SingleStepPlan
	/** چند پیام پشت‌سرهم (متن بلندتر از سقف تلگرام، یا کپشن + ادامه‌ی متن) */
	| { method: 'sequence'; steps: SingleStepPlan[]; items: number }
	| { method: 'unsupported'; reason: string; items: number };

/** نتیجه‌ی اجرای نقشه؛ `ok: false` همراه با متن و کد خطای تلگرام */
export interface PublishResult {
	ok: boolean;
	messageId: number | null;
	error: string | null;
	errorCode: number | null;
	/**
	 * توضیح فارسی برای ادمین وقتی پست منتشر شده ولی **کامل** نبوده است
	 * (مثلاً یک آیتمِ آلبوم حذف شده). `null` یعنی همه چیز کامل بوده.
	 */
	note: string | null;
}

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
function textPlan(chatId: number, text: string, entities: unknown[]): SingleStepPlan {
	const other: Record<string, unknown> = {};
	if (entities.length > 0) other.entities = entities;
	return { method: 'sendMessage', args: [chatId, text, other], items: 1 };
}

export function buildPublishPlan(post: QueuePost, targetChannelId: number): PublishPlan {
	const items = post.items.filter((item) => item.kind !== 'unsupported');

	if (items.length === 0) {
		return { method: 'unsupported', reason: 'این پست محتوای قابل ارسالی ندارد.', items: 0 };
	}

	const first = items[0]!;

	// ── پست تک‌آیتمی متنی ──
	if (items.length === 1 && first.kind === 'text') {
		const text = first.text ?? '';
		if (!text.trim()) {
			return { method: 'unsupported', reason: 'متن پست خالی است.', items: 1 };
		}
		const parts = splitTextWithEntities(text, entityList(first));
		if (parts.length === 1) {
			const part = parts[0]!;
			return textPlan(targetChannelId, part.text, part.entities as unknown[]);
		}
		return {
			method: 'sequence',
			items: 1,
			steps: parts.map((part) => textPlan(targetChannelId, part.text, part.entities as unknown[])),
		};
	}

	// ── پست تک‌آیتمی رسانه‌ای ──
	if (items.length === 1) {
		const method = SINGLE_MEDIA_METHOD[first.kind];
		const ref = mediaRef(first);
		if (!method || !ref) {
			return { method: 'unsupported', reason: 'این نوع رسانه پشتیبانی نمی‌شود.', items: 1 };
		}
		const other: Record<string, unknown> = { ...mediaExtra(first) };

		// کپشن سقف ۱۰۲۴ کاراکتر دارد؛ باقی متن در پیام بعدی می‌آید (نه اینکه گم شود)
		const captionParts = first.text && first.text.trim() ? splitTextWithEntities(first.text, entityList(first), MAX_CAPTION_LENGTH) : [];
		const caption = captionParts[0];
		if (caption) {
			other.caption = caption.text;
			if (caption.entities.length > 0) other.caption_entities = caption.entities;
		}

		const plan: SingleStepPlan = { method, args: [targetChannelId, ref, other], items: 1 };
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

	// تلگرام در آلبوم فقط کپشنِ **اولین** آیتم را نشان می‌دهد؛ کپشن آیتم‌های بعدی
	// هرگز دیده نمی‌شود ولی سرور آن‌ها را پردازش می‌کند: هر لینکی که در آن‌ها باشد
	// یعنی یک تلاش تازه برای ساختن پیش‌نمایش، و اگر تلگرام نتواند آن را بگیرد،
	// پاسخ `WEBPAGE_CURL_FAILED` می‌دهد و **کل آلبوم** رد می‌شود. پس کپشن را فقط
	// روی آیتم اول می‌نشانیم — همان کاری که در مسیر پولینگ وب (`pollSources.js`)
	// هنگام ذخیره‌ی پست انجام می‌شود.
	//
	// اگر آیتم اول متنی نداشته باشد، اولین کپشنِ غیرخالی را بالا می‌کشیم تا متن
	// پست بی‌دلیل گم نشود.
	const captionSource = items.find((item) => (item.text ?? '').trim().length > 0) ?? null;
	const captionParts = captionSource?.text ? splitTextWithEntities(captionSource.text, entityList(captionSource), MAX_CAPTION_LENGTH) : [];
	const albumCaption = captionParts[0] ?? null;

	const media = items.map((item, index) => {
		const type = item.kind === 'video' ? 'video' : item.kind === 'document' ? 'document' : 'photo';
		const entry: Record<string, unknown> = { type, media: mediaRef(item) };
		if (index === 0 && albumCaption) {
			// سقف کپشن ۱۰۲۴ است؛ بیشتر از آن در پیام جدا نمی‌گنجد
			entry.caption = albumCaption.text;
			if (albumCaption.entities.length > 0) entry.caption_entities = albumCaption.entities;
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

/** یک آیتم آلبوم در قالب `InputMedia*` تلگرام */
interface AlbumMediaEntry {
	type: string;
	media: string;
	caption?: string;
	caption_entities?: unknown[];
	width?: number;
	height?: number;
	duration?: number;
	supports_streaming?: boolean;
}

/**
 * خطاهایی که یعنی تلگرام نتوانست یک URL را خودش بگیرد.
 *
 * `WEBPAGE_CURL_FAILED` معروف‌ترینِ آن‌هاست: سرور تلگرام سراغ URL رفته (برای
 * دانلود رسانه یا ساختن پیش‌نمایش لینک) و شکست خورده — معمولاً ۴۰۳ یا تایم‌اوت
 * برای User-Agentِ خودش. کدش ۴۰۰ است، پس در حلقه‌ی انتشار «غیرقابل تلاش مجدد»
 * حساب می‌شود و پست برای همیشه می‌شکست.
 */
const UNFETCHABLE_URL_ERRORS = /WEBPAGE_(CURL_FAILED|MEDIA_EMPTY|NOT_FOUND|URL_INVALID)/i;

export function isUnfetchableUrlError(message: string | null): boolean {
	return message !== null && UNFETCHABLE_URL_ERRORS.test(message);
}

/** مرجعی که تلگرام باید خودش از اینترنت بگیرد (یعنی `file_id` نیست) */
function isUrlOnlyRef(ref: string): boolean {
	return /^https?:\/\//i.test(ref);
}

/** شماره‌ی آیتمی که تلگرام در پیام خطا نام برده: `failed to send message #4` */
function failedItemIndex(message: string | null): number | null {
	const match = message?.match(/message #(\d+)/i);
	if (!match) return null;
	const index = Number(match[1]) - 1;
	return Number.isInteger(index) && index >= 0 ? index : null;
}

/** رونوشت یک آیتم آلبوم بدون کپشن (کپشن بعداً فقط روی آیتم اول می‌نشیند) */
function withoutCaption(entry: AlbumMediaEntry): AlbumMediaEntry {
	const next: AlbumMediaEntry = { type: entry.type, media: entry.media };
	if (typeof entry.width === 'number') next.width = entry.width;
	if (typeof entry.height === 'number') next.height = entry.height;
	if (typeof entry.duration === 'number') next.duration = entry.duration;
	if (typeof entry.supports_streaming === 'boolean') next.supports_streaming = entry.supports_streaming;
	return next;
}

/** تنظیمات رسانه برای ارسال تک‌رسانه (آرگومان سوم متدهای `send*`) */
function mediaOptions(entry: AlbumMediaEntry): Record<string, unknown> {
	const other: Record<string, unknown> = {};
	if (typeof entry.width === 'number') other.width = entry.width;
	if (typeof entry.height === 'number') other.height = entry.height;
	if (typeof entry.duration === 'number') other.duration = entry.duration;
	if (typeof entry.supports_streaming === 'boolean') other.supports_streaming = entry.supports_streaming;
	return other;
}

/**
 * نقشه‌ی جایگزین برای وقتی که تلگرام یکی از آیتم‌های آلبوم را نتوانست بگیرد:
 * همان آلبوم، بدون آن آیتم.
 *
 * چرا؟ تلگرام آلبوم را یک‌جا می‌فرستد؛ اگر نتواند یکی از آیتم‌ها را بگیرد،
 * هیچ‌کدام منتشر نمی‌شوند. یعنی یک لینکِ خراب، سه عکسِ سالم را هم می‌کشد.
 *
 * کدام آیتم حذف می‌شود؟
 *   ۱. همانی که تلگرام در پیام خطا نام برده (`message #4`)؛
 *   ۲. وگرنه همه‌ی آیتم‌هایی که فقط URL دارند (مرجعشان `file_id` نیست، پس
 *      تلگرام باید خودش دانلود کند — دقیقاً همان‌جایی که ممکن است شکست بخورد).
 *
 * @returns نقشه‌ی تازه، یا `null` اگر کوتاه‌کردن ممکن نباشد (تک‌رسانه، آلبومی
 *   که هیچ آیتم URL-محور ندارد، یا آلبومی که با حذف چیزی از آن نمی‌ماند)
 */
export function albumWithoutFailingItem(plan: PublishPlan, errorMessage: string | null): SingleStepPlan | null {
	if (plan.method !== 'sendMediaGroup') return null;
	const [chatId, media] = plan.args;
	if (typeof chatId !== 'number' || !Array.isArray(media)) return null;

	const entries: AlbumMediaEntry[] = [];
	for (const entry of media) {
		if (typeof entry !== 'object' || entry === null) return null;
		const candidate = entry as { type?: unknown; media?: unknown };
		if (typeof candidate.type !== 'string' || typeof candidate.media !== 'string') return null;
		entries.push(entry as AlbumMediaEntry);
	}
	if (entries.length < 2) return null;

	// فقط آیتم‌هایی حذف می‌شوند که مرجعشان URL است. چرا؟ آیتمی که `file_id` دارد
	// نیازی به دانلود ندارد، پس اگر تلگرام خطای WEBPAGE داده، تقصیرِ آن آیتم
	// نبوده (مثلاً پیش‌نمایشِ لینکی داخل کپشن بوده) و حذفش یعنی از دست رفتن
	// محتوایی که تلگرام می‌توانسته تحویل بدهد.
	const named = failedItemIndex(errorMessage);
	const drop = new Set<number>();
	if (named !== null && named < entries.length && isUrlOnlyRef(entries[named]!.media)) {
		drop.add(named);
	} else {
		entries.forEach((entry, index) => {
			if (isUrlOnlyRef(entry.media)) drop.add(index);
		});
	}
	if (drop.size === 0) return null;

	// کپشن ممکن است روی همان آیتمی بوده باشد که حذف می‌شود؛ نگهش می‌داریم تا
	// متن پست همراهِ رسانه گم نشود.
	const captionEntry = entries.find((entry) => (entry.caption ?? '').trim().length > 0) ?? null;
	const kept = entries.filter((_, index) => !drop.has(index)).map(withoutCaption);
	if (kept.length === 0) return null;

	// یک آیتم مانده ⇒ دیگر آلبوم نیست و باید با متد تک‌رسانه فرستاده شود
	if (kept.length === 1) {
		const only = kept[0]!;
		const method = SINGLE_MEDIA_METHOD[only.type];
		if (!method) return null;
		const other = mediaOptions(only);
		if (captionEntry) {
			other.caption = captionEntry.caption;
			if (captionEntry.caption_entities) other.caption_entities = captionEntry.caption_entities;
		}
		return { method, args: [chatId, only.media, other], items: 1 };
	}

	if (captionEntry) {
		kept[0]!.caption = captionEntry.caption;
		if (captionEntry.caption_entities) kept[0]!.caption_entities = captionEntry.caption_entities;
	}
	return { method: 'sendMediaGroup', args: [chatId, kept, {}], items: kept.length };
}

/** استخراج کد/متن خطای تلگرام به شکل یکسان */
export function describeTelegramError(err: unknown): { message: string; code: number | null } {
	const anyErr = err as { description?: string; message?: string; error_code?: number; name?: string } | null;
	const message = anyErr?.description || anyErr?.message || (anyErr?.name ? String(anyErr.name) : '') || 'خطای نامشخص تلگرام';
	const code = typeof anyErr?.error_code === 'number' ? anyErr.error_code : null;
	return { message, code };
}

/**
 * اجرای نقشه روی کلاینت. خطاها گرفته و به شکل ساختاری برگردانده می‌شوند
 * تا حلقه‌ی کرون هرگز با یک پست خراب متوقف نشود.
 */
export async function executePublishPlan(api: PublisherApi, plan: PublishPlan): Promise<PublishResult> {
	if (plan.method === 'unsupported') {
		return { ok: false, messageId: null, error: plan.reason, errorCode: null, note: null };
	}

	// چند پیام: اگر یکی شکست بخورد، همان شکست برگردانده می‌شود تا ادمین بداند
	// پست ناقص منتشر شده (نسبت به سکوت، صادقانه‌تر است).
	if (plan.method === 'sequence') {
		let firstId: number | null = null;
		for (const step of plan.steps) {
			const result = await executePlanOnce(api, step);
			if (!result.ok) {
				return { ok: false, messageId: firstId, error: result.error, errorCode: result.errorCode, note: result.note };
			}
			if (firstId === null) firstId = result.messageId;
		}
		return { ok: firstId !== null, messageId: firstId, error: null, errorCode: null, note: null };
	}

	const result = await executePlanOnce(api, plan);

	// تلگرام نتوانسته یکی از آیتم‌ها را بگیرد ⇒ همان آلبوم بدون آن آیتم.
	// فقط یک بار: اگر باز هم شکست خورد، خطا به همان شکل قبل برمی‌گردد تا پست
	// طبق روال «غیرقابل تلاش مجدد» ثبت شود و ادمین خبر دار شود.
	if (!result.ok && isUnfetchableUrlError(result.error)) {
		const shorter = albumWithoutFailingItem(plan, result.error);
		if (shorter) {
			console.warn('[postPublisher] Telegram could not fetch an album item; retrying without it:', result.error);
			const retried = await executePlanOnce(api, shorter);
			if (retried.ok) {
				const dropped = plan.items - shorter.items;
				return {
					...retried,
					note: `${toPersianDigits(dropped)} آیتم از آلبوم منتشر نشد، چون تلگرام نتوانست آن را دریافت کند.`,
				};
			}
			return retried;
		}
	}

	return result;
}

async function executePlanOnce(api: PublisherApi, plan: SingleStepPlan): Promise<PublishResult> {
	try {
		const fn = (api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[plan.method];
		if (typeof fn !== 'function') {
			return { ok: false, messageId: null, error: `متد ${plan.method} در کلاینت موجود نیست.`, errorCode: null, note: null };
		}
		const result = (await fn.apply(api, plan.args)) as { message_id?: number } | Array<{ message_id?: number }>;
		const messageId = Array.isArray(result) ? (result[0]?.message_id ?? null) : (result?.message_id ?? null);
		return { ok: true, messageId: messageId === null ? null : Number(messageId), error: null, errorCode: null, note: null };
	} catch (err) {
		const { message, code } = describeTelegramError(err);
		return { ok: false, messageId: null, error: message, errorCode: code, note: null };
	}
}

/** میان‌بر: نقشه + اجرا */
export async function publishPost(api: PublisherApi, post: QueuePost, targetChannelId: number) {
	const plan = buildPublishPlan(post, targetChannelId);
	return executePublishPlan(api, plan);
}
