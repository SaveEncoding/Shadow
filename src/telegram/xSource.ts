/**
 * خواندن خط زمانی یک حساب X — تنها نقطه‌ی شبکه‌ای این پلتفرم.
 *
 * دو «ارائه‌دهنده» داریم و انتخاب خودکار است:
 *
 *   ۱. `official` — اگر `X_BEARER_TOKEN` تنظیم شده باشد: API رسمی v2.
 *      هزینه دارد (پرداخت به‌ازای مصرف)، پس فقط با فاصله‌ی زمانی پول می‌شود و
 *      شناسه‌ی عددی کاربر کش می‌شود تا در هر بار خواندن، «خواندن کاربر» نخریم.
 *
 *   ۲. `rss` — اگر `X_RSS_TEMPLATE` تنظیم شده باشد (مثلاً یک RSSHub خودمیزبان
 *      با `{username}` در آدرس). رایگان، ولی به همان پل وابسته است.
 *
 * اگر هیچ‌کدام تنظیم نشده باشد، صادقانه خطا برمی‌گردانیم و در UI توضیح می‌دهیم؛
 * هرگز سعی نمی‌کنیم صفحه‌ی X را اسکرپ کنیم (نیازمند جاوااسکریپت/ورود است و
 * خلاف شرایط استفاده‌ی X).
 */

import type { ExternalPost } from '../core/sources/types.js';
import {
	MAX_X_POSTS_PER_POLL,
	newestXPostId,
	parseXRss,
	parseXTweets,
	parseXUser,
	normalizeXHandle,
} from '../core/sources/x.js';

export type XProvider =
	| { kind: 'official'; token: string }
	| { kind: 'rss'; template: string }
	| { kind: 'none' };

export interface XEnv {
	X_BEARER_TOKEN?: string;
	X_RSS_TEMPLATE?: string;
}

/** کدام مسیر خواندن در دسترس است؟ */
export function resolveXProvider(env: XEnv): XProvider {
	const token = env.X_BEARER_TOKEN?.trim();
	if (token) return { kind: 'official', token };
	const template = env.X_RSS_TEMPLATE?.trim();
	if (template && template.includes('{username}')) return { kind: 'rss', template };
	return { kind: 'none' };
}

/** پیام فارسی برای وقتی هیچ مسیری تنظیم نشده است (در UI هم استفاده می‌شود) */
export const X_NOT_CONFIGURED_MESSAGE = [
	'⚙️ خواندن از X روی این سرور فعال نیست.',
	'',
	'X از ۲۰۲۶ هیچ دسترسی رایگانی ندارد؛ برای فعال‌کردن یکی از این دو لازم است:',
	'',
	'<b>۱) کلید رسمی API</b> (پرداخت به‌ازای مصرف، ~۰.۰۰۵ دلار برای هر پست خوانده‌شده):',
	'   <code>npx wrangler secret put X_BEARER_TOKEN</code>',
	'',
	'<b>۲) پل RSS خودمیزبان/سرویس شخصی</b> (رایگان):',
	'   <code>wrangler.jsonc</code> → متغیر <code>X_RSS_TEMPLATE</code>',
	'   نمونه: <code>https://rsshub.example.com/twitter/user/{username}</code>',
	'',
	'<i>عمداً صفحه‌ی X را اسکرپ نمی‌کنیم: بدون ورود کار نمی‌کند و خلاف شرایط استفاده‌ی X است.</i>',
].join('\n');

const API_BASE = 'https://api.x.com';

export interface FetchXTimelineOptions {
	handle: string;
	/** شناسه‌ی آخرین توییت خوانده‌شده (کِرسر) */
	sinceId?: string | null;
	fetchImpl?: typeof fetch;
	provider?: XProvider;
	/** شناسه‌ی عددی کاربر، اگر قبلاً کش شده باشد */
	userId?: string | null;
}

export interface XTimelineResult {
	ok: boolean;
	posts?: ExternalPost[];
	handle?: string;
	cursor?: string | null;
	/** شناسه‌ی عددی کاربر (برای کش در D1) */
	userId?: string | null;
	error?: string;
	status?: number | null;
}

/**
 * گرفتن آخرین پست‌های یک حساب X.
 * همه‌ی خطاها به شکل ساختاری برمی‌گردند تا حلقه‌ی کرون هرگز متوقف نشود.
 */
export async function fetchXTimeline(options: FetchXTimelineOptions): Promise<XTimelineResult> {
	const doFetch = options.fetchImpl ?? fetch;
	const provider = options.provider ?? resolveXProvider({});
	const handle = normalizeXHandle(options.handle);

	if (!handle) return { ok: false, error: 'آدرس حساب X خالی است.', status: null };
	if (provider.kind === 'none') return { ok: false, error: X_NOT_CONFIGURED_MESSAGE, status: null };

	if (provider.kind === 'rss') {
		return fetchViaRss(provider.template, handle, options.sinceId ?? null, doFetch);
	}
	return fetchViaApi(provider.token, handle, options.sinceId ?? null, options.userId ?? null, doFetch);
}

async function fetchViaRss(
	template: string,
	handle: string,
	sinceId: string | null,
	doFetch: typeof fetch,
): Promise<XTimelineResult> {
	const url = template.replace(/\{username\}/g, encodeURIComponent(handle));

	let response: Response;
	try {
		response = await doFetch(url, {
			headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
		});
	} catch (err) {
		return { ok: false, error: `اتصال به پل RSS برقرار نشد: ${(err as Error)?.message ?? 'نامشخص'}`, status: null };
	}

	if (response.status === 404) return { ok: false, error: 'این حساب در X پیدا نشد.', status: 404 };
	if (!response.ok) {
		return { ok: false, error: `پل RSS پاسخ نداد (کد ${response.status}).`, status: response.status };
	}

	let xml = '';
	try {
		xml = await response.text();
	} catch {
		return { ok: false, error: 'خواندن پاسخ پل RSS ممکن نشد.', status: response.status };
	}

	const posts = parseXRss(xml, handle, sinceId).slice(-MAX_X_POSTS_PER_POLL);
	return { ok: true, posts, handle, cursor: newestXPostId(posts, sinceId), userId: null };
}

async function fetchViaApi(
	token: string,
	handle: string,
	sinceId: string | null,
	userId: string | null,
	doFetch: typeof fetch,
): Promise<XTimelineResult> {
	const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

	// ── شناسه‌ی کاربر (کش‌شده در D1 تا هزینه‌ی اضافه ندهیم) ──
	let id = userId ?? null;
	if (!id) {
		let response: Response;
		try {
			response = await doFetch(`${API_BASE}/2/users/by/username/${encodeURIComponent(handle)}`, { headers });
		} catch (err) {
			return { ok: false, error: `اتصال به API X برقرار نشد: ${(err as Error)?.message ?? 'نامشخص'}`, status: null };
		}
		const failure = apiFailure(response);
		if (failure) return failure;

		let payload: unknown = null;
		try {
			payload = await response.json();
		} catch {
			return { ok: false, error: 'پاسخ API X قابل خواندن نبود.', status: response.status };
		}
		const user = parseXUser(payload);
		if (!user) return { ok: false, error: 'این حساب در X پیدا نشد.', status: 404 };
		id = user.id;
	}

	// ── خط زمانی ──
	const params = new URLSearchParams({
		max_results: String(MAX_X_POSTS_PER_POLL),
		'tweet.fields': 'created_at,entities,attachments,note_tweet',
		expansions: 'attachments.media_keys',
		'media.fields': 'url,preview_image_url,type,width,height',
	});
	if (sinceId) params.set('since_id', sinceId);

	let timeline: Response;
	try {
		timeline = await doFetch(`${API_BASE}/2/users/${encodeURIComponent(id)}/tweets?${params.toString()}`, { headers });
	} catch (err) {
		return { ok: false, error: `اتصال به API X برقرار نشد: ${(err as Error)?.message ?? 'نامشخص'}`, status: null };
	}

	// ۴۰۴ روی خط زمانی معمولاً یعنی «پستی تازه نیست» نیست، ولی X برای تایم‌لاین خالی ۲۰۰ می‌دهد؛
	// پس هر خطای دیگر را گزارش می‌کنیم.
	const failure = apiFailure(timeline);
	if (failure) return { ...failure, userId: id };

	let payload: unknown = null;
	try {
		payload = await timeline.json();
	} catch {
		return { ok: false, error: 'پاسخ API X قابل خواندن نبود.', status: timeline.status, userId: id };
	}

	const posts = parseXTweets(payload, handle, sinceId);
	return { ok: true, posts, handle, cursor: newestXPostId(posts, sinceId), userId: id };
}

/** ترجمه‌ی کدهای خطای X به پیام فارسی */
function apiFailure(response: Response): { ok: false; error: string; status: number | null } | null {
	if (response.ok) return null;

	const status = response.status;
	if (status === 401) return { ok: false, error: 'کلید X معتبر نیست (۴۰۱). توکن را بررسی کن.', status };
	if (status === 403) return { ok: false, error: 'دسترسی این کلید X به این حساب بسته است (۴۰۳).', status };
	if (status === 404) return { ok: false, error: 'این حساب در X پیدا نشد.', status };
	if (status === 429) {
		const reset = response.headers?.get?.('x-rate-limit-reset');
		const when = reset ? new Date(Number(reset) * 1000).toISOString().slice(11, 16) : null;
		return {
			ok: false,
			error: when ? `سقف نرخ X پر شده است؛ تلاش بعدی حدود ${when} (UTC).` : 'سقف نرخ X پر شده است؛ کمی بعد دوباره تلاش می‌شود.',
			status,
		};
	}
	if (status === 402) return { ok: false, error: 'اعتبار حساب X در پنل توسعه‌دهنده تمام شده است (۴۰۲).', status };
	return { ok: false, error: `API X پاسخ خطا داد (کد ${status}).`, status };
}
