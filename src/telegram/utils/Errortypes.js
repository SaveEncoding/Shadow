/**
 * خطایی که باید به کاربر نمایش داده شود (مثل ورودی نامعتبر)
 * و نیازی نیست به ادمین گزارش شود.
 *
 * مثال استفاده:
 *   throw new UserFacingError("Invalid link format", "❌ لینک وارد شده معتبر نیست.");
 */
export class UserFacingError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.name = "UserFacingError";
    this.userMessage = userMessage;
    this.reportToAdmin = false;
  }
}

/**
 * خطای بحرانی که حتماً باید به ادمین گزارش شود
 * (مثل قطعی دیتابیس یا خطای غیرمنتظره در سرویس خارجی).
 *
 * این کلاس اختیاری است - خطاهای معمولی (Error عادی یا throw شده توسط کتابخانه‌ها)
 * هم به‌صورت پیش‌فرض گزارش می‌شوند مگر اینکه reportToAdmin روی false ست شده باشد.
 */
export class CriticalError extends Error {
  constructor(message) {
    super(message);
    this.name = "CriticalError";
    this.reportToAdmin = true;
  }
}