/**
 * اجرای محدود‌شده‌ی هم‌زمان (bounded concurrency) برای کارهای شبکه‌ای.
 *
 * چرا لازم است: پولر منابع، هر منبع را با یک درخواست شبکه می‌خواند. اجرای سری
 * یعنی مجموع تأخیرها؛ اجرای بی‌سقف یعنی برخورد با سقف پلتفرم. این تابع حد وسط
 * است: حداکثر `limit` کار هم‌زمان.
 *
 * سقف‌های فعلی Cloudflare Workers (مستندات، ۲۹ اکتبر ۲۰۲۶):
 *   - اتصال‌های بازِ هم‌زمان در هر invocation: **۶** (اتصال‌هایی که منتظر هدر پاسخ‌اند)
 *   - subrequest در هر invocation: ۵۰ (Free) / ۱۰٬۰۰۰ (Paid)
 *   - CPU هر کرون با بازه‌ی کمتر از یک ساعت: ۳۰ ثانیه
 * پس `limit = 3` با حاشیه‌ی امن زیر سقف ۶ اتصال می‌ماند.
 *
 * قراردادها:
 *   - ترتیب خروجی دقیقاً ترتیب ورودی است (قطعی و قابل تست).
 *   - اگر یکی از کارها خطا بدهد، بقیه ادامه می‌دهند و در پایان اولین خطا پرتاب
 *     می‌شود؛ یعنی «یک منبع خراب بقیه را متوقف نمی‌کند».
 */

export const DEFAULT_NETWORK_CONCURRENCY = 3;

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	if (items.length === 0) return [];

	const width = Math.max(1, Math.min(Math.floor(limit), items.length));
	const results = new Array<R>(items.length);
	let next = 0;

	const worker = async (): Promise<void> => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await fn(items[index]!, index);
		}
	};

	// همه‌ی کارگرها تا آخر می‌روند؛ خطای یکی بقیه را نمی‌کشد و نتیجه در پایان گزارش می‌شود.
	const settled = await Promise.allSettled(Array.from({ length: width }, () => worker()));
	const failed = settled.find((item) => item.status === 'rejected');
	if (failed && failed.status === 'rejected') throw failed.reason;

	return results;
}
