import { describe, it, expect } from 'vitest';
import {
	setPendingInput,
	getPendingInput,
	clearPendingInput,
} from '../src/telegram/ui/pendingInput.js';
import {
	channelSuffixKeyboard,
	channelSkipKeyboard,
	awaitInputKeyboard,
} from '../src/telegram/ui/screens.js';

describe('pendingInput', () => {
	it('stores and clears per user', () => {
		setPendingInput(42, { type: 'suffix', channelId: -1001 });
		expect(getPendingInput(42).type).toBe('suffix');
		clearPendingInput(42);
		expect(getPendingInput(42)).toBeNull();
	});
});

describe('suffix glass keyboards', () => {
	it('includes set/clear callbacks', () => {
		const rows = channelSuffixKeyboard(-100123).inline_keyboard.flat().map((b) => b.callback_data);
		expect(rows).toContain('m:cs:set:-100123');
		expect(rows).toContain('m:cs:clr:-100123');
	});

	it('await keyboard can cancel', () => {
		const rows = awaitInputKeyboard(-100123, 'suffix').inline_keyboard.flat().map((b) => b.callback_data);
		expect(rows).toContain('m:cs:x:-100123');
	});

	it('skip keyboard includes set callback', () => {
		const rows = channelSkipKeyboard(-9).inline_keyboard.flat().map((b) => b.callback_data);
		expect(rows).toContain('m:sk:set:-9');
	});
});
