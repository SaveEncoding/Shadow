import { Api } from "grammy";

/**
 * Both helpers below go through grammy's Api client instead of a hand-rolled
 * fetch, so every outbound Telegram call in the project shares the same
 * request/error handling, retry, and typing behavior grammy provides.
 */

/**
 * Escapes the characters Telegram's HTML parse_mode treats as markup
 * (&, <, >) so arbitrary/dynamic text can never be misread as (broken)
 * HTML and blow up with "can't parse entities" (this is exactly what
 * happened when a literal "<" ended up in the cleanup cron's summary text).
 *
 * sendMessage/editMessage apply this to their `text` argument automatically.
 * Because of that, do NOT hand-write formatting tags (<b>, <code>, ...) in
 * text passed to these two helpers — they'll be escaped and shown as literal
 * text, not rendered. These two are meant for plain-text reports/notices
 * (cron summaries, status edits). If a handler genuinely needs rich HTML
 * formatting, use ctx.reply()/ctx.editMessageText() directly the way the
 * feature/command handlers already do, and escape only the dynamic pieces
 * you interpolate (with this same escapeHtml) while keeping your own tags.
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendMessage(
  env,
  chatId,
  text,
  replyMarkup = null
) {
  if (!env.TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN is not set");
  }

  if (!chatId) {
    throw new Error("chatId is required");
  }

  const api = new Api(env.TELEGRAM_TOKEN);

  return api.sendMessage(chatId, escapeHtml(text), {
    parse_mode: "HTML",
    reply_markup: replyMarkup ?? undefined,
  });
}

/**
 * Edits the text of a message the bot already sent (e.g. flipping a
 * "در حال پردازش..." status message to its final result). Mirrors
 * sendMessage's shape and, like it, HTML-escapes `text` automatically.
 */
export async function editMessage(
  env,
  chatId,
  messageId,
  text,
  replyMarkup = null
) {
  if (!env.TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN is not set");
  }

  if (!chatId) {
    throw new Error("chatId is required");
  }

  if (!messageId) {
    throw new Error("messageId is required");
  }

  const api = new Api(env.TELEGRAM_TOKEN);

  return api.editMessageText(chatId, messageId, escapeHtml(text), {
    parse_mode: "HTML",
    reply_markup: replyMarkup ?? undefined,
  });
}

export async function answerCallbackQuery(
  env,
  callbackQueryId,
  text = "",
  showAlert = false
) {
  if (!env.TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN is not set");
  }

  const api = new Api(env.TELEGRAM_TOKEN);

  return api.answerCallbackQuery(callbackQueryId, {
    text,
    show_alert: showAlert,
  });
}
