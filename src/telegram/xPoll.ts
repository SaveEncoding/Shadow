/**
 * پولر حساب‌های X.
 *
 * چرا «هر دقیقه» نیست؟ X از ۲۰۲۶ پرداخت به‌ازای مصرف دارد (~۰.۰۰۵ دلار برای هر
 * پست خوانده‌شده). خواندن هر حساب هر دقیقه یعنی ۱۴۴۰ خواندن در روز برای هر منبع.
 * پس:
 *   - حداقل فاصله‌ی بین دو خواندن هر منبع `MIN_X_POLL_SECONDS` است (پیش‌فرض ۵ دقیقه).
 *   - هر بار فقط `max_results=5` و با `since_id` خوانده می‌شود (فقط پست‌های تازه).
 *   - شناسه‌ی عددی کاربر در D1 کش می‌شود تا lookup حساب هر بار پول نخورد.
 *   - بعد از چند خطای پیاپی، منبع با backoff کنار گذاشته می‌شود.
 *
 * خروجی این فایل همان «پست در صف» است: از آن به بعد تأخیر/ویرایش/لغو/انتشار
 * دقیقاً مثل بقیه‌ی منابع کار می‌کند.
 */

import type { SourceRule } from '../core/schedule/types.js';
import { MAX_X_IMAGES, normalizeXHandle, xItemKey } from '../core/sources/x.js';
import { DEFAULT_NETWORK_CONCURRENCY, mapLimit } from '../core/util/concurrency.js';
import { markMessageSeen, recordXPollResult, type XSourceRow } from './db/postQueue.js';
import { queueExternalPost, type QueueEntry } from './queueExternalPost.js';
import { spoolMedia } from './mediaSpool.js';
import type { SchedulerApi } from './publishQueue.js';
import { fetchXTimeline, resolveXProvider, type XProvider } from './xSource.js';

/** حداقل فاصله‌ی بین دو خواندن یک حساب X (کنترل هزینه و نرخ) */
export const MIN_X_POLL_SECONDS = 5 * 60;

/** بعد از این تعداد خطای پیاپی، منبع موقتاً کنار گذاشته می‌شود */
export const MAX_X_FAILURES = 3;

/** مدت کنار گذاشتن منبع خطادار */
export const X_BACKOFF_SECONDS = 20 * 60;

/** حداکثر پست تازه‌ای که از یک حساب در هر خواندن وارد صف می‌شود */
export const MAX_X_POSTS_PER_TICK = 2;

/** حداکثر حسابی که در یک تیک کرون بررسی می‌شود (بقیه در دقیقه‌ی بعد) */
export const MAX_X_SOURCES_PER_TICK = 5;

export type XPollDeps = {
	db: D1Database;
	api: SchedulerApi;
	now: number;
	provider: XProvider;
	fetchImpl?: typeof fetch;
};

export type XPollOutcome = {
	ruleId: number;
	handle: string;
	queued: number;
	skipped: number;
	error: string | null;
};

/** آیا این منبع در این دقیقه باید خوانده شود؟ */
export function shouldPollX(row: XSourceRow, now: number): boolean {
	const last = row.lastPolledAt;
	if (last !== null && now - last < MIN_X_POLL_SECONDS) return false;
	if (row.failures >= MAX_X_FAILURES && last !== null && now - last < X_BACKOFF_SECONDS) return false;
	return true;
}

/**
 * آیا در این پست ویدیویی بود که نتواستیم برداریم؟
 * (X فقط HLS می‌دهد و تلگرام از لینک m3u8 فایل نمی‌سازد)
 */
function videoDropped(post: { videoDropped?: boolean }): boolean {
	return post.videoDropped === true;
}

/** برداشتن پست‌های تازه‌ی یک حساب X و ریختنشان در صف */
export async function pollOneXSource(deps: XPollDeps, row: XSourceRow & { rule: SourceRule }): Promise<XPollOutcome> {
	const { db, now } = deps;
	const outcome: XPollOutcome = { ruleId: row.ruleId, handle: row.handle, queued: 0, skipped: 0, error: null };

	if (deps.provider.kind === 'none') {
		return { ...outcome, error: 'X پیکربندی نشده است (X_BEARER_TOKEN یا X_RSS_TEMPLATE).' };
	}

	const feed = await fetchXTimeline({
		handle: row.handle,
		sinceId: row.cursorId,
		fetchImpl: deps.fetchImpl,
		provider: deps.provider,
		userId: row.userId,
	});

	if (feed.ok !== true) {
		const error = feed.error ?? 'خطای نامشخص در خواندن X';
		await recordXPollResult(db, { ruleId: row.ruleId, now, error });
		return { ...outcome, error };
	}

	const posts = feed.posts ?? [];
	const cursor = feed.cursor ?? row.cursorId;

	// اولین بار (بدون کِرسر): فقط کِرسر را تنظیم می‌کنیم تا آرشیو حساب سرازیر نشود
	if (!row.cursorId) {
		await recordXPollResult(db, { ruleId: row.ruleId, now, cursorId: cursor, userId: feed.userId ?? null });
		return outcome;
	}

	let processed = 0;
	for (const post of posts) {
		if (processed >= MAX_X_POSTS_PER_TICK) break;
		processed++;

		const result = await captureXPost(deps, row, post);
		if (result === 'queued') outcome.queued++;
		else if (result === 'skipped') outcome.skipped++;
	}

	await recordXPollResult(db, { ruleId: row.ruleId, now, cursorId: cursor, userId: feed.userId ?? null });
	return outcome;
}

async function captureXPost(
	deps: XPollDeps,
	row: XSourceRow & { rule: SourceRule },
	post: {
		externalId: string;
		text: string;
		url: string;
		media: Array<{ kind: 'photo' | 'video'; url: string; width?: number | null; height?: number | null }>;
		unsupported: string | null;
		videoDropped?: boolean;
	},
): Promise<'queued' | 'skipped' | 'duplicate'> {
	const { db, api, now } = deps;

	// همان محافظ همه‌ی منابع: هر پست مبدأ فقط یک بار
	const firstKey = xItemKey(post.externalId, 0);
	if (!(await markMessageSeen(db, row.rule.sourceChannelId, firstKey, now))) return 'duplicate';

	const photos = post.media.filter((asset) => asset.kind === 'photo').slice(0, MAX_X_IMAGES);
	const hasVideo = videoDropped(post);

	// متن: همان متن کامل توییت؛ اگر ویدیو جا افتاده، لینک اصل پست هم می‌آید
	// تا محتوا «به‌طور کامل» در دسترس مخاطب باشد.
	let text = post.text.trim();
	if (hasVideo) {
		text = text ? `${text}\n\n🎬 ویدیو: ${post.url}` : `🎬 ویدیو: ${post.url}`;
	}

	if (!text && photos.length === 0) return 'skipped';

	const items: QueueEntry[] = [];

	if (photos.length === 0) {
		items.push({
			item: {
				sourceMessageId: firstKey,
				kind: 'text',
				fileId: null,
				text,
				entities: null,
				extra: null,
			},
			patch: null,
		});
	} else {
		for (const [index, photo] of photos.entries()) {
			const spooled = await spoolMedia(api, row.rule.notifyChatId, photo.url, 'photo');
			items.push({
				item: {
					sourceMessageId: xItemKey(post.externalId, index),
					kind: 'photo',
					fileId: spooled?.fileId ?? null,
					// متن روی اولین عکس می‌نشیند (مثل خود X)
					text: index === 0 ? text || null : null,
					entities: null,
					extra: { sourceUrl: photo.url, width: photo.width ?? undefined, height: photo.height ?? undefined },
				},
				patch: {
					sourceUrl: photo.url,
					width: spooled?.width ?? photo.width ?? undefined,
					height: spooled?.height ?? photo.height ?? undefined,
				},
			});
		}
	}

	return queueExternalPost(
		db,
		api,
		{
			sourceChannelId: row.rule.sourceChannelId,
			sourceTitle: row.rule.sourceTitle,
			sourceUsername: row.handle,
			targetChannelId: row.rule.targetChannelId,
			createdBy: row.rule.notifyChatId ?? row.rule.addedBy,
			delayMinutes: row.rule.delayMinutes,
		},
		items,
		now,
	);
}

/** خواندن همه‌ی منابع X فعال (از کرون دقیقه‌ای صدا زده می‌شود) */
export async function pollDueXSources(
	env: { my_database: D1Database },
	options: {
		api: SchedulerApi;
		now: number;
		sources: Array<XSourceRow & { rule: SourceRule }>;
		provider?: XProvider;
		fetchImpl?: typeof fetch;
		xEnv?: { X_BEARER_TOKEN?: string; X_RSS_TEMPLATE?: string };
	},
): Promise<{ polled: number; queued: number; skipped: number; failed: number }> {
	const provider = options.provider ?? resolveXProvider(options.xEnv ?? {});
	const result = { polled: 0, queued: 0, skipped: 0, failed: 0 };

	// بدون کلید/پل، هر دقیقه یک خطای تکراری در لاگ نمی‌نویسیم — فقط ساکت رد می‌شویم
	if (provider.kind === 'none') return result;

	const due = options.sources.slice(0, MAX_X_SOURCES_PER_TICK).filter((source) => shouldPollX(source, options.now));

	// حداکثر ۳ حساب هم‌زمان (زیر سقف ۶ اتصال باز هم‌زمان Workers).
	const outcomes = await mapLimit(due, DEFAULT_NETWORK_CONCURRENCY, async (source) => {
		try {
			const outcome = await pollOneXSource(
				{ db: env.my_database, api: options.api, now: options.now, provider, fetchImpl: options.fetchImpl },
				source,
			);
			return { outcome, error: null };
		} catch (err) {
			// یک حساب خراب نباید بقیه و انتشار را متوقف کند
			console.error(`[xPoll] source ${source.handle} crashed:`, err);
			await recordXPollResult(env.my_database, {
				ruleId: source.ruleId,
				now: options.now,
				error: (err as Error)?.message ?? 'خطای نامشخص',
			}).catch(() => undefined);
			return { outcome: null, error: err };
		}
	});

	for (const { outcome, error } of outcomes) {
		if (error || !outcome) {
			result.failed++;
			continue;
		}
		result.polled++;
		result.queued += outcome.queued;
		result.skipped += outcome.skipped;
		if (outcome.error) result.failed++;
	}

	if (result.queued || result.failed) {
		console.log(`[xPoll] polled=${result.polled} queued=${result.queued} failed=${result.failed}`);
	}

	return result;
}

/** فقط برای تست: نرمال‌سازی handle از همان مسیر تولید */
export { normalizeXHandle };
