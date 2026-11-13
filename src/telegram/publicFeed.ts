/**
 * گرفتن صفحه‌ی پیش‌نمایش وب یک کانال عمومی.
 *
 * تنها نقطه‌ای که برای «کانال بدون عضویت بات» به اینترنت بیرون وصل می‌شویم.
 * تابع شبکه تزریق‌پذیر است تا در تست هیچ درخواست واقعی زده نشود.
 */

import { parsePublicFeed, type FeedPost } from '../core/schedule/publicFeed.js';

export type PublicFeedResult = { ok: true; posts: FeedPost[] } | { ok: false; error: string; status: number | null };

/**
 * سقف انتظار برای صفحه‌ی پیش‌نمایش.
 *
 * اندازه‌گیری پروداکشن: یک تیک کامل ۶۹۹ms بود که ۵۶۳ms آن در همین فاز پولینگ
 * گذشت. این عدد عادی است و مشکلی نیست؛ مشکل، حالت غیرعادی است: بدون timeout،
 * یک اتصال گیرکرده تیک را تا سقف خودِ پلتفرم (۳۰ ثانیه برای هر subrequest)
 * نگه می‌دارد. ۱۰ ثانیه ≫ ۵۶۳ms عادی است، پس مسیر سالم را کند نمی‌کند و در
 * عوض بدترین حالت را قطعی می‌کند.
 */
export const FEED_FETCH_TIMEOUT_MS = 10_000;

export interface PublicFeedOptions {
	/** برای تست */
	fetchImpl?: typeof fetch;
	/** صفحه‌ی قبل از این شناسه (صفحه‌بندی `?before=`) */
	before?: number;
	/** سقف انتظار (میلی‌ثانیه)؛ پیش‌فرض `FEED_FETCH_TIMEOUT_MS` — برای تست */
	timeoutMs?: number;
}

/** خطای شبکه/زمان را به پیام فارسیِ قابل نمایش تبدیل می‌کند */
function networkErrorText(err: unknown, timeoutMs: number): string {
	const info = err as { name?: unknown; message?: unknown } | null;
	// `AbortSignal.timeout` خطایی با name = TimeoutError می‌دهد؛ بعضی لایه‌ها
	// همان را به AbortError تبدیل می‌کنند، پس هر دو را زمان‌بندی حساب می‌کنیم.
	if (info?.name === 'TimeoutError' || info?.name === 'AbortError') {
		const seconds = Math.max(1, Math.round(timeoutMs / 1000));
		return `پیش‌نمایش کانال در ${seconds} ثانیه پاسخ نداد؛ در تیک بعدی دوباره تلاش می‌شود.`;
	}
	const message = typeof info?.message === 'string' && info.message ? info.message : 'نامشخص';
	return `اتصال به تلگرام برقرار نشد: ${message}`;
}

export function publicFeedUrl(username: string, before?: number): string {
	const clean = username.replace(/^@/, '').trim();
	const base = `https://t.me/s/${encodeURIComponent(clean)}`;
	return before ? `${base}?before=${before}` : base;
}

/**
 * خواندن آخرین پست‌های یک کانال عمومی.
 * @param username بدون @ (یا با @؛ هر دو پذیرفته می‌شود)
 */
export async function fetchPublicFeed(username: string, options: PublicFeedOptions = {}): Promise<PublicFeedResult> {
	const doFetch = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? FEED_FETCH_TIMEOUT_MS;

	// `AbortSignal.timeout` هم خودِ درخواست و هم خواندن بدنه را می‌بندد (بدون آن،
	// سروری که هدر را سریع می‌دهد و بدنه را قطره‌ای می‌فرستد تیک را معطل می‌کند).
	const signal = AbortSignal.timeout(timeoutMs);

	let response: Response;
	let html: string;
	try {
		response = await doFetch(publicFeedUrl(username, options.before), {
			method: 'GET',
			signal,
			headers: {
				// t.me به درخواست‌های بدون UA گاهی صفحه‌ی خالی می‌دهد
				'User-Agent': 'Mozilla/5.0 (compatible; ShadowBot/1.0; +https://github.com/SaveEncoding/Shadow)',
				Accept: 'text/html,application/xhtml+xml',
				'Accept-Language': 'fa,en;q=0.8',
			},
		});

		if (response.status === 404) {
			return { ok: false, error: 'کانال عمومی با این آدرس پیدا نشد.', status: 404 };
		}
		if (!response.ok) {
			return { ok: false, error: `پیش‌نمایش کانال در دسترس نیست (کد ${response.status}).`, status: response.status };
		}

		html = await response.text();
	} catch (err) {
		return { ok: false, error: networkErrorText(err, timeoutMs), status: null };
	}

	const posts = parsePublicFeed(html, username);

	// صفحه‌ی «کانال خصوصی است» یا «وجود ندارد» هیچ پستی ندارد و ساختار کانال هم ندارد
	if (posts.length === 0 && !html.includes('tgme_channel_info')) {
		return {
			ok: false,
			error: 'این کانال پیش‌نمایش عمومی ندارد (خصوصی است یا آدرس اشتباه است).',
			status: response.status,
		};
	}

	return { ok: true, posts };
}
