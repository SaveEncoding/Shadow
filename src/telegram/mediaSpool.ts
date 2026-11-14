/**
 * گرفتن `file_id` پایدار برای یک رسانه‌ی وب (تلگرام یا X).
 *
 * ترفند: فایل را به چت خصوصی ادمین می‌فرستیم و بلافاصله پاک می‌کنیم؛ تلگرام در
 * پاسخ، `file_id` می‌دهد. مزیتش این است که اگر لینک منبع بعداً منقضی/مسدود شود،
 * انتشار خراب نمی‌شود. اگر این کار نشد (`null`)، انتشار با خود URL انجام می‌شود.
 */

import type { PostItem } from '../core/schedule/types.js';
import { updateItemMedia } from './db/postQueue.js';
import type { SchedulerApi } from './publishQueue.js';

/** همان چیزی که از یک آیتم صف برای اسپول لازم داریم */
type QueueItem = Pick<PostItem, 'kind' | 'fileId' | 'sourceMessageId' | 'extra'>;

export type SpoolResult = { fileId: string; width?: number; height?: number };

/** نتیجه‌ی تلاش برای گرفتن `file_id`، **با** دلیل شکست (برای گزارش به ادمین) */
export type SpoolOutcome = { ok: true; result: SpoolResult } | { ok: false; error: string };

export function describeError(err: unknown): string {
	const anyErr = err as { description?: string; message?: string } | null;
	return anyErr?.description || anyErr?.message || 'خطای نامشخص';
}

/**
 * تلاش برای گرفتن `file_id`، همراه با دلیلِ شکست.
 *
 * چرا دلیل را برمی‌گردانیم؟ چون تا وقتی فقط `null` بود، شکستِ اسپول در یک
 * `console.warn` گم می‌شد و بعداً به شکل «تلگرام نتوانست فایل را بگیرد» در
 * لحظه‌ی انتشار بیرون می‌زد — بدون اینکه کسی بداند کدام مرحله شکست خورده.
 */
export async function spoolMediaDetailed(
	api: SchedulerApi,
	chatId: number | null,
	url: string,
	kind: 'photo' | 'video',
): Promise<SpoolOutcome> {
	if (!chatId) return { ok: false, error: 'چتی برای گرفتن file_id تنظیم نشده است.' };

	try {
		const message =
			kind === 'video'
				? await api.sendVideo(chatId, url, { disable_notification: true })
				: await api.sendPhoto(chatId, url, { disable_notification: true });

		const raw = message as unknown as {
			message_id: number;
			photo?: Array<{ file_id: string; width: number; height: number }>;
			video?: { file_id: string; width?: number; height?: number };
		};

		const pick = raw.photo?.[raw.photo.length - 1];
		const fileId = pick?.file_id ?? raw.video?.file_id;
		const width = pick?.width ?? raw.video?.width;
		const height = pick?.height ?? raw.video?.height;

		// پاک‌کردن فوری پیام موقت تا چت ادمین شلوغ نشود
		try {
			await api.deleteMessage?.(chatId, raw.message_id);
		} catch {
			/* پاک نشد هم مهم نیست */
		}

		return fileId ? { ok: true, result: { fileId, width, height } } : { ok: false, error: 'تلگرام file_id نداد.' };
	} catch (err) {
		const message = describeError(err);
		console.warn('[mediaSpool] spool failed, falling back to URL:', message);
		return { ok: false, error: message };
	}
}

export async function spoolMedia(
	api: SchedulerApi,
	chatId: number | null,
	url: string,
	kind: 'photo' | 'video',
): Promise<SpoolResult | null> {
	const outcome = await spoolMediaDetailed(api, chatId, url, kind);
	return outcome.ok ? outcome.result : null;
}

/** لینک مستقیمِ یک آیتم وب (وقتی `file_id` نداریم، تنها مرجع همین است) */
export function itemSourceUrl(item: { fileId: string | null; extra?: Record<string, unknown> | null }): string | null {
	if (item.fileId) return null;
	const url = item.extra?.sourceUrl;
	return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * پیش از انتشار: برای هر آیتمی که فقط لینک دارد، یک بارِ دیگر تلاش می‌کنیم
 * `file_id` بگیریم و آن را ذخیره کنیم.
 *
 * چرا این‌جا و نه فقط هنگامِ خواندن منبع؟ چون گرفتن `file_id` ممکن است در آن
 * لحظه به هر دلیلی (محدودیت لحظه‌ای، خطای گذرا) نشده باشد. آیتمی که فقط لینک
 * دارد در لحظه‌ی انتشار وابسته است به اینکه **سرور تلگرام بتواند همان لحظه
 * آن لینک را بگیرد**؛ اگر نشود، کل پست شکست می‌خورد (`failed to get HTTP URL
 * content`). گرفتن `file_id` درست پیش از ارسال این وابستگی را حذف می‌کند.
 *
 * @returns تعداد آیتم‌هایی که `file_id` گرفتند، و دلیلِ شکستِ اولین آیتمی که نشد
 */
export async function ensureFileIds(
	api: SchedulerApi,
	db: D1Database,
	post: { id: number; previewChatId: number | null; createdBy: number | null; items: Array<QueueItem> },
): Promise<{ spooled: number; error: string | null }> {
	const chatId = post.previewChatId ?? post.createdBy;
	let spooled = 0;
	let error: string | null = null;

	for (const item of post.items) {
		const url = itemSourceUrl(item);
		if (!url) continue;
		if (item.kind !== 'photo' && item.kind !== 'video') continue;

		const outcome = await spoolMediaDetailed(api, chatId, url, item.kind);
		if (!outcome.ok) {
			error ??= outcome.error;
			continue;
		}

		item.fileId = outcome.result.fileId;
		if (typeof outcome.result.width === 'number') item.extra = { ...(item.extra ?? {}), width: outcome.result.width };
		if (typeof outcome.result.height === 'number') item.extra = { ...(item.extra ?? {}), height: outcome.result.height };
		await updateItemMedia(db, post.id, item.sourceMessageId, outcome.result);
		spooled++;
	}

	return { spooled, error };
}
