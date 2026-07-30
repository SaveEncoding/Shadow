import { describe, it, expect } from 'vitest';
import { isDirectUserInteraction } from '../src/telegram/bot.js';

const BOT_ID = 999;

describe('isDirectUserInteraction', () => {
	it('counts any message in a private chat', () => {
		const ctx = { chat: { type: 'private' }, message: { text: 'hi' }, me: { id: BOT_ID } };
		expect(isDirectUserInteraction(ctx)).toBe(true);
	});

	it('counts a callback query (button press) even inside a group', () => {
		const ctx = { chat: { type: 'group' }, callbackQuery: { data: 'nav:0' }, me: { id: BOT_ID } };
		expect(isDirectUserInteraction(ctx)).toBe(true);
	});

	it('counts a command sent inside a group (e.g. /start)', () => {
		const ctx = { chat: { type: 'group' }, message: { text: '/start@ShadowBot' }, me: { id: BOT_ID } };
		expect(isDirectUserInteraction(ctx)).toBe(true);
	});

	it('counts a reply to the bot\'s own message inside a group', () => {
		const ctx = {
			chat: { type: 'supergroup' },
			message: { text: 'thanks!', reply_to_message: { from: { id: BOT_ID } } },
			me: { id: BOT_ID },
		};
		expect(isDirectUserInteraction(ctx)).toBe(true);
	});

	it('does NOT count a plain group message unrelated to the bot', () => {
		const ctx = {
			chat: { type: 'group' },
			message: { text: 'hey everyone, how is it going?' },
			me: { id: BOT_ID },
		};
		expect(isDirectUserInteraction(ctx)).toBe(false);
	});

	it('does NOT count a reply to a different user inside a group', () => {
		const ctx = {
			chat: { type: 'group' },
			message: { text: 'agreed', reply_to_message: { from: { id: 12345 } } },
			me: { id: BOT_ID },
		};
		expect(isDirectUserInteraction(ctx)).toBe(false);
	});
});
