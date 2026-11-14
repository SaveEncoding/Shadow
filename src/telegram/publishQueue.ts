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
	toPersianDigits,
} from '../core/schedule/timing.js';
import type { QueuePost } from '../core/schedule/types.js';
import { getChannelByTelegramId } from './db/channels.js';
import {
	claimForPublish,
	finalizePost,
	getPost,
	getPostsByIds,
	getRulesForSources,
	listCollectingAmong,
	markFailed,
	markPublished,
	listActivePollSources,
	listActiveXSources,
	listReadyPosts,
	listStuckPosts,
	loadTickCandidates,
	pruneEditSessions,
	pruneSeen,
	setPreviewMessage,
} from './db/postQueue.js';
import { prunePendingInputs } from './db/pendingInput.js';
import { countQueries } from './db/queryCounter.js';
import { ensureFileIds, itemSourceUrl } from './mediaSpool.js';
import { pollDueSources } from './pollSources.js';
import { pollDueXSources } from './xPoll.js';
import { isXSourcesEnabled, resolveXProvider } from './xSource.js';
import {
	describeTelegramError,
	executePublishPlan,
	buildPublishPlan,
	isUnfetchableUrlError,
	type PublisherApi,
} from './services/postPublisher.js';
import { failedNotificationText, postDetailKeyboard, publishedNotificationText, queuedNotificationText } from './ui/schedulerScreens.js';

/** کلاینتی که برای انتشار و اعلان لازم است (تزریق‌پذیر برای تست) */
export interface SchedulerApi extends PublisherApi {
	editMessageText(chatId: number, messageId: number, text: string, other?: Record<string, unknown>): Promise<unknown>;
	copyMessage(chatId: number, fromChatId: number, messageId: number): Promise<{ message_id: number }>;
	/** برای پاک‌کردن پیام موقتِ گرفتن file_id (اختیاری: در تست لازم نیست) */
	deleteMessage?(chatId: number, messageId: number): Promise<unknown>;
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

/** هاست یک لینک، برای نمایش در پیام ادمین (بدون پارامترها) */
function urlHost(value: string): string {
	try {
		return new URL(value).host;
	} catch {
		return value.slice(0, 48);
	}
}

/**
 * توضیحِ دقیقِ «چرا تلگرام نتوانست رسانه را بگیرد»، وقتی آیتم‌ها فقط لینک دارند.
 *
 * پیامِ پیش‌فرض در این حالت گمراه‌کننده است («بات را ادمین کن»)، چون مشکل
 * دسترسی نیست: آیتم `file_id` ندارد و تلگرام باید لینک را خودش دانلود کند.
 * این‌جا می‌گوییم دقیقاً چند آیتم لینک‌محور است، از کدام هاست، و آخرین تلاشِ
 * ما برای گرفتن `file_id` به چه خطایی خورده — تا دفعه‌ی بعد حدس نزنیم.
 */
export function mediaFetchHint(post: QueuePost, error: string | null, spoolError: string | null): string | null {
	if (!isUnfetchableUrlError(error)) return null;
	const linked = post.items.filter((item) => itemSourceUrl(item) !== null);
	if (linked.length === 0) return null;

	const hosts = [...new Set(linked.map((item) => urlHost(itemSourceUrl(item)!)))];
	const lines = [
		`${toPersianDigits(linked.length)} آیتم این پست فقط لینک دارد (${hosts.join('، ')}) و file_id ندارد؛`,
		'تلگرام باید آن را خودش دانلود می‌کرد و نتوانست.',
	];
	if (spoolError) lines.push(`تلاشِ ما برای گرفتن file_id هم ناموفق بود: ${spoolError}`);
	return lines.join(' ');
}

/**
 * انتشار یک پست مشخص (هم برای کرون، هم برای دکمه‌ی «انتشار الان»).
 * قفل گرفتن داخل همین تابع است، پس فراخوانی دوباره بی‌خطر است.
 */
export async function publishOne(api: SchedulerApi, db: D1Database, postId: number, now: number): Promise<{ ok: boolean; status: string }> {
	const claimed = await claimForPublish(db, postId, now);
	if (!claimed) return { ok: false, status: 'skipped' };

	const post = await getPost(db, postId);
	if (!post) return { ok: false, status: 'missing' };

	const channel = await getChannelByTelegramId(db, post.targetChannelId);
	const title = channel?.title ?? String(post.targetChannelId);

	// آیتم‌هایی که فقط لینک دارند (منبع وبی که `file_id` نگرفته) در لحظه‌ی ارسال
	// وابسته‌اند به اینکه سرور تلگرام بتواند همان لحظه آن لینک را بگیرد؛ اگر
	// نتواند، کل پست با `failed to get HTTP URL content` شکست می‌خورد. درست پیش از
	// ارسال یک بارِ دیگر `file_id` می‌گیریم تا این وابستگی از بین برود.
	const spool = await ensureFileIds(api, db, post);
	if (spool.spooled > 0) {
		console.log(`[publishQueue] got file_id for ${spool.spooled} item(s) of post ${postId} right before publishing`);
	} else if (spool.error) {
		console.warn(`[publishQueue] re-spool failed for post ${postId}, publishing with the URL:`, spool.error);
	}

	const plan = buildPublishPlan(post, post.targetChannelId);

	// محتوای غیرقابل‌ارسال (خالی/نوع پشتیبانی‌نشده) خطای دائمی است؛ تلاش مجدد
	// فقط صف را کند می‌کند و نتیجه‌اش عوض نمی‌شود.
	if (plan.method === 'unsupported') {
		await markFailed(db, postId, plan.reason, now, null, post.attempts + 1);
		await upsertPreview(api, db, post, failedNotificationText({ ...post, lastError: plan.reason }, title), null, now);
		return { ok: false, status: 'failed' };
	}

	const result = await executePublishPlan(api, plan);

	if (result.ok) {
		await markPublished(db, postId, result.messageId, now);
		const link = channelPostLink(channel?.username ?? null, result.messageId);
		await upsertPreview(api, db, post, publishedNotificationText({ ...post, publishedAt: now }, title, link, result.note), null, now);
		return { ok: true, status: 'published' };
	}

	// خطای موقت (شبکه/۵۰۰/۴۲۹) → تلاش مجدد؛ خطای دائمی → توقف و اطلاع به ادمین
	const attempts = post.attempts + 1;
	const retryable = result.errorCode === null || result.errorCode === 429 || (result.errorCode ?? 0) >= 500;
	const canRetry = retryable && attempts < MAX_PUBLISH_ATTEMPTS;

	await markFailed(db, postId, result.error ?? 'خطای نامشخص', now, canRetry ? now + retryDelaySeconds(attempts) : null, attempts);

	if (!canRetry) {
		await upsertPreview(
			api,
			db,
			post,
			failedNotificationText({ ...post, lastError: result.error }, title, mediaFetchHint(post, result.error, spool.error)),
			null,
			now,
		);
	}

	return { ok: false, status: canRetry ? 'retry-scheduled' : 'failed' };
}

/**
 * پایان‌بندی آلبوم‌هایی که مهلت جمع‌آوری‌شان تمام شده است.
 * زمان انتشار از **لحظه‌ی رسیدن اولین آیتم** حساب می‌شود، نه از لحظه‌ی پایان‌بندی.
 */
export async function finalizeReadyAlbums(db: D1Database, now: number, candidateIds?: number[]): Promise<number[]> {
	const ready = candidateIds ?? (await listReadyPosts(db, now, MAX_PUBLISH_PER_TICK));
	const { finalized } = await closeDueAlbums(db, now, ready);
	return finalized;
}

/**
 * بستن آلبوم‌های سررسیده از میان کاندیدهای همین تیک.
 *
 * چرا جدا از `listReadyPosts`؟ چون آن کوئری هر دو حالت را برمی‌گرداند و نتیجه‌اش
 * دور ریخته می‌شد. حالا تیک یک بار لیست آماده‌ها را می‌گیرد و همین جا:
 *   - فقط پست‌های `collecting` را می‌بندد (با یک کوئری فیلتر، بدون لود بی‌مصرف)،
 *   - پست، آیتم‌ها و قانون را دسته‌ای می‌خواند (۳ کوئری برای همه، نه ۳ برای هر کدام)،
 *   - و `publishable` را برمی‌گرداند تا آلبومی که تأخیرش صفر است در همین تیک برود
 *     و آلبومی که زمان انتشارش به آینده رفت، زودتر از موعد منتشر نشود.
 */
async function closeDueAlbums(db: D1Database, now: number, ids: number[]): Promise<{ finalized: number[]; publishable: number[] }> {
	const finalized: number[] = [];
	if (ids.length === 0) return { finalized, publishable: [] };

	const collecting = await listCollectingAmong(db, ids);
	// هیچ آلبومی در حال جمع‌آوری نیست: همه‌ی کاندیدها از قبل `scheduled` و سررسیده‌اند
	if (collecting.length === 0) return { finalized, publishable: ids };

	const posts = await getPostsByIds(db, collecting);
	const rules = await getRulesForSources(
		db,
		[...new Set(posts.map((post) => post.sourceChannelId))].filter((id) => Boolean(id)),
	);
	const delayBySource = new Map(rules.map((rule) => [rule.sourceChannelId, rule.delayMinutes]));

	// خروجی با ترتیب همان `publish_at` ورودی می‌ماند
	const publishable = new Set<number>(ids);

	for (const post of posts) {
		if (post.status !== 'collecting') continue;

		const delay = post.sourceChannelId ? (delayBySource.get(post.sourceChannelId) ?? DEFAULT_DELAY_MINUTES) : DEFAULT_DELAY_MINUTES;
		// انتشار = لحظه‌ی رسیدن اولین آیتم + تأخیر (نه لحظه‌ی پایان‌بندی جمع‌آوری)
		const publishAt = Math.round(Math.max(post.createdAt + delay * SECONDS_PER_MINUTE, post.createdAt + ALBUM_GRACE_SECONDS));
		if (await finalizePost(db, post.id, publishAt, now)) {
			finalized.push(post.id);
			// اگر تأخیر صفر بود (یا گذشته)، همین حالا قابل انتشار است
			if (publishAt > now) publishable.delete(post.id);
		} else {
			// تیک دیگری زودتر بست/حذف کرد → در این تیک دست نزن
			publishable.delete(post.id);
		}
	}

	return { finalized, publishable: ids.filter((id) => publishable.has(id)) };
}

/**
 * پست‌هایی که در حالت «در حال ارسال» گیر کرده‌اند (Worker وسط کار مرده).
 * @param stuckIds شناسه‌های از قبل خوانده‌شده؛ تیک آن‌ها را همراه دو کوئری
 *   «آماده» در یک `batch` می‌گیرد (`loadTickCandidates`) و این‌جا دوباره نمی‌خواند.
 */
export async function recoverStuckPosts(api: SchedulerApi, db: D1Database, now: number, stuckIds?: number[]): Promise<number> {
	const ids = stuckIds ?? (await listStuckPosts(db, now, STUCK_PUBLISH_SECONDS));
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
/** چیزی که هر تیک درباره‌ی هزینه‌ی خودش می‌داند */
export interface TickMetrics {
	/** زمان دیواری کل تیک (میلی‌ثانیه)؛ شامل انتظار برای D1 و تلگرام */
	durationMs: number;
	/**
	 * مجموع زمان انتظار برای D1 در این تیک.
	 * زیرمجموعه‌ی `durationMs` است (نه بخشی جدای از آن) و با `pollMs`/`publishMs`
	 * همپوشانی دارد: کوئری هم در فاز پولینگ هست، هم در فاز انتشار.
	 */
	dbMs: number;
	/** فاز خواندن منابع (پیش‌نمایش وب/X)؛ شامل خودِ درخواست‌های شبکه */
	pollMs: number;
	/** فاز انتشار: قفل‌گرفتن، ارسال به تلگرام، اعلان‌ها (بدون پاک‌سازی ساعتی) */
	publishMs: number;
	/** تعداد statement های D1 در این تیک */
	queries: number;
	/** تعداد رفت‌وبرگشت به D1؛ `batch` فقط یکی حساب می‌شود */
	roundTrips: number;
}

export async function publishDuePosts(
	env: {
		TELEGRAM_TOKEN?: string;
		my_database: D1Database;
		X_BEARER_TOKEN?: string;
		X_RSS_TEMPLATE?: string;
		X_SOURCES_ENABLED?: string;
	},
	options: { api?: SchedulerApi; now?: number; fetchImpl?: typeof fetch } = {},
): Promise<{
	finalized: number;
	published: number;
	failed: number;
	recovered: number;
	polled: number;
	queued: number;
	xPolled: number;
	xQueued: number;
	metrics: TickMetrics;
}> {
	const startedAt = Date.now();
	// فازها با ساعت monotonic اندازه‌گیری می‌شوند، نه Date.now؛ همان دلیلی که در
	// queryCounter آمده است.
	const pollStartedAt = performance.now();
	const now = options.now ?? Math.floor(Date.now() / 1000);
	// همه‌ی کوئری‌های تیک از این پروکسی رد می‌شوند تا عدد واقعی داشته باشیم.
	const { db, counter } = countQueries(env.my_database);
	// پولینگ هم باید از همین پروکسی رد شود. قبلاً `env` خام می‌رفت و نوشتن‌هایش
	// (به‌روزرسانی cursor/failures و صف‌شدن پست تازه) از شمارش جا می‌ماندند؛
	// یعنی `dbQueries` در تیک‌هایی که منبع داشتند کمتر از واقعیت بود.
	const countedEnv = { my_database: db };
	const api = options.api ?? createSchedulerApi(env.TELEGRAM_TOKEN ?? '');

	// ── منابع عمومی (بدون عضویت بات) ──
	// اول خوانده می‌شوند تا پست تازه‌شان اگر تأخیرش صفر باشد در همین تیک جا بیفتد.
	let polled = 0;
	let queued = 0;
	try {
		const sources = await listActivePollSources(db, { limit: MAX_PUBLISH_PER_TICK });
		if (sources.length > 0) {
			const result = await pollDueSources(countedEnv, { api, now, fetchImpl: options.fetchImpl, sources });
			polled = result.polled;
			queued = result.queued;
		}
	} catch (err) {
		// خطای خواندن پیش‌نمایش وب نباید انتشار پست‌های آماده را متوقف کند
		console.error('[publishQueue] polling sources failed:', err);
	}

	// ── منابع X (توییتر) ──
	// هر منبع حداقل ۵ دقیقه یک‌بار خوانده می‌شود (هزینه‌ی API)؛ تابع خودش ساعت را چک می‌کند.
	// کل این بخش با پرچم `X_SOURCES_ENABLED` تعلیق/فعال می‌شود؛ در حالت تعلیق
	// حتی یک کوئری هم به D1 زده نمی‌شود و هیچ درخواستی به X نمی‌رود.
	let xPolled = 0;
	let xQueued = 0;
	try {
		const provider = isXSourcesEnabled(env) ? resolveXProvider(env) : ({ kind: 'none' } as const);
		if (provider.kind !== 'none') {
			const sources = await listActiveXSources(db, { limit: MAX_PUBLISH_PER_TICK });
			if (sources.length > 0) {
				const result = await pollDueXSources(countedEnv, {
					api,
					now,
					sources,
					provider,
					fetchImpl: options.fetchImpl,
				});
				xPolled = result.polled;
				xQueued = result.queued;
			}
		}
	} catch (err) {
		console.error('[publishQueue] polling X sources failed:', err);
	}

	const pollMs = Math.round(performance.now() - pollStartedAt);

	const publishStartedAt = performance.now();
	// سه خواندنِ مستقل (گیرکرده‌ها + دو شاخه‌ی «آماده») با یک رفت‌وبرگشت؛
	// قبلاً سه رفت‌وبرگشت بود و هر کدام ~۷۵ms در پروداکشن هزینه داشت.
	const { stuck, ready } = await loadTickCandidates(db, now, {
		limit: MAX_PUBLISH_PER_TICK,
		stuckThresholdSeconds: STUCK_PUBLISH_SECONDS,
	});
	const recovered = await recoverStuckPosts(api, db, now, stuck);

	// بستن آلبوم‌های همان لیست (بدون کوئری تازه).
	const { finalized: finalizedAlbums, publishable } = await closeDueAlbums(db, now, ready);

	// آلبومی که تازه نهایی شده، اعلانش را همین حالا می‌فرستیم (پیش از انتشار)
	for (const postId of finalizedAlbums) {
		try {
			await notifyQueued(api, db, postId, now);
		} catch (err) {
			console.warn('[publishQueue] album notification failed:', err);
		}
	}

	let published = 0;
	let failed = 0;

	for (const id of publishable) {
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

	const publishMs = Math.round(performance.now() - publishStartedAt);

	// پاک‌سازی سبک، ساعتی یک‌بار
	if (now % 3600 < 60) {
		try {
			await pruneSeen(db, now - 30 * SECONDS_PER_DAY);
			await pruneEditSessions(db, now);
			await prunePendingInputs(db, now);
		} catch (err) {
			console.warn('[publishQueue] prune failed:', err);
		}
	}

	const metrics: TickMetrics = {
		durationMs: Date.now() - startedAt,
		dbMs: Math.round(counter.dbMs),
		pollMs,
		publishMs,
		queries: counter.total,
		roundTrips: counter.roundTrips,
	};

	// یک خط JSON در هر تیک؛ Workers Logs فیلدها را ایندکس می‌کند و می‌شود روی
	// `event = "cron.publish"` فیلتر کرد و مثلاً میانگین `queries` را گرفت.
	console.log({
		event: 'cron.publish',
		now,
		durationMs: metrics.durationMs,
		dbMs: metrics.dbMs,
		pollMs: metrics.pollMs,
		publishMs: metrics.publishMs,
		dbQueries: metrics.queries,
		dbRoundTrips: metrics.roundTrips,
		finalized: finalizedAlbums.length,
		published,
		failed,
		recovered,
		polled,
		queued,
		xPolled,
		xQueued,
	});

	return { finalized: finalizedAlbums.length, published, failed, recovered, polled, queued, xPolled, xQueued, metrics };
}

/**
 * اعلان «پست تازه در صف» برای ادمین.
 * در همان درخواست وبهوک صدا زده می‌شود (تک‌آیتمی) یا از کرون (آلبوم نهایی‌شده).
 */
export async function notifyQueued(api: SchedulerApi, db: D1Database, postId: number, now: number): Promise<void> {
	const post = await getPost(db, postId);
	if (!post) return;

	const channel = await getChannelByTelegramId(db, post.targetChannelId);
	const text = queuedNotificationText(post, channel?.title ?? String(post.targetChannelId), now);

	await upsertPreview(api, db, post, text, postDetailKeyboard(post, now), now);
}
