/**
 * مسیر مشترک «پست بیرونی → صف».
 *
 * منابع بیرونی (پیش‌نمایش وب تلگرام، پل RSS/X) هر کدام شکل خودشان را دارند ولی
 * انتهای کار یکی است: ساختن پست، افزودن آیتم‌ها، نهایی‌کردن و اطلاع‌دادن.
 * قبلاً همین پنج مرحله در `pollSources.ts` و `xPoll.ts` کپی شده بود و هر تغییر
 * (مثلاً محافظ آلبوم) باید در دو جا اعمال می‌شد.
 */

import { ALBUM_GRACE_SECONDS, computePublishAt } from '../core/schedule/timing.js';
import type { PostItem } from '../core/schedule/types.js';
import { appendItem, createQueuedPost, finalizePost } from './db/postQueue.js';
import { notifyQueued, type SchedulerApi } from './publishQueue.js';

/** یک آیتم آماده‌ی صف، به‌همراه وصله‌ای که بعد از گرفتن `file_id` روی ردیف می‌نشیند */
export interface QueueEntry {
	item: PostItem;
	/** فیلدهای اضافی ردیف آیتم (مثلاً ابعاد یا URL مبدأ)؛ `null` یعنی چیزی نیست */
	patch?: Record<string, unknown> | null;
}

/** همان چیزهایی که هر دو منبع باید بدانند تا صف ساخته شود */
export interface ExternalPostSource {
	sourceChannelId: number;
	sourceTitle: string | null;
	sourceUsername: string | null;
	targetChannelId: number;
	createdBy: number;
	/** تأخیر قانون (دقیقه)؛ با `computePublishAt` به زمان انتشار تبدیل می‌شود */
	delayMinutes: number;
}

/**
 * پست و آیتم‌هایش را می‌سازد و اطلاع‌رسانی می‌کند.
 *
 * @returns `'queued'` اگر چیزی ثبت شد، `'skipped'` اگر هیچ آیتمی ثبت نشد
 */
export async function queueExternalPost(
	db: D1Database,
	api: SchedulerApi,
	source: ExternalPostSource,
	entries: readonly QueueEntry[],
	now: number,
): Promise<'queued' | 'skipped'> {
	const postId = await createQueuedPost(db, {
		sourceChannelId: source.sourceChannelId,
		sourceTitle: source.sourceTitle,
		sourceUsername: source.sourceUsername,
		targetChannelId: source.targetChannelId,
		mediaGroupId: null,
		createdBy: source.createdBy,
		now,
	});

	let appended = 0;
	for (const entry of entries) {
		const ok = await appendItem(db, postId, entry.item, now, now + ALBUM_GRACE_SECONDS, entry.patch ?? undefined);
		if (ok) appended++;
	}
	if (appended === 0) return 'skipped';

	const publishAt = computePublishAt(now, source.delayMinutes);
	if (!(await finalizePost(db, postId, publishAt, now))) return 'skipped';

	await notifyQueued(api, db, postId, now);
	return 'queued';
}
