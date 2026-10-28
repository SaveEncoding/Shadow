/**
 * شکستن متن بلند به چند پیام، **بدون از دست دادن قالب‌بندی**.
 *
 * چرا لازم است؟
 *   - سقف متن یک پیام تلگرام ۴۰۹۶ کاراکتر و سقف کپشن رسانه ۱۰۲۴ کاراکتر است.
 *   - پست‌های کانال‌های خبری (که از پیش‌نمایش وب می‌خوانیم) مرتب بلندترند.
 *   - اگر فقط برش بزنیم، یا متن گم می‌شود یا تلگرام با خطای ۴۰۰ رد می‌کند.
 *
 * قاعده: اول در مرز پاراگراف، بعد خط، بعد فاصله. هیچ کاراکتری حذف نمی‌شود؛
 * entity هایی که روی مرز می‌افتند به دو تکه تقسیم می‌شوند.
 */

import type { HtmlTextEntity } from './htmlToEntities.js';

export interface MessagePart {
	text: string;
	entities: HtmlTextEntity[];
}

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_CAPTION_LENGTH = 1024;

/** برش متن + اصلاح آفست entity هایی که با بازه تلاقی دارند */
export function sliceWithEntities(
	text: string,
	entities: HtmlTextEntity[],
	start: number,
	end: number,
): MessagePart {
	const piece = text.slice(start, end);
	const shifted: HtmlTextEntity[] = [];
	for (const entity of entities) {
		const from = Math.max(entity.offset, start);
		const to = Math.min(entity.offset + entity.length, end);
		if (to <= from) continue;
		const next: HtmlTextEntity = { ...entity, offset: from - start, length: to - from };
		shifted.push(next);
	}
	return { text: piece, entities: shifted };
}

/** حذف فاصله‌های ابتدای یک قطعه، با جابه‌جا کردن/بریدن entity ها */
function trimLeading(part: MessagePart): MessagePart {
	const trimmedText = part.text.replace(/^\s+/, '');
	const removed = part.text.length - trimmedText.length;
	if (removed === 0) return part;

	const entities: HtmlTextEntity[] = [];
	for (const entity of part.entities) {
		const from = entity.offset + entity.length <= removed ? null : Math.max(entity.offset, removed);
		if (from === null) continue;
		const to = entity.offset + entity.length;
		entities.push({ ...entity, offset: from - removed, length: to - from });
	}
	return { text: trimmedText, entities };
}

/** انتخاب نقطه‌ی برش نزدیک به سقف (مرز پاراگراف ← خط ← فاصله) */
function findCut(text: string, start: number, limit: number): number {
	const hardEnd = Math.min(start + limit, text.length);
	if (hardEnd >= text.length) return text.length;

	const window = text.slice(start, hardEnd);
	const minimum = Math.floor(limit * 0.5); // جلوگیری از تکه‌های بسیار کوتاه

	for (const separator of ['\n\n', '\n', '. ', ' ']) {
		const at = window.lastIndexOf(separator);
		if (at >= minimum) return start + at + separator.length;
	}
	return hardEnd;
}

/**
 * شکستن متن به پیام‌های مجاز.
 * @param maxLength سقف طول هر پیام (پیش‌فرض ۴۰۰۰ کاراکتر)
 */
export function splitTextWithEntities(
	text: string,
	entities: HtmlTextEntity[] = [],
	maxLength: number = MAX_MESSAGE_LENGTH,
): MessagePart[] {
	const limit = Math.max(100, Math.floor(maxLength));
	if (text.length <= limit) return [{ text, entities }];

	const parts: MessagePart[] = [];
	let cursor = 0;

	while (cursor < text.length) {
		const cut = findCut(text, cursor, limit);
		const raw = sliceWithEntities(text, entities, cursor, cut);
		const part = parts.length === 0 ? raw : trimLeading(raw);
		if (part.text.trim().length > 0) parts.push(part);
		cursor = cut;
	}

	return parts.length > 0 ? parts : [{ text, entities }];
}
