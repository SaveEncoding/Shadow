import { describe, it, expect } from 'vitest';
import {
	appendSuffixPreservingEntities,
	shouldSkipAutoSuffix,
	extractEditableContent,
	attachBotStamp,
	hasValidBotStamp,
	stripBotStamp,
} from '../src/telegram/utils/messageSuffix.js';

/**
 * Mirrors the decision tree of autoApplySuffixToChannelPost without I/O.
 */
function decideAutoSuffix({ text, entities, suffix, marker, maxLen = 4096 }) {
	if (!suffix) return { apply: false, reason: 'no_suffix' };
	if (hasValidBotStamp(text)) return { apply: false, reason: 'bot_stamped' };
	const body = stripBotStamp(text).text;
	if (shouldSkipAutoSuffix(body, marker)) return { apply: false, reason: 'skip_marker' };
	const result = appendSuffixPreservingEntities(body, entities, suffix, { maxLen });
	if (result.skipped) return { apply: false, reason: result.skipped };
	const stamped = attachBotStamp(result.text);
	return { apply: true, reason: null, result, stamped };
}

describe('auto suffix decision tree', () => {
	it('applies when suffix set and no marker', () => {
		const d = decideAutoSuffix({
			text: 'خبر روز',
			entities: [{ type: 'bold', offset: 0, length: 3 }],
			suffix: '— @chan',
			marker: '#nosuffix',
		});
		expect(d.apply).toBe(true);
		expect(d.result.text).toContain('— @chan');
		expect(d.result.entities[0].offset).toBe(0);
		expect(hasValidBotStamp(d.stamped)).toBe(true);
	});

	it('skips when marker present in body', () => {
		const d = decideAutoSuffix({
			text: 'خبر محرمانه #nosuffix',
			entities: [],
			suffix: '— @chan',
			marker: '#nosuffix',
		});
		expect(d.apply).toBe(false);
		expect(d.reason).toBe('skip_marker');
	});

	it('skips when no suffix configured', () => {
		const d = decideAutoSuffix({
			text: 'خبر',
			entities: [],
			suffix: null,
			marker: null,
		});
		expect(d.reason).toBe('no_suffix');
	});

	it('skips edited_channel_post echo when stamp is valid', () => {
		const once = decideAutoSuffix({
			text: 'پست اولیه',
			entities: [],
			suffix: '— @chan',
			marker: null,
		});
		expect(once.apply).toBe(true);

		const echo = decideAutoSuffix({
			text: once.stamped,
			entities: [],
			suffix: '— @chan',
			marker: null,
		});
		expect(echo.apply).toBe(false);
		expect(echo.reason).toBe('bot_stamped');
	});

	it('re-applies after admin changes the body (stamp invalid)', () => {
		const once = decideAutoSuffix({
			text: 'پست اولیه',
			entities: [],
			suffix: '— @chan',
			marker: null,
		});
		const stampTail = once.stamped.slice(stripBotStamp(once.stamped).text.length);
		const adminText = 'پست ادیت‌شده توسط ادمین' + stampTail;

		const again = decideAutoSuffix({
			text: adminText,
			entities: [],
			suffix: '— @chan',
			marker: null,
		});
		expect(again.apply).toBe(true);
		expect(again.result.text).toContain('پست ادیت‌شده توسط ادمین');
		expect(again.result.text).toContain('— @chan');
	});

	it('extracts caption from channel_post-like objects', () => {
		const c = extractEditableContent({ caption: 'عکس خبر', photo: [{}] });
		expect(c.kind).toBe('caption');
	});
});
