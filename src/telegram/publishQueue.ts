/**
 * موتور انتشار: هر دقیقه اجرا می‌شود (Cron Trigger) و پست‌های سررسیده را
 * در کانال مقصد منتشر می‌کند.
 *
 * چرا کرون و نه زمان‌بندی خود تلگرام؟ چون Bot API هیچ پارامتر `schedule_date`
 * ندارد (فقط MTProto، با خطای `SCHEDULE_BOT_NOT_ALLOWED`). پس «ساعت» باید سمت ما باشد.
 *
 * سه تضمین که این فایل می‌دهد:
 *   ۱. **بدون پست تکراری**: قبل از ارسال، ردیف با یک UPDATE شرطی قفل می‌شود
 *      (`claimForPublish`). اگر two tick هم‌زمان برسند، فقط یکی قفل را می‌گیرد.
 *   ۲. **بدون توقف زنجیره**: خطای یک پست، بقیه را متوقف نمی‌کند.
 *   ۳. **پایان‌بندی آلبوم‌ها**: پستی که آیتم‌هایش هنوز می‌رسند، نهایی و زمان‌بندی می‌شود.
 */

import { Api } from 'grammy';
import {
	ALBUM_GRACE_SECONDS,
	DEFAULT_DELAY_MINUTES,
	MAX_PUBLISH_ATTEMPTS,
	MAX_PUBLISH_PER_TICK,
	SECONDS_PER_DAY,
	SECONDS_PER_MINUTE,
	STUCK_PUBLISH_SECONDS,
	retryDelaySeconds,
} from '../core/schedule/timing.js';
import type { QueuePost } from '../core/schedule/types.js';
import { getChannelByTelegramId } from './db/channels.js';
import {
	claimForPublish,
	finalizePost,
	getPost,
	getSourceRule,
	markFailed,
	markPublished,
	listReadyPosts,
	listStuckPosts,
	pruneEditSessions,
	pruneSeen,
	setPreviewMessage,
} from './db/postQueue.js';
import { describeTelegramError, executePublishPlan, buildPublishPlan, type PublisherApi } from './services/postPublisher.js';
import {
	failedNotificationText,
	postDetailKeyboard,
	publishedNotificationText,
	queuedNotificationText,
} from './ui/schedulerScreens.js';

/** کلاینتی که برای انتشار و اعلان لازم است (تزریق‌پذیر برای تست) */
export interface SchedulerApi extends PublisherApi {
	editMessageText(
		chatId: number,
		messageId: number,
		text: string,
		other?: Record<string, unknown>,
	): Promise<unknown>;
	copyMessage(chatId: number, fromChatId: number, messageId: number): Promise<{ message_id: number }>;
	answerCallbackQuery(id: string, other?: Record<string, unknown>): Promise<unknown>;
}

export function createSchedulerApi(token: string): SchedulerApi {
	return new Api(token) as unknown as SchedulerApi;
}

/** لینک عمومی پست در کانال (اگر کانال یوزرنیم داشته باشد) */
export function channelPostLink(username: string | null | undefined, messageId: number | null): string | null {
	if (!username || !messageId) return null;
	return `https://t.me/${username}/${messageId}`;
}

/**
 * ارسال/ویرایش پیام پیش‌نمایش برای ادمین.
 * اگر پیام قبلی داشته باشیم ویرایش می‌شود تا چت شلوغ نشود.
 */
export async function upsertPreview(
	api: SchedulerApi,
	db: D1Database,
	post: QueuePost,
	text: string,
	keyboard: unknown,
	now: number,
): Promise<void> {
	const chatId = post.previewChatId;
	const messageId = post.previewMessageId;
	const other = { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } };

	if (chatId && messageId) {
		try {
			await api.editMessageText(chatId, messageId, text, other);
			return;
		} catch (err) {
			// پیام حذف شده یا خیلی قدیمی است → پیام تازه می‌فرستیم
			console.warn('[publishQueue] preview edit failed, sending a new one:', err);
		}
	}

	const target = post.previewChatId ?? post.createdBy;
	if (!target) return;

	try {
		const sent = await api.sendMessage(target, text, other);
		await setPreviewMessage(db, post.id, target, sent.message_id);
	} catch (err) {
		console.error('[publishQueue] failed to send preview:', describeTelegramError(err).message);
	}
}

/**
 * انتشار یک پست مشخص (هم برای کرون، هم برای دکمه‌ی «انتشار الان»).
 * قفل گرفتن داخل همین تابع است، پس فراخوانی دوباره بی‌خطر است.
 */
export async function publishOne(
	api: SchedulerApi,
	db: D1Database,
	postId: number,
	now: number,
): Promise<{ ok: boolean; status: string }> {
	const claimed = await claimForPublish(db, postId, now);
	if (!claimed) return { ok: false, status: 'skipped' };

	const post = await getPost(db, postId);
	if (!post) return { ok: false, status: 'missing' };

	const channel = await getChannelByTelegramId(db, post.targetChannelId);
	const title = channel?.title ?? String(post.targetChannelId);

	const plan = buildPublishPlan(post, post.targetChannelId);

	// محتوای غیرقابل‌ارسال (خالی/نوع پشتیبانی‌نشده) خطای دائمی است؛ تلاش مجدد
	// فقط صف را کند می‌کند و نتیجه‌اش عوض نمی‌شود.
	if (plan.method === 'unsupported') {
		await markFailed(db, postId, plan.reason, now, null, post.attempts + 1);
		await upsertPreview(
			api,
			db,
			post,
			failedNotificationText({ ...post, lastError: plan.reason }, title),
			null,
			now,
		);
		return { ok: false, status: 'failed' };
	}

	const result = await executePublishPlan(api, plan);

	if (result.ok) {
		await markPublished(db, postId, result.messageId, now);
		const link = channelPostLink(channel?.username ?? null, result.messageId);
		await upsertPreview(
			api,
			db,
			post,
			publishedNotificationText({ ...post, publishedAt: now }, title, link),
			null,
			now,
		);
		return { ok: true, status: 'published' };
	}

	// خطای موقت (شبکه/۵۰۰/۴۲۹) → تلاش مجدد؛ خطای دائمی → توقف و اطلاع به ادمین
	const attempts = post.attempts + 1;
	const retryable =
		result.errorCode === null || result.errorCode === 429 || (result.errorCode ?? 0) >= 500;
	const canRetry = retryable && attempts < MAX_PUBLISH_ATTEMPTS;

	await markFailed(
		db,
		postId,
		result.error ?? 'خطای نامشخص',
		now,
		canRetry ? now + retryDelaySeconds(attempts) : null,
		attempts,
	);

	if (!canRetry) {
		await upsertPreview(api, db, post, failedNotificationText({ ...post, lastError: result.error }, title), null, now);
	}

	return { ok: false, status: canRetry ? 'retry-scheduled' : 'failed' };
}

/**
 * پایان‌بندی آلبوم‌هایی که مهلت جمع‌آوری‌شان تمام شده است.
 * زمان انتشار از **لحظه‌ی رسیدن اولین آیتم** حساب می‌شود، نه از لحظه‌ی پایان‌بندی.
 */
export async function finalizeReadyAlbums(db: D1Database, now: number): Promise<number[]> {
	const ids = await listReadyPosts(db, now, MAX_PUBLISH_PER_TICK);
	const finalized: number[] = [];

	for (const id of ids) {
		const post = await getPost(db, id);
		if (!post || post.status !== 'collecting') continue;

		const rule = post.sourceChannelId ? await getSourceRule(db, post.sourceChannelId) : null;
		const delay = rule?.delayMinutes ?? DEFAULT_DELAY_MINUTES;
		// انتشار = لحظه‌ی رسیدن اولین آیتم + تأخیر (نه لحظه‌ی پایان‌بندی جمع‌آوری)
		const publishAt = Math.max(post.createdAt + delay * SECONDS_PER_MINUTE, post.createdAt + ALBUM_GRACE_SECONDS);
		if (await finalizePost(db, id, Math.round(publishAt), now)) finalized.push(id);
	}

	return finalized;
}

/** پست‌هایی که در حالت «در حال ارسال» گیر کرده‌اند (Worker وسط کار مرده) */
export async function recoverStuckPosts(api: SchedulerApi, db: D1Database, now: number): Promise<number> {
	const ids = await listStuckPosts(db, now, STUCK_PUBLISH_SECONDS);
	for (const id of ids) {
		const post = await getPost(db, id);
		if (!post) continue;
		// عمداً دوباره ارسال نمی‌کنیم: ممکن است پیام واقعاً رفته باشد و دوبار پست شود.
		await markFailed(db, id, 'انتشار نیمه‌تمام ماند؛ لطفاً وضعیت کانال را بررسی کنید.', now, null, post.attempts + 1);
		const channel = await getChannelByTelegramId(db, post.targetChannelId);
		await upsertPreview(
			api,
			db,
			post,
			failedNotificationText({ ...post, lastError: 'انتشار نیمه‌تمام ماند' }, channel?.title ?? ''),
			null,
			now,
		);
	}
	return ids.length;
}

/**
 * ورودی کرون دقیقه‌ای.
 * @param env
 * @param options.api و options.now فقط برای تست تزریق می‌شوند
 */
export async function publishDuePosts(
	env: { TELEGRAM_TOKEN?: string; my_database: D1Database },
	options: { api?: SchedulerApi; now?: number } = {},
): Promise<{ finalized: number; published: number; failed: number; recovered: number }> {
	const now = options.now ?? Math.floor(Date.now() / 1000);
	const db = env.my_database;
	const api = options.api ?? createSchedulerApi(env.TELEGRAM_TOKEN ?? '');

	const recovered = await recoverStuckPosts(api, db, now);
	const finalizedAlbums = await finalizeReadyAlbums(db, now);

	// آلبومی که تازه نهایی شده، اعلانش را همین حالا می‌فرستیم (پیش از انتشار)
	for (const postId of finalizedAlbums) {
		try {
			await notifyQueued(api, db, postId, now);
		} catch (err) {
			console.warn('[publishQueue] album notification failed:', err);
		}
	}

	const ready = await listReadyPosts(db, now, MAX_PUBLISH_PER_TICK);
	let published = 0;
	let failed = 0;

	for (const id of ready) {
		try {
			const result = await publishOne(api, db, id, now);
			if (result.status === 'published') published++;
			if (result.status === 'failed') failed++;
		} catch (err) {
			// یک ردیف خراب نباید بقیه‌ی صف را بخواباند
			console.error(`[publishQueue] post ${id} crashed:`, err);
			failed++;
		}
	}

	// پاک‌سازی سبک، ساعتی یک‌بار
	if (now % 3600 < 60) {
		try {
			await pruneSeen(db, now - 30 * SECONDS_PER_DAY);
			await pruneEditSessions(db, now);
		} catch (err) {
			console.warn('[publishQueue] prune failed:', err);
		}
	}

	if (published || failed || recovered) {
		console.log(`[publishQueue] tick: published=${published} failed=${failed} recovered=${recovered}`);
	}

	return { finalized: finalizedAlbums.length, published, failed, recovered };
}

/**
 * اعلان «پست تازه در صف» برای ادمین.
 * در همان درخواست وبهوک صدا زده می‌شود (تک‌آیتمی) یا از کرون (آلبوم نهایی‌شده).
 */
export async function notifyQueued(
	api: SchedulerApi,
	db: D1Database,
	postId: number,
	now: number,
): Promise<void> {
	const post = await getPost(db, postId);
	if (!post) return;

	const channel = await getChannelByTelegramId(db, post.targetChannelId);
	const text = queuedNotificationText(post, channel?.title ?? String(post.targetChannelId), now);

	await upsertPreview(api, db, post, text, postDetailKeyboard(post, now), now);
}
