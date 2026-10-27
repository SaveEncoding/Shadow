/**
 * منبع‌هایی که بات در آن‌ها عضو/ادمین نیست.
 *
 * Bot API اجازه‌ی خواندن کانال بدون عضویت نمی‌دهد (بات‌ها نمی‌توانند عضو شوند و
 * تاریخچه فقط در MTProto است). پس این مسیر از **پیش‌نمایش عمومی وب تلگرام**
 * (`t.me/s/<username>`) می‌خواند و همان صف انتشار معمول را پر می‌کند؛ از آن به بعد
 * همه‌چیز (تأخیر، ویرایش، لغو، ضدپست‌تکراری) مثل حالت ادمین کار می‌کند.
 *
 * محدودیت‌هایی که باید در UI گفته شود:
 *   - فقط کانال عمومی (دارای @username)
 *   - فقط آخرین ~۲۰ پست هر بار خواندن
 *   - عکس/ویدیوی کوچک و متن بله؛ فایل، ویس، استیکر و نظرسنجی خیر
 */

import { ALBUM_GRACE_SECONDS, MAX_PUBLISH_PER_TICK, computePublishAt, retryDelaySeconds } from '../core/schedule/timing.js';
import type { PostItem } from '../core/schedule/types.js';
import { MAX_FEED_MEDIA, type FeedPost } from '../core/schedule/publicFeed.js';
import { appendItem, createQueuedPost, finalizePost, markMessageSeen, recordPollResult } from './db/postQueue.js';
import { fetchPublicFeed } from './publicFeed.js';
import type { SchedulerApi } from './publishQueue.js';
import { notifyQueued } from './publishQueue.js';
import type { PollSourceRow } from './db/postQueue.js';
import type { SourceRule } from '../core/schedule/types.js';

/** حداکثر تعداد پست تازه‌ای که در یک اجرا از هر منبع برداشته می‌شود */
export const MAX_POSTS_PER_POLL = 2;

/** بعد از این تعداد خطای پشت‌سرهم، منبع موقتاً کنار گذاشته می‌شود */
export const MAX_POLL_FAILURES = 3;

/** منبع با خطا را تا این مدت دوباره امتحان نکنیم */
export const POLL_BACKOFF_SECONDS = 15 * 60;

export type PollDeps = {
	db: D1Database;
	api: SchedulerApi;
	now: number;
	/** تزریق‌پذیر برای تست */
	fetchImpl?: typeof fetch;
};

export type PollOutcome = {
	ruleId: number;
	username: string;
	/** چند پست تازه در صف نشست */
	queued: number;
	/** چند پست پشتیبانی نشد (نظرسنجی/فایل/…) */
	skipped: number;
	error: string | null;
};

/** آیا این منبع در این تیک باید خوانده شود؟ (backoff پلکانی برای خطاها) */
export function shouldPoll(row: PollSourceRow, now: number): boolean {
	if (row.failures < MAX_POLL_FAILURES) return true;
	if (row.lastPolledAt === null) return true;
	return now - row.lastPolledAt >= POLL_BACKOFF_SECONDS;
}

/**
 * برداشتن پست‌های تازه‌ی یک منبع عمومی و ریختنشان در صف.
 */
export async function pollOneSource(
	deps: PollDeps,
	row: PollSourceRow & { rule: SourceRule },
): Promise<PollOutcome> {
	const { db, now } = deps;
	const outcome: PollOutcome = { ruleId: row.ruleId, username: row.username, queued: 0, skipped: 0, error: null };

	const feed = await fetchPublicFeed(row.username, { fetchImpl: deps.fetchImpl });
	if (feed.ok === false) {
		await recordPollResult(db, { ruleId: row.ruleId, now, error: feed.error });
		return { ...outcome, error: feed.error };
	}

	const posts = /** @type {FeedPost[]} */ (feed.posts).filter((post) => post.messageId > row.cursorMessageId);
	const highestSeen = feed.posts.reduce((max, post) => Math.max(max, post.messageId), row.cursorMessageId);

	if (posts.length === 0) {
		await recordPollResult(db, { ruleId: row.ruleId, now, cursorMessageId: highestSeen });
		return outcome;
	}

	// اولین بار: فقط کِرسر را تنظیم می‌کنیم تا آرشیو کانال یک‌جا سرازیر نشود
	if (row.cursorMessageId === 0) {
		await recordPollResult(db, { ruleId: row.ruleId, now, cursorMessageId: highestSeen });
		return outcome;
	}

	let cursor = row.cursorMessageId;
	const batch = posts.slice(0, MAX_POSTS_PER_POLL);

	for (const post of batch) {
		cursor = Math.max(cursor, post.messageId);

		if (post.unsupported) {
			outcome.skipped++;
			continue;
		}

		const result = await captureFeedPost(deps, row, post);
		if (result === 'queued') outcome.queued++;
		else if (result === 'skipped') outcome.skipped++;
	}

	await recordPollResult(db, { ruleId: row.ruleId, now, cursorMessageId: cursor });
	return outcome;
}

/**
 * کلید یکتای هر رسانه در یک پست وب.
 *
 * در تلگرام هر آیتم آلبوم `message_id` جدا دارد؛ در پیش‌نمایش وب همه‌ی رسانه‌های
 * یک پست یک شناسه دارند. برای اینکه کلید اصلی `post_queue_items` تکراری نشود،
 * شماره‌ی رسانه را در انتهای شناسه می‌گذاریم (ترتیب هم حفظ می‌شود).
 */
export function feedItemKey(messageId: number, index: number): number {
	return messageId * 1000 + index;
}

/** برگشت از کلید آیتم به شناسه‌ی پیام اصلی (برای ساخت لینک t.me) */
export function feedMessageIdFromKey(key: number): number {
	return Math.floor(Math.abs(key) / 1000);
}

/** لینک عمومی پست در کانال وب (برای «پیش‌نمایش اصل پست») */
export function feedPostLink(username: string, itemKey: number): string {
	return `https://t.me/${username.replace(/^@/, '')}/${feedMessageIdFromKey(itemKey)}`;
}

/** تبدیل یک پست وب به آیتم‌های صف (با گرفتن file_id از تلگرام اگر ممکن باشد) */
async function captureFeedPost(
	deps: PollDeps,
	row: PollSourceRow & { rule: SourceRule },
	post: FeedPost,
): Promise<'queued' | 'skipped' | 'duplicate'> {
	const { db, api, now } = deps;
	const sourceChannelId = row.rule.sourceChannelId;

	// همان محافظ حالت ادمین: هر پیام مبدأ فقط یک بار
	if (!(await markMessageSeen(db, sourceChannelId, post.messageId, now))) return 'duplicate';

	const media = post.media.slice(0, MAX_FEED_MEDIA);
	const items: PostItem[] = [];
	const extraPatches: Array<Record<string, unknown> | null> = [];

	if (media.length === 0) {
		if (!post.text.trim()) return 'skipped';
		items.push({
			sourceMessageId: post.messageId,
			kind: 'text',
			fileId: null,
			text: post.text,
			entities: post.entities,
			extra: null,
		});
		extraPatches.push(null);
	} else {
		for (const [index, asset] of media.entries()) {
			const spooled = await spoolMedia(api, row.rule.notifyChatId, asset.url, asset.kind);
			items.push({
				// هر رسانه‌ی یک پست وب باید کلید یکتا داشته باشد (کلید اصلی جدول آیتم‌هاست)
				sourceMessageId: feedItemKey(post.messageId, index),
				kind: asset.kind,
				fileId: spooled?.fileId ?? null,
				text: null,
				entities: null,
				// اگر file_id نگرفتیم، زمان انتشار خود URL را می‌فرستیم
				extra: { sourceUrl: asset.url },
			});
			extraPatches.push({ sourceUrl: asset.url, width: spooled?.width, height: spooled?.height });
		}

		// متن/کپشن روی آیتم اول می‌نشیند (مثل پست اصلی تلگرام)
		if (post.text.trim()) {
			items[0].text = post.text;
			items[0].entities = post.entities;
		}
	}

	const postId = await createQueuedPost(db, {
		sourceChannelId,
		sourceTitle: row.rule.sourceTitle,
		sourceUsername: row.rule.sourceUsername ?? row.username,
		targetChannelId: row.rule.targetChannelId,
		mediaGroupId: null,
		createdBy: row.rule.notifyChatId ?? row.rule.addedBy,
		now,
	});

	let appended = 0;
	for (let index = 0; index < items.length; index++) {
		const ok = await appendItem(db, postId, items[index], now, now + ALBUM_GRACE_SECONDS, extraPatches[index]);
		if (ok) appended++;
	}
	if (appended === 0) return 'skipped';

	const publishAt = computePublishAt(now, row.rule.delayMinutes);
	if (!(await finalizePost(db, postId, publishAt, now))) return 'skipped';

	await notifyQueued(api, db, postId, now);
	return 'queued';
}

type SpoolResult = { fileId: string; width?: number; height?: number };

/**
 * گرفتن `file_id` پایدار برای یک رسانه‌ی وب.
 *
 * ترفند: فایل را به چت خصوصی ادمین می‌فرستیم و بلافاصله پاک می‌کنیم؛ تلگرام در
 * پاسخ، `file_id` می‌دهد. مزیتش این است که اگر لینک وب منقضی شود، انتشار خراب نمی‌شود.
 * اگر این کار نشد (چت ادمین در دسترس نیست/خطا)، `null` برمی‌گردد و انتشار با URL
 * انجام می‌شود — پس در هر حال پست از دست نمی‌رود.
 */
async function spoolMedia(
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

		// پاک‌کردن فورى پیام موقت، تا چت ادمین شلوغ نشود
		try {
			await (api as unknown as { deleteMessage(chatId: number, messageId: number): Promise<unknown> }).deleteMessage(
				chatId,
				raw.message_id,
			);
		} catch {
			/* پاک نشد هم مهم نیست */
		}

		return fileId ? { fileId, width, height } : null;
	} catch (err) {
		console.warn('[pollSources] spool failed, falling back to URL:', (err as Error)?.message);
		return null;
	}
}

/**
 * خواندن همه‌ی منابع عمومی فعال (از کرون دقیقه‌ای صدا زده می‌شود).
 */
export async function pollDueSources(
	env: { my_database: D1Database },
	options: { api: SchedulerApi; now: number; fetchImpl?: typeof fetch; sources: Array<PollSourceRow & { rule: SourceRule }> },
): Promise<{ polled: number; queued: number; skipped: number; failed: number }> {
	let polled = 0;
	let queued = 0;
	let skipped = 0;
	let failed = 0;

	for (const source of options.sources.slice(0, MAX_PUBLISH_PER_TICK)) {
		if (!shouldPoll(source, options.now)) continue;

		try {
			const outcome = await pollOneSource(
				{ db: env.my_database, api: options.api, now: options.now, fetchImpl: options.fetchImpl },
				source,
			);
			polled++;
			queued += outcome.queued;
			skipped += outcome.skipped;
			if (outcome.error) failed++;
		} catch (err) {
			// یک منبع خراب نباید بقیه را متوقف کند
			console.error(`[pollSources] source ${source.username} crashed:`, err);
			failed++;
			await recordPollResult(env.my_database, {
				ruleId: source.ruleId,
				now: options.now,
				error: (err as Error)?.message ?? 'خطای نامشخص',
			}).catch(() => undefined);
		}
	}

	if (queued || failed) {
		console.log(`[pollSources] polled=${polled} queued=${queued} skipped=${skipped} failed=${failed}`);
	}

	return { polled, queued, skipped, failed };
}

/** بازه‌ی تلاش مجدد برای نمایش در UI */
export function pollBackoffLabel(): string {
	return `${Math.round(retryDelaySeconds(1) / 60)} دقیقه`;
}
