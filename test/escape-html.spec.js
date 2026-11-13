import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/core/text/escape.js';
import * as telegramService from '../src/telegram/services/telegramService.js';

describe('escapeHtml', () => {
	it('escapes the three characters Telegram treats as markup', () => {
		expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
	});

	it('does not double-escape or touch quotes', () => {
		expect(escapeHtml('"quoted" & \'single\'')).toBe('"quoted" &amp; \'single\'');
		expect(escapeHtml('&amp;')).toBe('&amp;amp;');
	});

	it('matches what Telegram needs for a channel title with markup in it', () => {
		expect(escapeHtml('<b>hi</b>')).toBe('&lt;b&gt;hi&lt;/b&gt;');
	});

	it('coerces non-strings instead of throwing', () => {
		// نسخه‌ی قبلی در features/chess.js روی ورودی غیر رشته‌ای خطا می‌داد؛
		// نسخه‌ی واحد باید مثل بقیه String() کند.
		expect(escapeHtml(42)).toBe('42');
		expect(escapeHtml(null)).toBe('null');
		expect(escapeHtml(undefined)).toBe('undefined');
	});

	it('is a real local binding inside telegramService, not only a re-export', async () => {
		// `export { x } from '...'` نام محلی نمی‌سازد؛ اگر sendMessage به binding
		// محلی دسترسی نداشته باشد، همین تست با ReferenceError می‌شکند.
		const originalFetch = globalThis.fetch;
		let body = '';
		globalThis.fetch = async (_url, init) => {
			body = String(init?.body ?? '');
			return new Response(JSON.stringify({ ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};
		try {
			await telegramService.sendMessage({ TELEGRAM_TOKEN: 'test-token' }, 1, 'a <b> c');
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(body).toContain('a &lt;b&gt; c');
	});

	it('is the same function everywhere it is imported from', () => {
		// telegramService فقط re-export می‌کند؛ یک پیاده‌سازی، نه دو تا.
		expect(telegramService.escapeHtml).toBe(escapeHtml);
		expect(telegramService.escapeHtml('<x>')).toBe(escapeHtml('<x>'));
	});
});
