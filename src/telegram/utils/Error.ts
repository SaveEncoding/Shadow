import { Api } from "grammy";
import { Env } from "../../types.js";
import { getErrorLogTarget } from "../db/settings.js";
import { escapeHtml } from "../services/telegramService.js";

const TELEGRAM_MAX_LENGTH = 4000; // Slightly below the actual limit of 4096, to be safe.
const COOLDOWN_SECONDS = 300; // 5 minutes - only active if env.ERROR_KV is defined

/**
 * Report an error to the configured private log group (bot_settings.error_log_chat_id).
 * Falls back to console only when the log chat is not configured yet.
 *
 * @param {Object} env - Environment (TELEGRAM_TOKEN, my_database, optional ERROR_KV)
 * @param {string} context - Where the error happened
 * @param {Error|Object} error - Error object
 * @param {number|string|null} userId - Telegram user id (optional)
 */
// Compatibility alias: some callers/tests refer to the reporter as
// `reportErrorToAdmin`. Keep both names so neither breaks.
export const reportErrorToAdmin = reportError;

export async function reportError(
  env: Env,
  context: string,
  error: Error | unknown,
  userId: number | string | null = null
): Promise<void> {
  if (!env.TELEGRAM_TOKEN) {
    console.error("TELEGRAM_TOKEN not found for error reporting");
    return;
  }

  // Cooldown per context so a broken dependency does not spam the log group.
  if (env.ERROR_KV) {
    const onCooldown = await isOnCooldown(env.ERROR_KV, context);
    if (onCooldown) {
      console.warn(`[${context}] error suppressed due to cooldown`);
      return;
    }
    await setCooldown(env.ERROR_KV, context);
  }

  const errorMessage = formatErrorMessage(context, error, userId);

  let chatId = null;
  let threadId = null;
  try {
    if (env.my_database) {
      ({ chatId, threadId } = await getErrorLogTarget(env.my_database));
    }
  } catch (dbErr) {
    console.error("Failed to read error_log_chat_id from D1:", dbErr);
  }

  if (chatId === null) {
    console.error(
      `[${context}] error_log_chat_id is not set in bot_settings — error not sent to Telegram:`,
      error
    );
    return;
  }

  try {
    await sendErrorToChat(env.TELEGRAM_TOKEN, chatId, errorMessage, threadId);
  } catch (sendErr) {
    console.error(`Failed to send error report to log chat ${chatId}:`, sendErr);
  }
}

async function isOnCooldown(kv: KVNamespace, context: string): Promise<boolean> {
  try {
    const value = await kv.get(`error_cooldown:${context}`);
    return value !== null;
  } catch (e) {
    console.error("KV read failed:", e);
    return false;
  }
}

async function setCooldown(kv: KVNamespace, context: string): Promise<void> {
  try {
    await kv.put(`error_cooldown:${context}`, "1", {
      expirationTtl: COOLDOWN_SECONDS,
    });
  } catch (e) {
    console.error("KV write failed:", e);
  }
}

function formatTimestamp(date: Date): string {
  // en-GB gives DD/MM/YYYY, HH:mm:ss with plain Latin digits (safe in any
  // terminal), and timeZone: "Asia/Tehran" converts from the Worker's
  // underlying UTC clock to the correct local wall time (UTC+3:30),
  // instead of the previous fa-IR call which silently stayed in UTC.
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Tehran",
    hour12: false,
  });
}

function formatErrorMessage(context: string, error: Error | unknown, userId?: number | string | null): string {
  const now = formatTimestamp(new Date());
  const errText =
    error instanceof Error ? error.message : JSON.stringify(error);

  let msg = `🚨 <b>خطای جدید در بات Shadow</b>\n\n`;
  msg += `📍 <b>محل:</b> <code>${escapeHtml(context)}</code>\n`;
  msg += `🕒 <b>زمان:</b> ${now}\n`;

  if (userId !== null && userId !== undefined) {
    msg += `👤 <b>کاربر:</b> <code>${escapeHtml(userId)}</code>\n`;
  }

  const errObj = error instanceof Error ? error : null;

  if (errObj?.name) {
    msg += `🏷 <b>نوع:</b> <code>${escapeHtml(errObj.name)}</code>\n`;
  }

  msg += `\n🔴 <b>خطا:</b>\n`;
  msg += `<code>${escapeHtml(errText)}</code>\n\n`;

  if (errObj?.stack) {
    const stack = errObj.stack.split("\n").slice(0, 8).join("\n");
    msg += `<b>Stack Trace:</b>\n<pre>${escapeHtml(stack)}</pre>\n`;
  }

  if (msg.length > TELEGRAM_MAX_LENGTH) {
    msg = msg.slice(0, TELEGRAM_MAX_LENGTH) + "\n\n... (truncated)";
  }

  return msg;
}

async function sendErrorToChat(token: string, chatId: string | number, text: string, threadId: number | null = null): Promise<void> {
  const api = new Api(token);

  await api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    message_thread_id: threadId ?? undefined,
    link_preview_options: { is_disabled: true },
  });
}
