/**
 * خواندن اطلاعات یک خطا از نوع `unknown` — بدون cast.
 *
 * چرا لازم است؟ در `strict`، متغیر `catch` از نوع `unknown` است. همه‌جای کدبیس
 * قبلاً `err?.description || err?.message || ...` می‌نوشت که روی `unknown`
 * کار نمی‌کند و در ضمن چهار بار تکرار شده بود (تلگرام هم برای خطاهای API خودش
 * فیلدهای `description` و `error_code` می‌گذارد).
 *
 * روش: با `in` نگاه می‌کنیم و مقدار را نوع‌بررسی می‌کنیم؛ بنابراین هیچ ادعای
 * نوعی روی شکل واقعی خطا نمی‌کنیم.
 */

export interface ErrorInfo {
	/** توضیح خوانا (خطاهای Telegram API) */
	description?: string;
	/** پیام خطا (Error معمولی) */
	message?: string;
	name?: string;
	/** کد خطای Telegram API */
	errorCode?: number;
	stack?: string;
}

function field(error: object, key: string): unknown {
	return key in error ? (error as Record<string, unknown>)[key] : undefined;
}

/** اطلاعات خطا را به شکل فیلدهای اختیاری و بررسی‌شده برمی‌گرداند. */
export function errorInfo(error: unknown): ErrorInfo {
	if (typeof error !== 'object' || error === null) {
		return {};
	}

	const info: ErrorInfo = {};
	const description = field(error, 'description');
	if (typeof description === 'string') info.description = description;
	const message = field(error, 'message');
	if (typeof message === 'string') info.message = message;
	const name = field(error, 'name');
	if (typeof name === 'string') info.name = name;
	const errorCode = field(error, 'error_code');
	if (typeof errorCode === 'number') info.errorCode = errorCode;
	const stack = field(error, 'stack');
	if (typeof stack === 'string') info.stack = stack;
	return info;
}

/** توضیح انسانی خطا: اول توضیح تلگرام، بعد پیام Error، بعد رشته‌سازی. */
export function errorText(error: unknown, fallback = 'خطای نامشخص'): string {
	const info = errorInfo(error);
	if (info.description) return info.description;
	if (info.message) return info.message;
	if (info.name) return info.name;
	const asText = String(error ?? '');
	return asText && asText !== 'undefined' ? asText : fallback;
}
