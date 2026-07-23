import { reportErrorToAdmin } from "./Error.js";

const DEFAULT_USER_MESSAGE = "⚠️ مشکلی پیش اومد، لطفاً چند لحظه دیگه دوباره تلاش کن.";

/**
 * A higher-order function that wraps a handler and manages its errors.
 *
 * It assumes your handlers have the signature (request, env, ctx).
 * If you use a different signature (e.g., additional arguments),
 * adjust the extractUserId/extractChatId logic and the handler(...) call accordingly.
 *
 * Usage (in files within the handlers folder):
 *
 *   import { withErrorHandling } from "../errorHandler.js";
 *
 *   async function handleAddChannel(request, env, ctx) {
 *     // Core logic
 *   }
 *
 *   export default withErrorHandling(handleAddChannel, "addChannel");
 *
 * And call it in the main router as before:
 *   await handleAddChannel(request, env, ctx);
 */
export function withErrorHandling(handler, context) {
  return async (request, env, ctx) => {
    try {
      return await handler(request, env, ctx);
    } catch (error) {
      console.error(`[${context}] Error:`, error);

      const update = await request.clone().json();
      const userId = extractUserId(update);
      const chatId = extractChatId(update);

// Report to admin – runs in the background without blocking the response to the user/Telegram.
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

      // Friendly response to the user – in the background
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

      // For Cloudflare Workers acting as a Telegram webhook, always return a 200 status code;
      // otherwise, Telegram will keep resending the same update.
      return new Response("OK", { status: 200 });
    }
  };
}

/** Extracting the user ID from various types of Telegram updates. */
function extractUserId(update) {
  return (
    update?.message?.from?.id ??
    update?.callback_query?.from?.id ??
    update?.inline_query?.from?.id ??
    null
  );
}

/** Extracting the chat ID to send a reply to the user. */
function extractChatId(update) {
  return (
    update?.message?.chat?.id ??
    update?.callback_query?.message?.chat?.id ??
    null
  );
}

/** Sending a friendly error message to the user */
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