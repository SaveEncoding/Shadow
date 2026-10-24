import { describe, it, expect } from 'vitest';
import {
	ALBUM_GRACE_SECONDS,
	DEFAULT_DELAY_MINUTES,
	DELAY_PRESETS,
	MAX_DELAY_MINUTES,
	MAX_PUBLISH_ATTEMPTS,
	MIN_DELAY_MINUTES,
	SECONDS_PER_DAY,
	TEHRAN_OFFSET_SECONDS,
	clampDelayMinutes,
	computePublishAt,
	formatClockTehran,
	formatDelay,
	formatJalaaliDate,
	formatRemaining,
	formatTehran,
	isDue,
	nextOccurrenceOfClock,
	normalizeDigits,
	parseClockInput,
	previewSnippet,
	retryDelaySeconds,
	toPersianDigits,
} from '../src/core/schedule/timing.js';

// 2026-10-24T12:00:00Z = 1405/08/02 (۲ آبان ۱۴۰۵)، ساعت ۱۵:۳۰ تهران، شنبه
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0) / 1000;

describe('jalali formatting', () => {
	it('renders the Tehran date and clock for a known instant', () => {
		const text = formatTehran(NOW);
		expect(text).toContain('۲ آبان');
		expect(text).toContain('۱۵:۳۰');
		expect(text).toContain('شنبه');
	});

	it('renders a short jalaali date', () => {
		expect(formatJalaaliDate(NOW)).toBe('۱۴۰۵/۰۸/۰۲');
	});

	it('formats the clock in Tehran time (fixed +03:30 offset)', () => {
		expect(formatClockTehran(NOW)).toBe('۱۵:۳۰');
		// نیمه‌شب تهران = 20:30 UTC روز قبل
		expect(formatClockTehran(Date.UTC(2026, 9, 24, 20, 30, 0) / 1000)).toBe('۰۰:۰۰');
		expect(TEHRAN_OFFSET_SECONDS).toBe(12_600);
	});

	it('converts digits to Persian', () => {
		expect(toPersianDigits(1405)).toBe('۱۴۰۵');
		expect(toPersianDigits('09:05')).toBe('۰۹:۰۵');
		expect(normalizeDigits('۱۴:۳۰')).toBe('14:30');
	});
});

describe('delay handling', () => {
	it('clamps delays into the supported range', () => {
		expect(clampDelayMinutes(0)).toBe(MIN_DELAY_MINUTES);
		expect(clampDelayMinutes(-5)).toBe(MIN_DELAY_MINUTES);
		expect(clampDelayMinutes(999_999)).toBe(MAX_DELAY_MINUTES);
		expect(clampDelayMinutes(Number.NaN)).toBe(DEFAULT_DELAY_MINUTES);
		expect(clampDelayMinutes(29.4)).toBe(29);
	});

	it('computes the publish time from now + delay', () => {
		expect(computePublishAt(NOW, 30)).toBe(NOW + 1800);
		// حتی ورودی صفر هم حداقل یک دقیقه است؛ پست هرگز در همان لحظه منتشر نمی‌شود
		expect(computePublishAt(NOW, 0)).toBe(NOW + 60);
	});

	it('describes delays in Persian', () => {
		expect(formatDelay(30)).toBe('۳۰ دقیقه');
		expect(formatDelay(60)).toBe('۱ ساعت');
		expect(formatDelay(720)).toBe('۱۲ ساعت');
		expect(formatDelay(1440)).toBe('۱ روز');
		expect(formatDelay(90)).toBe('۱ ساعت و ۳۰ دقیقه');
	});

	it('describes how long is left', () => {
		expect(formatRemaining(NOW + 1800, NOW)).toBe('۳۰ دقیقه دیگر');
		expect(formatRemaining(NOW - 120, NOW)).toBe('۲ دقیقه پیش');
		expect(formatRemaining(NOW + 10, NOW)).toBe('الان');
	});

	it('offers presets that all fall inside the allowed range', () => {
		expect(DELAY_PRESETS.length).toBeGreaterThanOrEqual(4);
		for (const preset of DELAY_PRESETS) {
			expect(preset.minutes).toBeGreaterThanOrEqual(MIN_DELAY_MINUTES);
			expect(preset.minutes).toBeLessThanOrEqual(MAX_DELAY_MINUTES);
		}
	});
});

describe('clock input', () => {
	it('parses latin and persian clock strings', () => {
		expect(parseClockInput('14:30')).toBe(870);
		expect(parseClockInput('۹:۵')).toBe(545);
		expect(parseClockInput(' 9 05 ')).toBe(545);
		expect(parseClockInput('9.5')).toBe(545);
	});

	it('rejects nonsense', () => {
		expect(parseClockInput('25:00')).toBeNull();
		expect(parseClockInput('12:75')).toBeNull();
		expect(parseClockInput('hello')).toBeNull();
		expect(parseClockInput('')).toBeNull();
	});

	it('finds the next occurrence of a Tehran clock time', () => {
		// الان ۱۵:۳۰ تهران است
		const laterToday = nextOccurrenceOfClock(NOW, 18 * 60);
		expect(formatClockTehran(laterToday)).toBe('۱۸:۰۰');
		expect(laterToday).toBeGreaterThan(NOW);
		expect(laterToday - NOW).toBeLessThan(SECONDS_PER_DAY);

		// ساعتی که امروز گذشته → فردا
		const tomorrow = nextOccurrenceOfClock(NOW, 9 * 60);
		expect(formatClockTehran(tomorrow)).toBe('۰۹:۰۰');
		expect(tomorrow - NOW).toBeGreaterThan(SECONDS_PER_DAY - 12 * 3600);
		expect(tomorrow - NOW).toBeLessThan(SECONDS_PER_DAY + 24 * 3600);
	});
});

describe('due checks', () => {
	it('a scheduled post is due when its publish time has passed', () => {
		expect(isDue({ status: 'scheduled', publishAt: NOW - 1, finalizeAt: null }, NOW)).toBe(true);
		expect(isDue({ status: 'scheduled', publishAt: NOW + 1, finalizeAt: null }, NOW)).toBe(false);
	});

	it('a collecting album is due only after its finalize deadline', () => {
		expect(isDue({ status: 'collecting', publishAt: 0, finalizeAt: NOW + ALBUM_GRACE_SECONDS }, NOW)).toBe(false);
		expect(isDue({ status: 'collecting', publishAt: 0, finalizeAt: NOW }, NOW)).toBe(true);
		expect(isDue({ status: 'collecting', publishAt: 0, finalizeAt: null }, NOW)).toBe(false);
	});

	it('other statuses are never due (no double publishing)', () => {
		for (const status of ['publishing', 'published', 'failed', 'canceled']) {
			expect(isDue({ status, publishAt: 0, finalizeAt: 0 }, NOW)).toBe(false);
		}
	});
});

describe('retry backoff', () => {
	it('grows but stays bounded', () => {
		expect(retryDelaySeconds(1)).toBe(180);
		expect(retryDelaySeconds(2)).toBe(540);
		expect(retryDelaySeconds(3)).toBe(1620);
		expect(retryDelaySeconds(10)).toBe(3600);
		expect(MAX_PUBLISH_ATTEMPTS).toBe(3);
	});
});

describe('previewSnippet', () => {
	it('collapses whitespace and truncates by characters', () => {
		expect(previewSnippet('  سلام\n\nدنیا  ')).toBe('سلام دنیا');
		expect(previewSnippet(null)).toBe('');
		const long = 'ا'.repeat(80);
		expect([...previewSnippet(long, 10)]).toHaveLength(11); // ۱۰ کاراکتر + …
		expect(previewSnippet(long, 10).endsWith('…')).toBe(true);
	});
});
