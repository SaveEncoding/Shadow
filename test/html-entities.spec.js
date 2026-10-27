import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, flatten, htmlToTextAndEntities } from '../src/core/text/htmlToEntities.js';
import {
	MAX_CAPTION_LENGTH,
	MAX_MESSAGE_LENGTH,
	sliceWithEntities,
	splitTextWithEntities,
} from '../src/core/text/split.js';

describe('decodeHtmlEntities', () => {
	it('decodes named, decimal and hex entities', () => {
		expect(decodeHtmlEntities('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
		expect(decodeHtmlEntities('&#39;x&#39;')).toBe("'x'");
		expect(decodeHtmlEntities('&#x1F600;')).toBe('😀');
		expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
	});

	it('leaves unknown entities untouched and is cheap for plain text', () => {
		expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;');
		expect(decodeHtmlEntities('بدون انتیتی')).toBe('بدون انتیتی');
	});
});

describe('htmlToTextAndEntities', () => {
	it('strips tags and keeps bold/italic/underline/strike/spoiler', () => {
		const { text, entities } = htmlToTextAndEntities(
			'<b>bold</b> plain <i>it</i> <u>u</u> <s>s</s> <tg-spoiler>sp</tg-spoiler>',
		);
		expect(text).toBe('bold plain it u s sp');
		const types = entities.map((e) => e.type).sort();
		expect(types).toEqual(['bold', 'italic', 'spoiler', 'strikethrough', 'underline']);
		expect(entities.find((e) => e.type === 'bold')).toMatchObject({ offset: 0, length: 4 });
	});

	it('keeps links as text_link with the url', () => {
		const { text, entities } = htmlToTextAndEntities('به <a href="https://example.com/x">اینجا</a> برو');
		expect(text).toBe('به اینجا برو');
		expect(entities).toEqual([
			{ type: 'text_link', offset: 3, length: 5, url: 'https://example.com/x' },
		]);
	});

	it('ignores non-http links (mentions/hashtags are detected by Telegram itself)', () => {
		const { text, entities } = htmlToTextAndEntities('<a href="tg://user?id=1">Ali</a>');
		expect(text).toBe('Ali');
		expect(entities).toEqual([]);
	});

	it('handles code and pre with language', () => {
		const { text, entities } = htmlToTextAndEntities('<pre><code class="language-js">let x = 1;</code></pre>');
		expect(text).toBe('let x = 1;');
		expect(entities.map((e) => e.type).sort()).toEqual(['code', 'pre']);
	});

	it('splits nested formatting into flat, non-overlapping entities', () => {
		// <b>a<i>b</i>c</b> → bold(0..3) + italic(1..2) ولی بدون هم‌پوشانی جزئی
		const { text, entities } = htmlToTextAndEntities('<b>a<i>b</i>c</b>');
		expect(text).toBe('abc');

		const spans = entities.map((e) => `${e.type}:${e.offset}-${e.offset + e.length}`).sort();
		expect(spans).toEqual(['bold:0-1', 'bold:1-2', 'bold:2-3', 'italic:1-2']);

		// هیچ هم‌پوشانی جزئی وجود ندارد
		for (const a of entities) {
			for (const b of entities) {
				if (a === b) continue;
				const overlapStart = Math.max(a.offset, b.offset);
				const overlapEnd = Math.min(a.offset + a.length, b.offset + b.length);
				const overlap = overlapEnd - overlapStart;
				expect(overlap <= 0 || overlap === a.length || overlap === b.length).toBe(true);
			}
		}
	});

	it('handles <br> as a line break and blockquote as a new paragraph', () => {
		const { text } = htmlToTextAndEntities('خط اول<br>خط دوم<blockquote>نقل قول</blockquote>');
		expect(text).toBe('خط اول\nخط دوم\nنقل قول');
	});

	it('drops comments and unknown tags', () => {
		const { text } = htmlToTextAndEntities('a<!-- note -->b<span class="x">c</span>d');
		expect(text).toBe('abcd');
	});

	it('counts offsets in UTF-16 units (emoji safe)', () => {
		const { text, entities } = htmlToTextAndEntities('😀 <b>ok</b>');
		expect(text).toBe('😀 ok');
		// ایموجی دو واحد است، پس «ok» از آفست ۳ شروع می‌شود
		expect(entities[0]).toMatchObject({ type: 'bold', offset: 3, length: 2 });
	});

	it('closes unclosed tags at the end', () => {
		const { text, entities } = htmlToTextAndEntities('<b>ناتمام');
		expect(text).toBe('ناتمام');
		expect(entities[0]).toMatchObject({ type: 'bold', offset: 0, length: 6 });
	});

	it('trims whitespace and corrects offsets', () => {
		const { text, entities } = htmlToTextAndEntities('  <b>hi</b>  ');
		expect(text).toBe('hi');
		expect(entities[0]).toMatchObject({ offset: 0, length: 2 });
	});

	it('drops zero-length formatting', () => {
		const { entities } = htmlToTextAndEntities('a<b></b>b');
		expect(entities).toEqual([]);
	});
});

describe('flatten', () => {
	it('merges identical ranges and keeps distinct ones', () => {
		const flat = flatten(
			[
				{ type: 'bold', offset: 0, length: 4 },
				{ type: 'italic', offset: 0, length: 4 },
				{ type: 'underline', offset: 2, length: 4 },
			],
			8,
		);
		expect(flat.filter((e) => e.offset === 0 && e.length === 2).map((e) => e.type).sort()).toEqual(['bold', 'italic']);
		expect(flat.filter((e) => e.offset === 2 && e.length === 2).map((e) => e.type).sort()).toEqual([
			'bold',
			'italic',
			'underline',
		]);
	});
});

describe('splitTextWithEntities', () => {
	it('keeps short text in one part', () => {
		const parts = splitTextWithEntities('سلام', [{ type: 'bold', offset: 0, length: 4 }]);
		expect(parts).toHaveLength(1);
		expect(parts[0].text).toBe('سلام');
	});

	it('splits at paragraph boundaries and keeps every character', () => {
		const paragraph = 'خط ' + 'ا'.repeat(60);
		const text = Array.from({ length: 10 }, () => paragraph).join('\n\n');
		const parts = splitTextWithEntities(text, [], 200);

		expect(parts.length).toBeGreaterThan(1);
		for (const part of parts) expect(part.text.length).toBeLessThanOrEqual(200);
		expect(parts.map((p) => p.text).join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
	});

	it('splits entities across the boundary and keeps them valid', () => {
		const text = 'ا'.repeat(100) + 'B'.repeat(100);
		const parts = splitTextWithEntities(text, [{ type: 'bold', offset: 80, length: 60 }], 100);

		expect(parts).toHaveLength(2);
		// تکه‌ی اول: bold از ۸۰ تا ۱۰۰
		expect(parts[0].entities).toEqual([{ type: 'bold', offset: 80, length: 20 }]);
		// تکه‌ی دوم: bold از ۰ تا ۴۰
		expect(parts[1].entities).toEqual([{ type: 'bold', offset: 0, length: 40 }]);
	});

	it('uses the caption limit for captions', () => {
		const parts = splitTextWithEntities('x'.repeat(2000), [], MAX_CAPTION_LENGTH);
		expect(parts.length).toBe(2);
		expect(parts[0].text.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
	});

	it('never exceeds the message limit and never drops text', () => {
		const text = 'کلمه '.repeat(2000); // ~۱۰۰۰۰ کاراکتر
		const parts = splitTextWithEntities(text);
		expect(parts.length).toBeGreaterThan(1);
		for (const part of parts) expect(part.text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
		expect(parts.map((p) => p.text).join('').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
	});

	it('slices without losing the tail', () => {
		const part = sliceWithEntities('abcdef', [{ type: 'bold', offset: 1, length: 4 }], 2, 5);
		expect(part.text).toBe('cde');
		expect(part.entities).toEqual([{ type: 'bold', offset: 0, length: 3 }]);
	});
});
