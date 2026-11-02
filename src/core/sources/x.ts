/**
 * X (توییتر): پارس پاسخ‌ها — کاملاً خالص، بدون شبکه.
 *
 * دو مسیر داده پشتیبانی می‌شود، چون از ۲۰۲۶ X هیچ سطح رایگانی ندارد
 * (پرداخت به‌ازای مصرف: هر پست خوانده‌شده ~۰.۰۰۵ دلار):
 *
 *   ۱. **API رسمی v2** با `Bearer token`:
 *        GET /2/users/by/username/<handle>
 *        GET /2/users/<id>/tweets?since_id=…&max_results=5&tweet.fields=…&expansions=attachments.media_keys
 *      دقیق و کامل، ولی پول می‌خواهد → پولر با فاصله‌ی زمانی حداقل اجرا می‌شود.
 *
 *   ۲. **پل RSS** (RSSHub/Nitter خودمیزبان یا هر سرویس سازگار):
 *        GET <template> با {username}
 *      رایگان ولی به میزبانی خود کاربر وابسته است.
 *
 * هر دو مسیر به یک شکل مشترک (`ExternalPost`) تبدیل می‌شوند.
 */

import type { ExternalMedia, ExternalPost } from './types.js';

/** حداکثر تعداد پستی که در هر بار خواندن از X قبول می‌کنیم (کنترل هزینه) */
export const MAX_X_POSTS_PER_POLL = 5;

/** حداکثر عکس در یک پست X */
export const MAX_X_IMAGES = 4;

/** اعتبارسنجی handle توییتر: ۱ تا ۱۵ کاراکتر، حرف/عدد/زیرخط */
export function isValidXHandle(raw: string): boolean {
	return /^@?[A-Za-z0-9_]{1,15}$/.test(String(raw ?? '').trim());
}

/** بدون @ و با حروف کوچک (X به بزرگی/کوچکی حساس نیست) */
export function normalizeXHandle(raw: string): string {
	return String(raw ?? '')
		.trim()
		.replace(/^@/, '')
		.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
		.replace(/[/?#].*$/, '')
		.toLowerCase();
}

export function xPostUrl(handle: string, id: string): string {
	return `https://x.com/${normalizeXHandle(handle)}/status/${id}`;
}

/**
 * شناسه‌ی ساختگی و قطعی برای یک منبع X.
 *
 * چرا منفی و بزرگ؟ شناسه‌های واقعی کانال تلگرام `-100…` هستند و شناسه‌های
 * کانال عمومی وب در بازه‌ی `-1_000_000 … -2_000_000_000`. X را زیر این‌ها
 * می‌بریم تا هیچ‌وقت با آن‌ها تداخل نکند.
 */
export function xSourceChannelId(handle: string): number {
	const clean = normalizeXHandle(handle);
	let hash = 0x811c9dc5;
	for (let i = 0; i < clean.length; i++) {
		hash ^= clean.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return -(2_000_000_000 + (hash % 100_000_000));
}

/**
 * کلید عددی یک آیتم (عکس) از پست X.
 *
 * شناسه‌ی توییت ~۱۹ رقم است و از `Number.MAX_SAFE_INTEGER` بزرگ‌تر؛ پس نمی‌شود
 * مستقیم به عدد تبدیلش کرد. هش ۳۰ بیتی می‌گیریم و شماره‌ی رسانه را در انتها
 * می‌گذاریم تا ترتیب آلبوم حفظ شود (`source_message_id` کلید اصلی جدول آیتم‌هاست).
 */
export function xItemKey(externalId: string, index: number): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < externalId.length; i++) {
		hash ^= externalId.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return (hash % 1_000_000) * 1000 + index;
}

/** یک توییت را با لینک‌های بازشده برمی‌گرداند (t.co → آدرس واقعی) */
export function expandTweetLinks(text: string, urls: Array<{ url?: string; expanded_url?: string }> = []): string {
	let out = String(text ?? '');
	for (const entity of urls) {
		if (!entity.url || !entity.expanded_url) continue;
		// اگر لینک تکراری در متن بود، همه‌شان باز می‌شوند
		out = out.split(entity.url).join(entity.expanded_url);
	}
	return out;
}

interface ApiTweet {
	id?: string;
	text?: string;
	created_at?: string;
	attachments?: { media_keys?: string[] };
	entities?: { urls?: Array<{ url?: string; expanded_url?: string }> };
	note_tweet?: { note_tweet_results?: { result?: { text?: string } } };
}

interface ApiMedia {
	media_key?: string;
	type?: string;
	url?: string;
	preview_image_url?: string;
	width?: number;
	height?: number;
}

interface ApiIncludes {
	media?: ApiMedia[];
}

/** «@handle» از پاسخ `/2/users/by/username/:handle` */
export function parseXUser(payload: unknown): { id: string; handle: string; name: string } | null {
	const data = (payload as { data?: { id?: string; username?: string; name?: string } } | null)?.data;
	if (!data?.id || !data.username) return null;
	return { id: String(data.id), handle: String(data.username), name: String(data.name ?? '') };
}

/**
 * پاسخ `/2/users/:id/tweets` → پست‌های قابل استفاده.
 * @param handle برای ساخت لینک اصل پست
 * @param sinceId پست‌های قدیمی‌تر یا مساوی نادیده گرفته می‌شوند
 */
export function parseXTweets(payload: unknown, handle: string, sinceId: string | null = null): ExternalPost[] {
	const body = payload as { data?: ApiTweet[]; includes?: ApiIncludes } | null;
	const tweets = body?.data ?? [];
	const mediaByKey = new Map<string, ApiMedia>();
	for (const media of body?.includes?.media ?? []) {
		if (media.media_key) mediaByKey.set(media.media_key, media);
	}

	const posts: ExternalPost[] = [];

	for (const tweet of tweets) {
		if (!tweet.id) continue;
		// فقط پست‌های تازه‌تر از کِرسر (مقایسه‌ی عددیِ رشته‌ای، بدون Number)
		if (sinceId && compareIds(String(tweet.id), sinceId) <= 0) continue;

		const keys = tweet.attachments?.media_keys ?? [];
		const media: ExternalMedia[] = [];
		let droppedVideo = false;

		for (const key of keys) {
			const asset = mediaByKey.get(key);
			if (!asset) continue;
			if (asset.type === 'photo' && asset.url) {
				media.push({
					kind: 'photo',
					url: asset.url,
					width: asset.width ?? null,
					height: asset.height ?? null,
				});
				continue;
			}
			// ویدیو/گیف در X فقط HLS است و تلگرام نمی‌تواند از لینک m3u8 بردارد
			droppedVideo = true;
		}

		const rawText = tweet.note_tweet?.note_tweet_results?.result?.text ?? tweet.text ?? '';
		const text = expandTweetLinks(rawText, tweet.entities?.urls);

		posts.push({
			externalId: String(tweet.id),
			text,
			media,
			createdAt: tweet.created_at ? Math.floor(new Date(tweet.created_at).getTime() / 1000) || null : null,
			url: xPostUrl(handle, String(tweet.id)),
			unsupported: droppedVideo && media.length === 0 ? 'ویدیوی X (فایل مستقیم ندارد)' : null,
			videoDropped: droppedVideo,
		});
	}

	// قدیمی‌ترین اول؛ صف هم به همین ترتیب پر می‌شود
	return sortByDate(posts);
}

// ───────────────────────────── مسیر RSS ─────────────────────────────

function decodeXml(input: string): string {
	return input
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_all, inner: string) => inner)
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&amp;/g, '&');
}

/** حذف تگ‌های HTML از متن RSS و برگرداندن متن جاافتاده */
export function stripHtml(input: string): string {
	return decodeXml(
		String(input ?? '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, ''),
	)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function firstTag(block: string, names: string[]): string | null {
	for (const name of names) {
		const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
		if (match) return decodeXml(match[1]).trim();
	}
	return null;
}

function attr(block: string, tag: string, name: string): string | null {
	const match = block.match(new RegExp(`<${tag}\\b[^>]*\\s${name}\\s*=\\s*["']([^"']+)["'][^>]*>`, 'i'));
	return match ? decodeXml(match[1]) : null;
}

/** شناسه‌ی توییت را از لینک/guid RSS بیرون می‌کشد */
export function tweetIdFromUrl(url: string): string | null {
	const match = String(url ?? '').match(/\/status(?:es)?\/(\d+)/);
	return match ? match[1] : null;
}

/**
 * پارس خروجی RSS 2.0 یا Atom یک پل X.
 * انتظار داریم هر item حداقل `link` (شامل /status/<id>) و `title`/`description` داشته باشد.
 */
export function parseXRss(xml: string, handle: string, sinceId: string | null = null): ExternalPost[] {
	const source = String(xml ?? '');
	const chunks = source.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
	const posts: ExternalPost[] = [];

	for (const block of chunks) {
		const link = firstTag(block, ['link']) ?? attr(block, 'link', 'href') ?? '';
		const guid = firstTag(block, ['guid', 'id']) ?? link;
		const id = tweetIdFromUrl(link) ?? tweetIdFromUrl(guid) ?? (guid || '').trim();
		if (!id) continue;
		if (sinceId && compareIds(id, sinceId) <= 0) continue;

		// title معمولاً «RT by …» یا متن کوتاه است؛ description متن کامل‌تر دارد
		const description = firstTag(block, ['content:encoded', 'description', 'summary', 'content']) ?? '';
		const title = firstTag(block, ['title']) ?? '';
		const text = stripHtml(description || title);

		const media: ExternalMedia[] = [];
		const enclosure = attr(block, 'enclosure', 'url');
		const enclosureType = attr(block, 'enclosure', 'type') ?? '';
		if (enclosure) {
			media.push(
				enclosureType.startsWith('video')
					? { kind: 'video', url: enclosure }
					: { kind: 'photo', url: enclosure },
			);
		}
		for (const match of block.matchAll(/<media:(?:content|thumbnail)\b[^>]*\surl\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
			if (!media.some((m) => m.url === match[1])) media.push({ kind: 'photo', url: decodeXml(match[1]) });
		}
		// پل‌هایی که HTML داخل description می‌گذارند
		for (const match of block.matchAll(/<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) {
			const url = decodeXml(match[1]);
			if (!media.some((m) => m.url === url)) media.push({ kind: 'photo', url });
		}

		if (!text && media.length === 0) continue;

		posts.push({
			externalId: id,
			text: text || '',
			media: media.slice(0, MAX_X_IMAGES),
			createdAt: parseRssDate(firstTag(block, ['pubDate', 'published', 'updated', 'dc:date'])),
			url: link || xPostUrl(handle, id),
			unsupported: null,
		});
	}

	return sortByDate(posts);
}

/** ترتیب صعودی بر اساس زمان انتشار (پست‌هایی که تاریخ ندارند، ترتیب ورودی را حفظ می‌کنند) */
function sortByDate(posts: ExternalPost[]): ExternalPost[] {
	if (posts.every((post) => post.createdAt !== null)) {
		return posts.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
	}
	return posts;
}

function parseRssDate(raw: string | null): number | null {
	if (!raw) return null;
	const time = new Date(raw).getTime();
	return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

/** آخرین (بزرگ‌ترین) شناسه‌ی پست‌ها؛ کِرسر بعدی */
export function newestXPostId(posts: ExternalPost[], fallback: string | null): string | null {
	let best = fallback;
	for (const post of posts) {
		if (!best || compareIds(post.externalId, best) > 0) best = post.externalId;
	}
	return best;
}

/** مقایسه‌ی شناسه‌های عددیِ بزرگ بدون تبدیل به Number */
export function compareIds(a: string, b: string): number {
	const left = String(a ?? '');
	const right = String(b ?? '');
	if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
		if (left.length !== right.length) return left.length - right.length;
		return left < right ? -1 : left > right ? 1 : 0;
	}
	return left < right ? -1 : left > right ? 1 : 0;
}
