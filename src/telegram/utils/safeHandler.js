import { reportErrorToAdmin } from "./errorHandler.js";

/**
 * wrapper امن برای اجرای handlerها
 * @param {Function} handler - تابع handler اصلی
 * @param {string} context - نام handler (برای گزارش)
 * @param {Object} env - environment variables
 * @param {...any} args - آرگومان‌هایی که به handler پاس داده می‌شود
 */
export async function safeExecute(handler, context, env, ...args) {
  try {
    return await handler(...args);
  } catch (error) {
    const userId = extractUserId(args); // استخراج آیدی کاربر
    await reportErrorToAdmin(env, context, error, userId);

    // لاگ محلی
    console.error(`[${context}] Error:`, error);

    // اختیاری: بازگشت پاسخ پیش‌فرض به کاربر
    return createErrorResponse(args);
  }
}

/** استخراج آیدی کاربر از ورودی‌های مختلف */
function extractUserId(args) {
  try {
    const update = args[0];
    return update?.message?.from?.id ||
           update?.callback_query?.from?.id ||
           update?.inline_query?.from?.id ||
           null;
  } catch {
    return null;
  }
}

/** پاسخ خطای دوستانه به کاربر */
function createErrorResponse(args) {
  try {
    const update = args[0];
    const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
    
    if (chatId && args[1]?.TELEGRAM_TOKEN) { // env در args[1] فرض شده
      // ارسال پیام خطا به کاربر (اختیاری)
    }
  } catch (e) {}
}