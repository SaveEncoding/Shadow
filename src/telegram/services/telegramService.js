import { Api } from "grammy";

/**
 * Both helpers below go through grammy's Api client instead of a hand-rolled
 * fetch, so every outbound Telegram call in the project shares the same
 * request/error handling, retry, and typing behavior grammy provides.
 */

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

  return api.sendMessage(chatId, text, {
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
