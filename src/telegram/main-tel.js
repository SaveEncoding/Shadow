import { createBot, executionCtxStorage } from "./bot.js";
import { webhookCallback } from "grammy";
import { reportErrorToAdmin } from "./utils/Error.js";
import { startCommand } from "./commands/start.js";
import { channelsFeature } from "./features/channels.js";
import { echo } from "./services/echoFun.js";

// It is created only once per isolate and reused across requests,
// instead of each webhook creating a new Bot from scratch and re-registering the handlers.
let handlerPromise = null;

// Any new feature simply needs to be added here.
// Required signature for each entry: (bot, env) => void | Promise<void>
// Order matters for "message" handlers that don't call next(): echo must stay last.
const FEATURES = [
  (bot, env) => startCommand(bot, env),
  (bot, env) => channelsFeature(bot, env),
  (bot, env) => echo(bot),
];

function getHandler(env) {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      if (!env.TELEGRAM_WEBHOOK_SECRET) {
        throw new Error("TELEGRAM_WEBHOOK_SECRET is not set in secrets");
      }

      const bot = createBot(env);

      for (const registerFeature of FEATURES) {
        await registerFeature(bot, env);
      }

      return webhookCallback(bot, "cloudflare-mod", {
        // This value must be set to be exactly the same both here (as the secret)
        // and when calling setWebhook (as the secret_token parameter); otherwise,
        // Telegram won't send any header, and all requests will result in a 401 error.
        secretToken: env.TELEGRAM_WEBHOOK_SECRET,
      });
    })();
  }
  return handlerPromise;
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} [executionCtx] - Cloudflare ExecutionContext for waitUntil
 */
export async function handleTelegramUpdate(request, env, executionCtx) {
  // Important: Cloning the request must be done before the body is read by the handler.
  // If called after the handler executes, request.clone() will throw a "Body has already been used" error,
  // because the body has already been consumed.
  const requestForErrorReporting = request.clone();

  const run = async () => {
    try {
      const handler = await getHandler(env);
      return await handler(request);
    } catch (err) {
      console.error("Telegram handler error:", err);

      // Attempting to report an error
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
  };

  // Bind ExecutionContext so bot middleware can call waitUntil (fire-and-forget D1 writes).
  if (executionCtx) {
    return await executionCtxStorage.run(executionCtx, run);
  }
  return await run();
}
