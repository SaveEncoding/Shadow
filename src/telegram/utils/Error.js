import { ADMINS } from "../config.js";

const TELEGRAM_MAX_LENGTH = 4000; // Slightly below the actual limit of 4096, to be safe.
const COOLDOWN_SECONDS = 300; // 5 minutes - only active if env.ERROR_KV is defined

/**
 * Report error to bot admins
 * @param {Object} env - Environment variables (including TELEGRAM_TOKEN and optional ERROR_KV)
 * @param {string} context - Location of the error
 * @param {Error|Object} error - Error object
 * @param {number|string|null} userId - User ID (optional)
 */
export async function reportErrorToAdmin(env, context, error, userId = null) {
  if (!env.TELEGRAM_TOKEN) {
    console.error("TELEGRAM_TOKEN not found for error reporting");
    return;
  }

  // If KV is defined, we set a cooldown for each context.
  // ...so that admins are not spammed in the event of consecutive errors (e.g., an external service outage).
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

/** Checking the cooldown for a specific context */
async function isOnCooldown(kv, context) {
  try {
    const value = await kv.get(`error_cooldown:${context}`);
    return value !== null;
  } catch (e) {
    console.error("KV read failed:", e);
    return false; // If there is an issue with the KV, it is better to report the error than to let it go unnoticed.
  }
}

/** Registering a cooldown for a specific context */
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
 * Escape special HTML characters to prevent errors in Telegram when using `parse_mode: "HTML"`.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format the error message in a readable way
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
 * Send a message to an admin
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