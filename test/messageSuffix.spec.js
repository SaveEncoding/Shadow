import { describe, it, expect } from 'vitest';
import {
	appendSuffixPreservingEntities,
	extractEditableContent,
	shouldSkipAutoSuffix,
	attachBotStamp,
	stripBotStamp,
	hasValidBotStamp,
	hashContent,
	TEXT_MAX_LENGTH,
	CAPTION_MAX_LENGTH,
} from '../src/telegram/utils/messageSuffix.js';

describe('appendSuffixPreservingEntities', () => {
	it('appends suffix and keeps original entity offsets', () => {
		const entities = [{ type: 'bold', offset: 0, length: 5 }];
		const result = appendSuffixPreservingEntities('Hello world', entities, '— @chan');
		expect(result.skipped).toBeNull();
		expect(result.text).toBe('Hello world\n\n— @chan');
		expect(result.entities[0]).toEqual({ type: 'bold', offset: 0, length: 5 });
		expect(result.entities).toHaveLength(1);
	});

	it('shifts suffixEntities by base + separator length', () => {
		const result = appendSuffixPreservingEntities(
			'Hi',
			[],
			'FOOT',
			{ suffixEntities: [{ type: 'bold', offset: 0, length: 4 }] }
		);
		expect(result.entities[0].offset).toBe(4);
		expect(result.entities[0].length).toBe(4);
	});

	it('skips when suffix already present', () => {
		const text = 'Body\n\n/official';
		const result = appendSuffixPreservingEntities(text, [], '/official');
		expect(result.skipped).toBe('already_present');
		expect(result.text).toBe(text);
	});

	it('strips leftover stamp before checking already_present', () => {
		const body = 'Body\n\n/official';
		const stamped = attachBotStamp(body);
		const result = appendSuffixPreservingEntities(stamped, [], '/official');
		expect(result.skipped).toBe('already_present');
		expect(result.text).toBe(body);
	});

	it('skips empty suffix', () => {
		const result = appendSuffixPreservingEntities('Body', [], '');
		expect(result.skipped).toBe('empty_suffix');
	});

	it('skips when result would exceed maxLen (including stamp budget)', () => {
		const result = appendSuffixPreservingEntities(
			'x'.repeat(100),
			[],
			'y'.repeat(50),
			{ maxLen: 120 }
		);
		expect(result.skipped).toBe('too_long');
	});

	it('uses caption max length constant', () => {
		expect(CAPTION_MAX_LENGTH).toBe(1024);
		expect(TEXT_MAX_LENGTH).toBe(4096);
	});

	it('does not mutate the input entities array', () => {
		const entities = [{ type: 'italic', offset: 1, length: 2 }];
		const copy = [...entities];
		appendSuffixPreservingEntities('abc', entities, 'Z');
		expect(entities).toEqual(copy);
	});
});

describe('bot content stamp', () => {
	it('attach + strip round-trips with valid=true', () => {
		const body = 'خبر روز\n\n— @chan';
		const stamped = attachBotStamp(body);
		expect(stamped.startsWith(body)).toBe(true);
		expect(stamped.length).toBeGreaterThan(body.length);
		expect(hasValidBotStamp(stamped)).toBe(true);

		const stripped = stripBotStamp(stamped);
		expect(stripped.text).toBe(body);
		expect(stripped.hadStamp).toBe(true);
		expect(stripped.valid).toBe(true);
	});

	it('invalidates when body is changed (admin edit)', () => {
		const stamped = attachBotStamp('original body\n\n— @chan');
		// Admin rewrites the visible body but leaves trailing invisible junk partially
		const adminEdited = 'NEW body by admin\n\n— @chan' + stamped.slice(stamped.indexOf('\u2060'));
		// Stamp payload still encodes hash of old body → invalid
		expect(hasValidBotStamp(adminEdited)).toBe(false);

		const fullyReplaced = 'completely new text without stamp';
		expect(hasValidBotStamp(fullyReplaced)).toBe(false);
	});

	it('invalidates when only the middle of the body changes', () => {
		const body = 'AAA\n\n— @chan';
		const stamped = attachBotStamp(body);
		const stampOnly = stamped.slice(body.length);
		const tampered = 'BBB\n\n— @chan' + stampOnly;
		expect(hasValidBotStamp(tampered)).toBe(false);
		expect(stripBotStamp(tampered).text).toBe('BBB\n\n— @chan');
	});

	it('hashContent is stable', () => {
		expect(hashContent('abc')).toBe(hashContent('abc'));
		expect(hashContent('abc')).not.toBe(hashContent('abd'));
	});
});

describe('extractEditableContent', () => {
	it('reads text messages', () => {
		const c = extractEditableContent({
			text: 'Hello',
			entities: [{ type: 'bold', offset: 0, length: 5 }],
		});
		expect(c.kind).toBe('text');
		expect(c.text).toBe('Hello');
		expect(c.maxLen).toBe(TEXT_MAX_LENGTH);
		expect(c.entities).toHaveLength(1);
	});

	it('reads captions', () => {
		const c = extractEditableContent({
			caption: 'Cap',
			caption_entities: [{ type: 'spoiler', offset: 0, length: 3 }],
			photo: [{}],
		});
		expect(c.kind).toBe('caption');
		expect(c.maxLen).toBe(CAPTION_MAX_LENGTH);
		expect(c.entities[0].type).toBe('spoiler');
	});

	it('returns null kind when neither text nor caption', () => {
		const c = extractEditableContent({ sticker: {} });
		expect(c.kind).toBeNull();
	});
});

describe('shouldSkipAutoSuffix', () => {
	it('returns false when marker is empty or null', () => {
		expect(shouldSkipAutoSuffix('hello #nosuffix', null)).toBe(false);
		expect(shouldSkipAutoSuffix('hello', '')).toBe(false);
	});

	it('returns true when marker substring is present', () => {
		expect(shouldSkipAutoSuffix('خبر فوری #nosuffix', '#nosuffix')).toBe(true);
		expect(shouldSkipAutoSuffix('🚫 بدون امضا', '🚫')).toBe(true);
	});

	it('returns false when marker is absent', () => {
		expect(shouldSkipAutoSuffix('خبر عادی', '#nosuffix')).toBe(false);
	});

	it('is case-sensitive (admins control exact characters)', () => {
		expect(shouldSkipAutoSuffix('NoSuffix', 'nosuffix')).toBe(false);
		expect(shouldSkipAutoSuffix('nosuffix', 'nosuffix')).toBe(true);
	});

	it('ignores invisible stamp when matching marker', () => {
		const stamped = attachBotStamp('خبر #nosuffix');
		expect(shouldSkipAutoSuffix(stamped, '#nosuffix')).toBe(true);
	});
});
