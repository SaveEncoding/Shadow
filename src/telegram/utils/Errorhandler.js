import { reportErrorToAdmin } from "./error.js";

const DEFAULT_USER_MESSAGE = "⚠️ مشکلی پیش اومد، لطفاً چند لحظه دیگه دوباره تلاش کن.";

/**
 * Higher-order function که یک handler را می‌پیچد و خطاهای آن را مدیریت می‌کند.
 *
 * فرض بر این است که امضای handlerهای شما به شکل (update, env, ctx) است.
 * اگر امضای متفاوتی دارید (مثلاً آرگومان‌های بیشتر)، بخش extractUserId/extractChatId
 * و صدا زدن handler(...) را متناسب تغییر دهید.
 *
 * استفاده (در فایل‌های داخل پوشه handlers):
 *
 *   import { withErrorHandling } from "../errorHandler.js";
 *
 *   async function handleAddChannel(update, env, ctx) {
 *     // منطق اصلی
 *   }
 *
 *   export default withErrorHandling(handleAddChannel, "addChannel");
 *
 * و در روتر اصلی مثل قبل صدا می‌زنید:
 *   await handleAddChannel(update, env, ctx);
 */
export function withErrorHandling(handler, context) {
  return async (update, env, ctx) => {
    try {
      return await handler(update, env, ctx);
    } catch (error) {
      console.error(`[${context}] Error:`, error);

      const userId = extractUserId(update);
      const chatId = extractChatId(update);

      // گزارش به ادمین - در background تا پاسخ به کاربر/تلگرام معطل نشود
      if (error?.reportToAdmin !== false) {
        const reportPromise = reportErrorToAdmin(env, context, error, userId).catch(
          (reportErr) => console.error("Failed to report error to admin:", reportErr)
        );
        if (ctx?.waitUntil) {
          ctx.waitUntil(reportPromise);
        } else {
          await reportPromise;
        }
      }

      // پاسخ دوستانه به کاربر - در background
      if (chatId && env.TELEGRAM_TOKEN) {
        const userMsg = error?.userMessage || DEFAULT_USER_MESSAGE;
        const sendPromise = sendMessageToUser(env.TELEGRAM_TOKEN, chatId, userMsg).catch(
          (sendErr) => console.error("Failed to notify user of error:", sendErr)
        );
        if (ctx?.waitUntil) {
          ctx.waitUntil(sendPromise);
        } else {
          await sendPromise;
        }
      }

      // برای Cloudflare Workers که وبهوک تلگرام است، همیشه ۲۰۰ برگردانید
      // وگرنه تلگرام همان update را دوباره و دوباره ارسال می‌کند
      return new Response("OK", { status: 200 });
    }
  };
}

/** استخراج آیدی کاربر از انواع مختلف update تلگرام */
function extractUserId(update) {
  return (
    update?.message?.from?.id ??
    update?.callback_query?.from?.id ??
    update?.inline_query?.from?.id ??
    null
  );
}

/** استخراج chat id برای ارسال پاسخ به کاربر */
function extractChatId(update) {
  return (
    update?.message?.chat?.id ??
    update?.callback_query?.message?.chat?.id ??
    null
  );
}

/** ارسال پیام خطای دوستانه به کاربر */
async function sendMessageToUser(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Telegram API error (${response.status}):`, errorText);
  }
}