/**
 * خواندن پست‌های یک کانال **عمومی** از پیش‌نمایش وب تلگرام (`t.me/s/<username>`).
 *
 * چرا این مسیر؟
 *   Bot API هیچ راهی برای خواندن کانالی که بات در آن ادمین/عضو نیست ندارد:
 *   بات‌ها نمی‌توانند عضو کانال شوند و `getChatHistory` هم فقط در MTProto است.
 *   تنها منبع عمومی، همین صفحه‌ی وب است (همان چیزی که در مرورگر می‌بینید).
 *
 * محدودیت‌های ذاتی همین صفحه (باید در UI صادقانه گفته شود):
 *   - فقط کانال‌های **عمومی** (دارای @username).
 *   - فقط آخرین پست‌ها (~۲۰ مورد) در هر بار خواندن.
 *   - متن، عکس و ویدیوی کوچک بله؛ فایل، ویس، استیکر و نظرسنجی خیر.
 *
 * این فایل کاملاً خالص است: رشته می‌گیرد، داده می‌دهد — بدون شبکه، بدون D1.
 */

import { htmlToTextAndEntities, type HtmlTextEntity } from '../text/htmlToEntities.js';

export interface FeedMedia {
	kind: 'photo' | 'video';
	url: string;
}

export interface FeedPost {
	/** شناسه‌ی پیام در کانال (از `data-post="username/ID"`) */
	messageId: number;
	/** متن یا کپشن، بدون تگ */
	text: string;
	entities: HtmlTextEntity[];
	/** عکس‌ها/ویدیوهای همین پست؛ بیش از یکی = آلبوم */
	media: FeedMedia[];
	/** اگر محتوا از نوعی است که در وب قابل خواندن نیست: دلیل فارسی، وگرنه null */
	unsupported: string | null;
}

/** علامت‌های محتوایی که پیش‌نمایش وب قابل استفاده‌ای از آن‌ها نمی‌دهد */
const UNSUPPORTED_MARKERS: ReadonlyArray<{ needle: string; reason: string }> = [
	{ needle: 'tgme_widget_message_poll', reason: 'نظرسنجی (poll)' },
	{ needle: 'tgme_widget_message_document', reason: 'فایل/سند' },
	{ needle: 'tgme_widget_message_voice', reason: 'پیام صوتی (voice)' },
	{ needle: 'tgme_widget_message_roundvideo', reason: 'ویدیو پیام (round video)' },
	{ needle: 'tgme_widget_message_sticker', reason: 'استیکر' },
	{ needle: 'tgme_widget_message_location', reason: 'موقعیت مکانی' },
	{ needle: 'tgme_widget_message_contact', reason: 'مخاطب (contact)' },
];

function classTokens(tag: string): string[] {
	const match = tag.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
	return (match?.[2] ?? match?.[3] ?? '').split(/\s+/).filter(Boolean);
}

function unescapeUrl(raw: string): string {
	return raw
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&quot;/g, '"');
}

/** محتوای یک المان با شمارش عمق (برای div های تودرتو) */
export function extractElementInner(html: string, contentStart: number, tagName = 'div'): string {
	const pattern = new RegExp(`<(/?)${tagName}\\b`, 'gi');
	pattern.lastIndex = contentStart;
	let depth = 1;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(html)) !== null) {
		if (match[1] === '/') {
			depth--;
			if (depth === 0) return html.slice(contentStart, match.index);
		} else {
			depth++;
		}
	}
	return html.slice(contentStart);
}

/** URL تصویر یک بلوک عکس از `style="background-image:url('...')"` */
function backgroundUrl(tag: string): string | null {
	const match = tag.match(/background-image\s*:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
	return match ? unescapeUrl(match[1]) : null;
}

/**
 * پارس صفحه‌ی `t.me/s/<username>`.
 * @param html بدنه‌ی HTML صفحه
 * @param username اگر داده شود، فقط پست‌های همین کانال برداشته می‌شوند
 */
export function parsePublicFeed(html: string, username?: string): FeedPost[] {
	const source = String(html ?? '');
	const marker = /data-post="([A-Za-z0-9_]+)\/(\d+)"/g;

	const starts: Array<{ index: number; name: string; id: number }> = [];
	let match: RegExpExecArray | null;
	while ((match = marker.exec(source)) !== null) {
		starts.push({ index: match.index, name: match[1], id: Number(match[2]) });
	}

	const wanted = username?.replace(/^@/, '').toLowerCase();
	const posts: FeedPost[] = [];
	const seen = new Set<number>();

	for (let i = 0; i < starts.length; i++) {
		const start = starts[i];
		if (wanted && start.name.toLowerCase() !== wanted) continue;
		if (seen.has(start.id)) continue;

		const blockEnd = i + 1 < starts.length ? starts[i + 1].index : source.length;
		const block = source.slice(start.index, blockEnd);
		seen.add(start.id);
		posts.push(parsePostBlock(block, start.id));
	}

	return posts.sort((a, b) => a.messageId - b.messageId);
}

function parsePostBlock(block: string, messageId: number): FeedPost {
	// ── متن/کپشن ──
	let text = '';
	let entities: HtmlTextEntity[] = [];
	const textTag = /<div\b[^>]*>/gi;
	let tagMatch: RegExpExecArray | null;
	while ((tagMatch = textTag.exec(block)) !== null) {
		if (!classTokens(tagMatch[0]).includes('tgme_widget_message_text')) continue;
		const inner = extractElementInner(block, tagMatch.index + tagMatch[0].length);
		const parsed = htmlToTextAndEntities(inner);
		text = parsed.text;
		entities = parsed.entities;
		break;
	}

	// ── رسانه‌ها ──
	const media: FeedMedia[] = [];
	const seenUrls = new Set<string>();

	for (const tag of block.matchAll(/<(?:a|i|div)\b[^>]*>/gi)) {
		const classes = classTokens(tag[0]);
		const isPhoto = classes.includes('tgme_widget_message_photo_wrap') || classes.includes('tgme_widget_message_photo');
		if (!isPhoto) continue;
		const url = backgroundUrl(tag[0]);
		if (!url || seenUrls.has(url)) continue;
		seenUrls.add(url);
		media.push({ kind: 'photo', url });
	}

	for (const tag of block.matchAll(/<video\b[^>]*>/gi)) {
		const src = tag[0].match(/\s(?:src|data-src)\s*=\s*"([^"]+)"/i);
		if (!src) continue;
		const url = unescapeUrl(src[1]);
		if (seenUrls.has(url)) continue;
		seenUrls.add(url);
		media.push({ kind: 'video', url });
	}
	for (const tag of block.matchAll(/<source\b[^>]*>/gi)) {
		const src = tag[0].match(/\ssrc\s*=\s*"([^"]+)"/i);
		if (!src) continue;
		const url = unescapeUrl(src[1]);
		if (seenUrls.has(url) || media.some((m) => m.kind === 'video')) continue;
		seenUrls.add(url);
		media.push({ kind: 'video', url });
	}

	// ── محتوای پشتیبانی‌نشده ──
	let unsupported: string | null = null;
	if (media.length === 0) {
		for (const marker of UNSUPPORTED_MARKERS) {
			if (block.includes(marker.needle)) {
				unsupported = marker.reason;
				break;
			}
		}
		// ویدیویی که لینک مستقیم ندارد (تلگرام برای فایل‌های بزرگ فقط تصویر می‌دهد)
		if (!unsupported && block.includes('tgme_widget_message_video_player')) {
			unsupported = 'ویدیو (لینک مستقیم ندارد)';
		}
	}

	if (!unsupported && media.length === 0 && text.trim().length === 0) {
		unsupported = 'محتوای ناشناخته';
	}

	return { messageId, text, entities, media, unsupported };
}

/**
 * شناسه‌ی ساختگی برای یک کانال عمومی.
 *
 * چرا؟ هر قانون در `post_sources` با `source_channel_id` یکتا می‌شود و در دکمه‌ها/
 * `post_seen` همین عدد کلید است. برای کانالی که بات عضوش نیست، شناسه‌ی تلگرامی
 * را نداریم؛ پس از روی یوزرنیم یک عدد منفی **قطعی** می‌سازیم. بازه‌اش از
 * شناسه‌های واقعی کانال (`-100…`) جدا است، و همان یوزرنیم همیشه همان عدد را می‌دهد
 * (پس افزودن دوباره‌ی یک کانال، قانون تکراری نمی‌سازد).
 */
export function publicSourceChannelId(username: string): number {
	const clean = username.replace(/^@/, '').trim().toLowerCase();
	let hash = 0x811c9dc5; // FNV-1a
	for (let i = 0; i < clean.length; i++) {
		hash ^= clean.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return -(1_000_000 + (hash % 2_000_000_000));
}

/** یوزرنیم معتبر تلگرام (۴ تا ۳۲ کاراکتر، با حرف شروع می‌شود) */
export function isValidChannelUsername(raw: string): boolean {
	return /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(String(raw ?? '').trim());
}

/** نرمال‌سازی: بدون @ و با حروف کوچک */
export function normalizeUsername(raw: string): string {
	return String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
}

/** حداکثر تعداد رسانه در یک پست/آلبوم (سقف تلگرام) */
export const MAX_FEED_MEDIA = 10;

export function maxFeedMedia(): number {
	return MAX_FEED_MEDIA;
}

/** شناسه‌ی بزرگ‌ترین پیام صفحه (برای تعیین «از حالا به بعد») */
export function latestMessageId(posts: FeedPost[]): number {
	let max = 0;
	for (const post of posts) if (post.messageId > max) max = post.messageId;
	return max;
}
