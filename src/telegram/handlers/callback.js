import { getChannels } from "../db/channels";
import { sendMessage, answerCallbackQuery } from "../services/telegramService";
import { reportErrorToAdmin } from "../utils/error";

export async function handleCallback(callbackQuery, env) {
  const data = callbackQuery.data;
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id || callbackQuery.from?.id;
  const userId = callbackQuery.from?.id;

  try {
    if (callbackId) {
      await answerCallbackQuery(
        env,
        callbackId,
        "در حال پردازش...",
        false
      );
    }

    switch (data) {
      case "add_channel":
        // Show a visible alert to the user and also try to send a message.
        try {
          if (callbackId) {
            await answerCallbackQuery(
              env,
              callbackId,
              "یک پیام از کانال خود فوروارد کنید.",
              true
            );
          }

          const targetChat = chatId || userId;
          if (!targetChat) return;

          return sendMessage(
            env,
            targetChat,
            "یک پیام از کانال خود فوروارد کنید."
          );
        } catch (err) {
          console.error('[handleCallback][add_channel] Error sending prompt:', err);
          // fallthrough to allow outer catch to report
          throw err;
        }

      case "my_channels": {
        if (!chatId || !userId) return;
        const channels = await getChannels(env.my_database, userId);
        if (!channels.length) {
          return sendMessage(
            env,
            chatId,
            "هیچ کانالی ثبت نشده است."
          );
        }

        let text = "📋 کانال‌های شما:\n\n";
        for (const channel of channels) {
          text += `• ${channel.title}\n`;
          if (channel.username) {
            text += `@${channel.username}\n`;
          }
          text += "\n";
        }

        return sendMessage(env, chatId, text);
      }

      case "settings":
        if (!chatId) return;
        return sendMessage(
          env,
          chatId,
          "⚙ تنظیمات فعلاً در دسترس نیست."
        );

      default:
        if (!chatId) return;
        return sendMessage(
          env,
          chatId,
          "عملیات نامشخص است. لطفاً دوباره امتحان کنید."
        );
    }
  } catch (err) {
    console.error("[handleCallback] Error:", err, { data, chatId, userId, callbackId });
    // Notify admins
    await reportErrorToAdmin(
      env,
      "handleCallback",
      err,
      userId
    );

    // Give visible feedback to the user who clicked the button
    try {
      if (callbackId) {
        await answerCallbackQuery(
          env,
          callbackId,
          "خطا در پردازش درخواست. لطفاً دوباره تلاش کنید.",
          true
        );
      }
    } catch (notifyErr) {
      console.error('[handleCallback] Failed to notify user via answerCallbackQuery:', notifyErr);
    }
  }
}
