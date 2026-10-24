/**
 * تبدیل تاریخ میلادی ↔ شمسی.
 *
 * چرا خودمان؟ چون `Intl` در محیط Workers برای منطقه‌ی زمانی و تقویم غیرمیلادی
 * قابل اتکا نیست (ICU کوچک است)، و تاریخ انتشار پست باید روی سرور و در تست
 * دقیقاً یکسان باشد. این پیاده‌سازی بر پایه‌ی الگوریتم استاندارد jalaali است.
 *
 * ورودی/خروجی: ماه ۱..۱۲، روز ۱..۳۱.
 */

function div(a: number, b: number): number {
	return ~~(a / b);
}

function mod(a: number, b: number): number {
	return a - ~~(a / b) * b;
}

/** شماره‌ی روز جولیَن از تاریخ میلادی */
function gregorianToJdn(gy: number, gm: number, gd: number): number {
	let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
	d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
	return d;
}

/** تاریخ میلادی از شماره‌ی روز جولیَن */
function jdnToGregorian(jdn: number): { gy: number; gm: number; gd: number } {
	let j = 4 * jdn + 139361631;
	j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
	const i = div(mod(j, 1461), 4) * 5 + 308;
	const gd = div(mod(i, 153), 5) + 1;
	const gm = mod(div(i, 153), 12) + 1;
	const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
	return { gy, gm, gd };
}

interface JalCal {
	leap: number;
	gy: number;
	march: number;
}

/** محاسبه‌ی سال کبیسه و روز شروع سال شمسی */
function jalCal(jy: number): JalCal {
	const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
	const gy = jy + 621;
	let leapJ = -14;
	let jp = breaks[0];
	let jm = 0;
	let jump = 0;

	for (let i = 1; i < breaks.length; i++) {
		jm = breaks[i];
		jump = jm - jp;
		if (jy < jm) break;
		leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
		jp = jm;
	}

	let n = jy - jp;
	leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
	if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

	const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
	const march = 20 + leapJ - leapG;

	if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
	let leap = mod(mod(n + 1, 33) - 1, 4);
	if (leap === -1) leap = 4;

	return { leap, gy, march };
}

/** روز جولیَن از تاریخ شمسی */
function jalaaliToJdn(jy: number, jm: number, jd: number): number {
	const r = jalCal(jy);
	return gregorianToJdn(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export interface JalaaliDate {
	jy: number;
	jm: number;
	jd: number;
}

export function toJalaali(gy: number, gm: number, gd: number): JalaaliDate {
	const jdn = gregorianToJdn(gy, gm, gd);
	let year = jdnToGregorian(jdn).gy - 621;
	const r = jalCal(year);
	const jdn1f = gregorianToJdn(r.gy, 3, r.march);

	let k = jdn - jdn1f;
	if (k >= 0) {
		if (k <= 185) {
			return { jy: year, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
		}
		k -= 186;
	} else {
		year -= 1;
		k += 179;
		if (r.leap === 1) k += 1;
	}

	return { jy: year, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
	return jdnToGregorian(jalaaliToJdn(jy, jm, jd));
}

export const JALAALI_MONTHS = [
	'فروردین',
	'اردیبهشت',
	'خرداد',
	'تیر',
	'مرداد',
	'شهریور',
	'مهر',
	'آبان',
	'آذر',
	'دی',
	'بهمن',
	'اسفند',
];

export const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

/** نام روز هفته از یک timestamp (بر پایه‌ی UNIX epoch که یک پنجشنبه بوده) */
export function weekdayIndex(unixSeconds: number): number {
	const days = Math.floor(unixSeconds / 86_400) + 4; // 1970-01-01 = پنجشنبه (index 4)
	return ((days % 7) + 7) % 7;
}
