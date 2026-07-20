import { ADMINS } from "../config.js";

const TELEGRAM_MAX_LENGTH = 4000; // کمی کمتر از سقف واقعی ۴۰۹۶ برای اطمینان
const COOLDOWN_SECONDS = 300; // ۵ دقیقه - فقط اگر env.ERROR_KV تعریف شده باشد فعال می‌شود

/**
 * گزارش خطا به ادمین‌های بات
 * @param {Object} env - Environment variables (شامل TELEGRAM_TOKEN و اختیاری ERROR_KV)
 * @param {string} context - محل وقوع خطا (مثلاً "handleMessage", "addChannel")
 * @param {Error|Object} error - شیء خطا
 * @param {number|string|null} userId - آیدی کاربر (اختیاری)
 */
export async function reportErrorToAdmin(env, context, error, userId = null) {
  if (!env.TELEGRAM_TOKEN) {
    console.error("TELEGRAM_TOKEN not found for error reporting");
    return;
  }

  // اگر KV تعریف شده باشد، برای هر context یک cooldown می‌گذاریم
  // تا در صورت خطای پشت‌سرهم (مثلاً قطعی یک سرویس خارجی)، ادمین‌ها اسپم نشوند
  if (env.ERROR_KV) {
    const onCooldown = await isOnCooldown(env.ERROR_KV, context);
    if (onCooldown) {
      console.warn(`[${context}] error suppressed due to cooldown`);
      return;
    }
    await setCooldown(env.ERROR_KV, context);
  }

  const errorMessage = formatErrorMessage(context, error, userId);

  for (const adminId of ADMINS) {
    try {
      await sendErrorToAdmin(env.TELEGRAM_TOKEN, adminId, errorMessage);
    } catch (sendErr) {
      console.error(`Failed to send error report to admin ${adminId}:`, sendErr);
    }
  }
}

/** بررسی cooldown برای یک context خاص */
async function isOnCooldown(kv, context) {
  try {
    const value = await kv.get(`error_cooldown:${context}`);
    return value !== null;
  } catch (e) {
    console.error("KV read failed:", e);
    return false; // اگر KV مشکل داشت، بهتر است خطا گزارش شود تا اینکه از دست برود
  }
}

/** ثبت cooldown برای یک context خاص */
async function setCooldown(kv, context) {
  try {
    await kv.put(`error_cooldown:${context}`, "1", {
      expirationTtl: COOLDOWN_SECONDS,
    });
  } catch (e) {
    console.error("KV write failed:", e);
  }
}

/**
 * escape کردن کاراکترهای خاص HTML تا parse_mode: "HTML" در تلگرام خطا ندهد
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * فرمت کردن پیام خطا به صورت خوانا
 */
function formatErrorMessage(context, error, userId) {
  const now = new Date().toLocaleString("fa-IR");
  const errText =
    error instanceof Error ? error.message : JSON.stringify(error);

  let msg = `🚨 <b>خطای جدید در بات Shadow</b>\n\n`;
  msg += `📍 <b>محل:</b> <code>${escapeHtml(context)}</code>\n`;
  msg += `🕒 <b>زمان:</b> ${now}\n`;

  if (userId !== null && userId !== undefined) {
    msg += `👤 <b>کاربر:</b> <code>${escapeHtml(userId)}</code>\n`;
  }

  msg += `\n🔴 <b>خطا:</b>\n`;
  msg += `<code>${escapeHtml(errText)}</code>\n\n`;

  if (error?.stack) {
    const stack = error.stack.split("\n").slice(0, 8).join("\n");
    msg += `<b>Stack Trace:</b>\n<pre>${escapeHtml(stack)}</pre>\n`;
  }

  if (msg.length > TELEGRAM_MAX_LENGTH) {
    msg = msg.slice(0, TELEGRAM_MAX_LENGTH) + "\n\n... (truncated)";
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