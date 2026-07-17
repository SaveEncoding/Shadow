const API = token =>
  `https://api.telegram.org/bot${token}`;

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

  const response = await fetch(
    `${API(env.TELEGRAM_TOKEN)}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: replyMarkup
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Telegram API Error: ${error.description}`);
  }

  return response.json();

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

  const response = await fetch(
    `${API(env.TELEGRAM_TOKEN)}/answerCallbackQuery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Telegram API Error: ${error.description}`);
  }

  return response.json();
}
