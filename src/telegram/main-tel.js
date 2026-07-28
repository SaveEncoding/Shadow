import { createBot } from "./bot.js";
import { webhookCallback } from "grammy";
import { reportErrorToAdmin } from "./utils/Error.js";
import { startCommand } from "./commands/start.js";
import { echo } from "./services/echoFun.js";

// It is created only once per isolate and reused across requests,
// instead of each webhook creating a new Bot from scratch and re-registering the handlers.
let handlerPromise = null;

function getHandler(env) {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      const bot = createBot(env);
      await echo(bot);
      // await startCommand(env);
      return webhookCallback(bot, "cloudflare-mod", {
        // secretToken: "your-strong-secret-token"   // امنیت بیشتر (توصیه می‌شود)
      });
    })();
  }
  return handlerPromise;
}

export async function handleTelegramUpdate(request, env) {
  // Important: Cloning the request must be done before the body is read by the handler.
  // If called after the handler executes, request.clone() will throw a "Body has already been used" error,
  // because the body has already been consumed.
  const requestForErrorReporting = request.clone();

  try {
    const handler = await getHandler(env);
    return await handler(request);

  } catch (err) {
    console.error("Telegram handler error:", err);

    // تلاش برای گزارش خطا
    try {
      const update = await requestForErrorReporting.json();
      const userId = update.message?.from?.id || update.callback_query?.from?.id;
      if (userId) {
        await reportErrorToAdmin(env, "handleTelegramUpdate", err, userId);
      }
    } catch (e) {
      console.error("Failed to report error:", e);
    }

    return new Response("OK", { status: 200 });
  }
}