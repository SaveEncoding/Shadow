/**
 * گرفتن `file_id` پایدار برای یک رسانه‌ی وب (تلگرام یا X).
 *
 * ترفند: فایل را به چت خصوصی ادمین می‌فرستیم و بلافاصله پاک می‌کنیم؛ تلگرام در
 * پاسخ، `file_id` می‌دهد. مزیتش این است که اگر لینک منبع بعداً منقضی/مسدود شود،
 * انتشار خراب نمی‌شود. اگر این کار نشد (`null`)، انتشار با خود URL انجام می‌شود.
 */

import type { SchedulerApi } from './publishQueue.js';

export type SpoolResult = { fileId: string; width?: number; height?: number };

export async function spoolMedia(
	api: SchedulerApi,
	chatId: number | null,
	url: string,
	kind: 'photo' | 'video',
): Promise<SpoolResult | null> {
	if (!chatId) return null;

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

		return fileId ? { fileId, width, height } : null;
	} catch (err) {
		console.warn('[mediaSpool] spool failed, falling back to URL:', (err as Error)?.message);
		return null;
	}
}
