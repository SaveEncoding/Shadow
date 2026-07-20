import { createBot } from "./bot.js";
import { webhookCallback } from "grammy";
import { reportErrorToAdmin } from "./utils/Error.js";
import { startCommand } from "./commands/start.js";
import { echo } from "./services/echoFun.js";

export async function handleTelegramUpdate(request, env) {
  try {
    const bot = createBot(env);

    const handler = webhookCallback(bot, "cloudflare-mod", {
      // secretToken: "your-strong-secret-token"   // امنیت بیشتر (توصیه می‌شود)
    });

    await echo(bot);



    // await startCommand(env);
    return await handler(request);

  } catch (err) {
    console.error("Telegram handler error:", err);

    // تلاش برای گزارش خطا
    try {
      const update = await request.clone().json();
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