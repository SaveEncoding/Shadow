import { describe, it, expect } from 'vitest';
import {
	appendSuffixPreservingEntities,
	shouldSkipAutoSuffix,
	extractEditableContent,
} from '../src/telegram/utils/messageSuffix.js';

/**
 * Mirrors the decision tree of autoApplySuffixToChannelPost without I/O.
 */
function decideAutoSuffix({ text, entities, suffix, marker, maxLen = 4096 }) {
	if (!suffix) return { apply: false, reason: 'no_suffix' };
	if (shouldSkipAutoSuffix(text, marker)) return { apply: false, reason: 'skip_marker' };
	const result = appendSuffixPreservingEntities(text, entities, suffix, { maxLen });
	if (result.skipped) return { apply: false, reason: result.skipped };
	return { apply: true, reason: null, result };
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

	it('extracts caption from channel_post-like objects', () => {
		const c = extractEditableContent({ caption: 'عکس خبر', photo: [{}] });
		expect(c.kind).toBe('caption');
	});
});
