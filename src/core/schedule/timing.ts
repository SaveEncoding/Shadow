/**
 * منطق خالص زمان‌بندی انتشار — بدون D1، بدون تلگرام، بدون Date.now().
 *
 * «الان» همیشه به‌عنوان آرگومان می‌آید تا همه‌چیز قطعی و تست‌پذیر باشد.
 * همه‌ی زمان‌ها **ثانیه‌ی یونیکس** هستند (همان واحدی که تلگرام استفاده می‌کند).
 */

import { JALAALI_MONTHS, WEEKDAYS, toJalaali, weekdayIndex } from './jalali.js';

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;

/** تهران از ۲۰۲۲ ساعت تابستانی ندارد؛ اختلاف ثابت +۰۳:۳۰ */
export const TEHRAN_OFFSET_SECONDS = 3.5 * SECONDS_PER_HOUR;

export const MIN_DELAY_MINUTES = 1;
export const MAX_DELAY_MINUTES = 10_080; // یک هفته

/** گزینه‌های آماده در UI */
export const DELAY_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
	{ minutes: 5, label: '۵ دقیقه' },
	{ minutes: 15, label: '۱۵ دقیقه' },
	{ minutes: 30, label: '۳۰ دقیقه' },
	{ minutes: 60, label: '۱ ساعت' },
	{ minutes: 180, label: '۳ ساعت' },
	{ minutes: 720, label: '۱۲ ساعت' },
	{ minutes: 1440, label: '۲۴ ساعت' },
];

export const DEFAULT_DELAY_MINUTES = 30;

/** چقدر صبر می‌کنیم تا همه‌ی آیتم‌های یک آلبوم برسند (تلگرام هر آیتم را جدا می‌فرستد) */
export const ALBUM_GRACE_SECONDS = 20;

/** حداکثر تعداد پستی که در هر اجرای کرون منتشر می‌شود (سقف نرخ تلگرام) */
export const MAX_PUBLISH_PER_TICK = 10;

/** اگر این مدت از شروع انتشار بگذرد و نتیجه ثبت نشود، پست «گیرکرده» تلقی می‌شود */
export const STUCK_PUBLISH_SECONDS = 10 * SECONDS_PER_MINUTE;

export const MAX_PUBLISH_ATTEMPTS = 3;

export function clampDelayMinutes(minutes: number): number {
	if (!Number.isFinite(minutes)) return DEFAULT_DELAY_MINUTES;
	const rounded = Math.round(minutes);
	if (rounded < MIN_DELAY_MINUTES) return MIN_DELAY_MINUTES;
	if (rounded > MAX_DELAY_MINUTES) return MAX_DELAY_MINUTES;
	return rounded;
}

/** زمان انتشار = الان + تأخیر */
export function computePublishAt(nowSeconds: number, delayMinutes: number): number {
	return nowSeconds + clampDelayMinutes(delayMinutes) * SECONDS_PER_MINUTE;
}

/** «۳۰ دقیقه»، «۲ ساعت»، «۱ روز» */
export function formatDelay(minutes: number): string {
	const value = clampDelayMinutes(minutes);
	if (value < 60) return `${toPersianDigits(value)} دقیقه`;
	if (value % 1440 === 0) return `${toPersianDigits(value / 1440)} روز`;
	if (value % 60 === 0) return `${toPersianDigits(value / 60)} ساعت`;
	const hours = Math.floor(value / 60);
	const rest = value % 60;
	return `${toPersianDigits(hours)} ساعت و ${toPersianDigits(rest)} دقیقه`;
}

/** «۳ دقیقه پیش» / «۴۵ دقیقه دیگر» / «الان» */
export function formatRemaining(publishAtSeconds: number, nowSeconds: number): string {
	const delta = Math.round((publishAtSeconds - nowSeconds) / SECONDS_PER_MINUTE);
	if (Math.abs(delta) < 1) return 'الان';
	if (delta < 0) return `${formatDelay(Math.abs(delta))} پیش`;
	return `${formatDelay(delta)} دیگر`;
}

export function toPersianDigits(value: number | string): string {
	const digits = '۰۱۲۳۴۵۶۷۸۹';
	return String(value).replace(/\d/g, (d) => digits[Number(d)]);
}

/** «پنجشنبه ۲ آبان، ساعت ۱۴:۳۰» به وقت تهران */
export function formatTehran(unixSeconds: number): string {
	const shifted = unixSeconds + TEHRAN_OFFSET_SECONDS;
	const dayStart = Math.floor(shifted / SECONDS_PER_DAY) * SECONDS_PER_DAY;
	const secondsOfDay = shifted - dayStart;

	const hours = Math.floor(secondsOfDay / 3600);
	const minutes = Math.floor((secondsOfDay % 3600) / 60);

	const utc = new Date(dayStart * 1000);
	const j = toJalaali(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
	const weekday = WEEKDAYS[weekdayIndex(dayStart)];

	return `${weekday} ${toPersianDigits(j.jd)} ${JALAALI_MONTHS[j.jm - 1]}، ساعت ${toPersianDigits(
		`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
	)}`;
}

/** تاریخ کوتاه شمسی: «۱۴۰۵/۰۸/۰۲» */
export function formatJalaaliDate(unixSeconds: number): string {
	const utc = new Date((unixSeconds + TEHRAN_OFFSET_SECONDS) * 1000);
	const j = toJalaali(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
	return toPersianDigits(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
}

/** تبدیل ثانیه به HH:MM (به وقت تهران) */
export function formatClockTehran(unixSeconds: number): string {
	const shifted = unixSeconds + TEHRAN_OFFSET_SECONDS;
	const secondsOfDay = ((shifted % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
	const hours = Math.floor(secondsOfDay / 3600);
	const minutes = Math.floor((secondsOfDay % 3600) / 60);
	return toPersianDigits(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
}

/**
 * تفسیر ساعت واردشده توسط ادمین، مثل «14:30» یا «۹:۵».
 * خروجی: تعداد دقیقه از نیمه‌شب به وقت تهران، یا null اگر نامعتبر بود.
 */
export function parseClockInput(raw: string): number | null {
	const normalized = normalizeDigits(String(raw ?? '').trim()).replace(/[٫،]/g, ':');
	const match = normalized.match(/^(\d{1,2})\s*[:.\s]\s*(\d{1,2})$/);
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
	return hours * 60 + minutes;
}

/** تبدیل ارقام فارسی/عربی به لاتین */
export function normalizeDigits(value: string): string {
	return value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * نزدیک‌ترین زمان آینده با این ساعت (به وقت تهران) — برای «فردا ساعت ۹ صبح».
 * اگر امروز آن ساعت گذشته باشد، فردا برگردانده می‌شود.
 */
export function nextOccurrenceOfClock(nowSeconds: number, minutesOfDayTehran: number): number {
	const shifted = nowSeconds + TEHRAN_OFFSET_SECONDS;
	const dayStart = Math.floor(shifted / SECONDS_PER_DAY) * SECONDS_PER_DAY;
	const target = dayStart + minutesOfDayTehran * 60;
	const candidate = target - TEHRAN_OFFSET_SECONDS;
	if (candidate > nowSeconds + 60) return candidate;
	return candidate + SECONDS_PER_DAY;
}

/**
 * آیا این ردیف وقت انتشارش رسیده است؟ (حالت آلبوم که باید نهایی شود هم همین‌جا پوشش داده می‌شود)
 */
export function isDue(
	row: { status: string; publishAt: number; finalizeAt: number | null },
	nowSeconds: number,
): boolean {
	if (row.status === 'collecting') {
		return row.finalizeAt !== null && row.finalizeAt <= nowSeconds;
	}
	if (row.status === 'scheduled') {
		return row.publishAt <= nowSeconds;
	}
	return false;
}

/** تأخیر پلکانی برای تلاش مجدد: ۱، ۳، ۹ دقیقه */
export function retryDelaySeconds(attempts: number): number {
	return Math.min(3 ** Math.max(1, attempts), 60) * SECONDS_PER_MINUTE;
}

/** خلاصه‌ی یک خطی از محتوای پست، برای پیش‌نمایش در لیست */
export function previewSnippet(text: string | null | undefined, max = 60): string {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!clean) return '';
	const chars = [...clean];
	if (chars.length <= max) return clean;
	return chars.slice(0, max).join('') + '…';
}
