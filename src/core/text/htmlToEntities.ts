/**
 * تبدیل HTML تلگرام (همان چیزی که در پیش‌نمایش وب کانال می‌آید) به متن + entities.
 *
 * چرا entities و نه `parse_mode: 'HTML'`؟
 *   - متن ذخیره‌شده در صف باید **متن خالص** باشد، چون ادمین ممکن است آن را ویرایش
 *     کند و آن‌وقت قالب‌بندی HTML دست‌ساز با متن جدید نمی‌خواند.
 *   - همان مسیر ارسال برای پست کانال، پست دستی و پست وب‌پیش‌نمایش استفاده می‌شود.
 *
 * دو نکته‌ی ظریف:
 *   ۱. تلگرام آفست/طول entities را بر حسب **واحد UTF-16** می‌شمارد؛ همان چیزی که
 *      `string.length` در جاوااسکریپت برمی‌گرداند. پس ایموجی (سوروگیت‌پیر) خودبه‌خود
 *      درست حساب می‌شود.
 *   ۲. entities نباید **هم‌پوشانی جزئی** داشته باشند. تگ‌های تودرتو (مثل
 *      `<b>a<i>b</i>c</b>`) با پیمایش کاراکتری به بازه‌های تخت شکسته می‌شوند؛
 *      نتیجه همیشه معتبر است.
 */

/** انواع entity که تولید می‌کنیم (زیرمجموعه‌ی MessageEntity تلگرام) */
export type HtmlEntityType =
	| 'bold'
	| 'italic'
	| 'underline'
	| 'strikethrough'
	| 'spoiler'
	| 'code'
	| 'pre'
	| 'blockquote'
	| 'text_link';

export interface HtmlTextEntity {
	type: HtmlEntityType;
	/** آفست بر حسب واحد UTF-16 */
	offset: number;
	length: number;
	/** فقط برای text_link */
	url?: string;
	/** فقط برای pre (زبان) */
	language?: string;
}

export interface HtmlToTextResult {
	text: string;
	entities: HtmlTextEntity[];
}

interface OpenFormat {
	type: HtmlEntityType;
	url?: string;
	language?: string;
	start: number;
}

const TAG_NAMES: Record<string, HtmlEntityType> = {
	b: 'bold',
	strong: 'bold',
	i: 'italic',
	em: 'italic',
	u: 'underline',
	ins: 'underline',
	s: 'strikethrough',
	strike: 'strikethrough',
	del: 'strikethrough',
	code: 'code',
	pre: 'pre',
	blockquote: 'blockquote',
	'tg-spoiler': 'spoiler',
};

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	laquo: '«',
	raquo: '»',
};

/** رمزگشایی entity های HTML (`&amp;`، `&#39;`، `&#x1F600;`) */
export function decodeHtmlEntities(input: string): string {
	if (!input.includes('&')) return input;
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body.startsWith('#x') || body.startsWith('#X')) {
			const code = Number.parseInt(body.slice(2), 16);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
		}
		if (body.startsWith('#')) {
			const code = Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
		}
		const named = NAMED_ENTITIES[body.toLowerCase()];
		return named ?? match;
	});
}

function attrValue(tag: string, name: string): string | null {
	const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
	if (!match) return null;
	return decodeHtmlEntities(match[2] ?? match[3] ?? '');
}

/** تگ باز → فرمت؛ پیش‌فرض null (تگ ناشناخته نادیده گرفته می‌شود) */
function formatOfTag(tag: string): OpenFormat | null {
	const nameMatch = tag.match(/^<\s*([a-zA-Z][\w-]*)/);
	if (!nameMatch) return null;
	const name = nameMatch[1].toLowerCase();

	// <span class="tg-spoiler">
	if (name === 'span') {
		const cls = attrValue(tag, 'class') ?? '';
		if (cls.split(/\s+/).includes('tg-spoiler')) {
			return { type: 'spoiler', start: 0 };
		}
		return null;
	}

	if (name === 'a') {
		const href = attrValue(tag, 'href');
		if (!href) return null;
		// فقط لینک‌های واقعی؛ mention/هشتگ را خود تلگرام از متن می‌شناسد.
		// (tg://user منشن است و به‌عنوان text_link مجاز نیست)
		if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
		return { type: 'text_link', url: href, start: 0 };
	}

	if (name === 'code') {
		const cls = attrValue(tag, 'class') ?? '';
		const lang = cls.match(/language-([\w+#-]+)/);
		return { type: 'code', language: lang?.[1], start: 0 };
	}

	const type = TAG_NAMES[name];
	return type ? { type, start: 0 } : null;
}

/** آیا این تگ، تگ بستنِ همان فرمت است؟ (برای بستن تودرتوها) */
function closes(tag: string, open: OpenFormat): boolean {
	const nameMatch = tag.match(/^<\s*\/\s*([a-zA-Z][\w-]*)/);
	if (!nameMatch) return false;
	const name = nameMatch[1].toLowerCase();

	if (open.type === 'text_link') return name === 'a';
	if (open.type === 'spoiler') return name === 'span';
	if (open.type === 'code') return name === 'code';
	if (open.type === 'pre') return name === 'pre';

	return TAG_NAMES[name] === open.type;
}

/**
 * HTML → متن خالص + entities.
 * @param html ورودی (می‌تواند شامل تگ‌های ناشناخته باشد؛ نادیده گرفته می‌شوند)
 * @param options.trim فاصله‌های ابتدا/انتها حذف شوند (پیش‌فرض: بله) و آفست‌ها اصلاح شوند
 */
export function htmlToTextAndEntities(html: string, options: { trim?: boolean } = {}): HtmlToTextResult {
	const source = String(html ?? '');
	const stack: OpenFormat[] = [];
	const raw: HtmlTextEntity[] = [];
	let text = '';

	const pushText = (chunk: string) => {
		if (chunk) text += decodeHtmlEntities(chunk);
	};

	const closeFormat = (open: OpenFormat) => {
		const length = text.length - open.start;
		if (length <= 0) return;
		const entity: HtmlTextEntity = { type: open.type, offset: open.start, length };
		if (open.type === 'text_link' && open.url) entity.url = open.url;
		if (open.type === 'pre' && open.language) entity.language = open.language;
		raw.push(entity);
	};

	let index = 0;
	while (index < source.length) {
		const nextTag = source.indexOf('<', index);
		if (nextTag === -1) {
			pushText(source.slice(index));
			break;
		}
		if (nextTag > index) pushText(source.slice(index, nextTag));

		const tagEnd = source.indexOf('>', nextTag);
		if (tagEnd === -1) {
			// تگ ناتمام: بقیه‌ی متن خام در نظر گرفته می‌شود
			pushText(source.slice(nextTag));
			break;
		}

		const tag = source.slice(nextTag, tagEnd + 1);
		const isClosing = /^<\s*\//.test(tag);
		const isComment = tag.startsWith('<!--');
		const selfClosing = /\/>$/.test(tag);

		if (isComment) {
			// رد کردن کامل کامنت
			const commentEnd = source.indexOf('-->', nextTag);
			index = commentEnd === -1 ? tagEnd + 1 : commentEnd + 3;
			continue;
		}

		if (isClosing) {
			const openIndex = [...stack].reverse().findIndex((open) => closes(tag, open));
			if (openIndex !== -1) {
				const realIndex = stack.length - 1 - openIndex;
				// فرمت‌های بازترِ درونی هم بسته می‌شوند (HTML بی‌نظم)
				while (stack.length > realIndex) {
					const open = stack.pop();
					if (open) closeFormat(open);
				}
			}
			index = tagEnd + 1;
			continue;
		}

		const nameMatch = tag.match(/^<\s*([a-zA-Z][\w-]*)/);
		const name = nameMatch?.[1].toLowerCase();

		if (name === 'br') {
			pushText('\n');
			index = tagEnd + 1;
			continue;
		}
		// بلوک‌ها: خط جدید قبل از شروع (تا پاراگراف‌ها به هم نچسبند)
		if ((name === 'p' || name === 'div' || name === 'blockquote') && text.length > 0 && !text.endsWith('\n')) {
			pushText('\n');
		}

		const format = formatOfTag(tag);
		if (format && !selfClosing) {
			// pre داخل code: زبان را از code بگیرد
			format.start = text.length;
			stack.push(format);
		}

		index = tagEnd + 1;
	}

	// تگ‌های بسته‌نشده: تا انتهای متن باز می‌مانند
	while (stack.length > 0) {
		const open = stack.pop();
		if (open) closeFormat(open);
	}

	const trimmed = options.trim ?? true;
	if (!trimmed) {
		return { text, entities: flatten(raw, text.length) };
	}
	return trimResult(text, raw);
}

/** بریدن فاصله‌های ابتدا/انتها با اصلاح آفست entity ها */
function trimResult(text: string, raw: HtmlTextEntity[]): HtmlToTextResult {
	const leading = text.length - text.replace(/^\s+/, '').length;
	const trailing = text.length - text.replace(/\s+$/, '').length;
	const end = text.length - trailing;
	const clean = text.slice(leading, Math.max(leading, end));

	const shifted: HtmlTextEntity[] = [];
	for (const entity of raw) {
		const start = entity.offset;
		const stop = entity.offset + entity.length;
		const from = Math.max(start, leading);
		const to = Math.min(stop, end);
		if (to <= from) continue;
		shifted.push({ ...entity, offset: from - leading, length: to - from });
	}

	return { text: clean, entities: flatten(shifted, clean.length) };
}

/**
 * تبدیل بازه‌های تودرتو به بازه‌های **بدون هم‌پوشانی جزئی**.
 *
 * مثال: `bold 0..5` و `italic 2..3` → `bold 0..2`, `bold+italic 2..3`,
 * `bold 3..5`. این همان چیزی است که تلگرام از HTML تودرتو می‌سازد و می‌پذیرد.
 */
export function flatten(entities: HtmlTextEntity[], textLength: number): HtmlTextEntity[] {
	const valid = entities.filter((e) => e.length > 0 && e.offset >= 0 && e.offset + e.length <= textLength);
	if (valid.length === 0) return [];

	const active: Array<Set<number>> = Array.from({ length: textLength }, () => new Set<number>());
	valid.forEach((entity, index) => {
		for (let p = entity.offset; p < entity.offset + entity.length; p++) active[p].add(index);
	});

	const result: HtmlTextEntity[] = [];
	let i = 0;
	while (i < textLength) {
		const set = active[i];
		let j = i + 1;
		while (j < textLength && sameSet(active[j], set)) j++;

		if (set.size > 0) {
			for (const index of [...set].sort((a, b) => a - b)) {
				const entity = valid[index];
				const piece: HtmlTextEntity = { type: entity.type, offset: i, length: j - i };
				if (entity.type === 'text_link' && entity.url) piece.url = entity.url;
				if (entity.type === 'pre' && entity.language) piece.language = entity.language;
				result.push(piece);
			}
		}
		i = j;
	}

	// ترتیب پایدار: اول بر اساس آفست، بعد بازه‌ی بزرگ‌تر، بعد نوع
	return result.sort((a, b) => a.offset - b.offset || b.length - a.length || a.type.localeCompare(b.type));
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) if (!b.has(value)) return false;
	return true;
}
