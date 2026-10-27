/**
 * گرفتن صفحه‌ی پیش‌نمایش وب یک کانال عمومی.
 *
 * تنها نقطه‌ای که برای «کانال بدون عضویت بات» به اینترنت بیرون وصل می‌شویم.
 * تابع شبکه تزریق‌پذیر است تا در تست هیچ درخواست واقعی زده نشود.
 */

import { parsePublicFeed, type FeedPost } from '../core/schedule/publicFeed.js';

export type PublicFeedResult =
	| { ok: true; posts: FeedPost[] }
	| { ok: false; error: string; status: number | null };

export interface PublicFeedOptions {
	/** برای تست */
	fetchImpl?: typeof fetch;
	/** صفحه‌ی قبل از این شناسه (صفحه‌بندی `?before=`) */
	before?: number;
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

	let response: Response;
	try {
		response = await doFetch(publicFeedUrl(username, options.before), {
			method: 'GET',
			headers: {
				// t.me به درخواست‌های بدون UA گاهی صفحه‌ی خالی می‌دهد
				'User-Agent': 'Mozilla/5.0 (compatible; ShadowBot/1.0; +https://github.com/SaveEncoding/Shadow)',
				Accept: 'text/html,application/xhtml+xml',
				'Accept-Language': 'fa,en;q=0.8',
			},
		});
	} catch (err) {
		return { ok: false, error: `اتصال به تلگرام برقرار نشد: ${(err as Error)?.message ?? 'نامشخص'}`, status: null };
	}

	if (response.status === 404) {
		return { ok: false, error: 'کانال عمومی با این آدرس پیدا نشد.', status: 404 };
	}
	if (!response.ok) {
		return { ok: false, error: `پیش‌نمایش کانال در دسترس نیست (کد ${response.status}).`, status: response.status };
	}

	const html = await response.text();
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
