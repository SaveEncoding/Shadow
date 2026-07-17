import { ADMINS } from "../config.js";

/**
 * گزارش خطا به ادمین‌های بات
 * @param {Object} env - Environment variables (شامل BOT_TOKEN)
 * @param {string} context - محل وقوع خطا (مثلاً "handleMessage", "addChannel")
 * @param {Error|Object} error - شیء خطا
 * @param {number|string} userId - آیدی کاربر (اختیاری)
 */
export async function reportErrorToAdmin(env, context, error, userId = null) {
  if (!env.TELEGRAM_TOKEN) {
    console.error("BOT_TOKEN not found for error reporting");
    return;
  }

  const errorMessage = formatErrorMessage(context, error, userId);

  // ارسال پیام به همه ادمین‌ها
  for (const adminId of ADMINS) {
    try {
      await sendErrorToAdmin(env.TELEGRAM_TOKEN, adminId, errorMessage);
    } catch (sendErr) {
      console.error(`Failed to send error report to admin ${adminId}:`, sendErr);
    }
  }
}

/**
 * فرمت کردن پیام خطا به صورت خوانا
 */
function formatErrorMessage(context, error, userId) {
  const now = new Date().toLocaleString("fa-IR");

  let msg = `🚨 <b>خطای جدید در بات Shadow</b>\n\n`;
  msg += `📍 <b>محل:</b> <code>${context}</code>\n`;
  msg += `🕒 <b>زمان:</b> ${now}\n`;

  if (userId) {
    msg += `👤 <b>کاربر:</b> <code>${userId}</code>\n`;
  }

  msg += `\n🔴 <b>خطا:</b>\n`;
  msg += `<code>${error.message || error}</code>\n\n`;

  if (error.stack) {
    const stack = error.stack.split("\n").slice(0, 8).join("\n"); // فقط ۸ خط اول
    msg += `<b>Stack Trace:</b>\n<pre>${stack}</pre>\n`;
  }

  return msg;
}

/**
 * ارسال پیام به یک ادمین
 */
async function sendErrorToAdmin(token, adminId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const payload = {
    chat_id: adminId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram API error (${response.status}):`, errorText);
    }
  } catch (err) {
    console.error("Failed to send error message:", err);
  }
}