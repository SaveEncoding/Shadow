import { createBot, executionCtxStorage } from "./bot.js";
import { Bot, webhookCallback } from "grammy";
import { Update } from "grammy/types";
import { Env } from "../types.js";
import { reportError } from "./utils/Error.js";
import { startCommand } from "./commands/start.js";
import { channelsFeature } from "./features/channels.js";
import { echo } from "./features/echoFun.js";
import { setErrorLogCommand } from "./commands/setErrorLog.js";
import { adminPanelFeature } from "./features/adminPanel.js";
import { channelSuffixFeature } from "./features/channelSuffix.js";
import { menuFeature } from "./features/menu.js";
import { chessFeature } from "./features/chess.js";

// webhookCallback is overloaded per-adapter, so `ReturnType<typeof webhookCallback>`
// alone resolves to its broad, generic multi-adapter overload rather than the
// specific "cloudflare-mod" one. Wrapping the actual call in a helper forces
// TypeScript to resolve the correct overload, then we extract the type from that.
function createTelegramHandler(bot: Bot, secretToken: string) {
  return webhookCallback(bot, "cloudflare-mod", {
    secretToken,
  });
}

type TelegramHandler = ReturnType<typeof createTelegramHandler>;

// It is created only once per isolate and reused across requests,
// instead of each webhook creating a new Bot from scratch and re-registering the handlers.
let handlerPromise: Promise<TelegramHandler> | null = null;

// Any new feature simply needs to be added here.
// Required signature for each entry: (bot, env) => void | Promise<void>
// Order matters for "message" handlers that don't call next(): echo must stay last.
const FEATURES: Array<(bot: Bot, env: Env) => void | Promise<void>> = [
  (bot, env) => startCommand(bot, env),
  (bot, env) => menuFeature(bot, env),
  (bot, env) => setErrorLogCommand(bot, env),
  (bot, env) => adminPanelFeature(bot, env),
  (bot, env) => channelSuffixFeature(bot, env),
  (bot, env) => channelsFeature(bot, env),
  (bot, env) => chessFeature(bot, env),
  (bot, env) => echo(bot),
];

function getHandler(env: Env): Promise<TelegramHandler> {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      if (!env.TELEGRAM_WEBHOOK_SECRET) {
        throw new Error("TELEGRAM_WEBHOOK_SECRET is not set in secrets");
      }

      const bot = createBot(env);

      for (const registerFeature of FEATURES) {
        await registerFeature(bot, env);
      }

      // This value must be set to be exactly the same both here (as the secret)
      // and when calling setWebhook (as the secret_token parameter); otherwise,
      // Telegram won't send any header, and all requests will result in a 401 error.
      return createTelegramHandler(bot, env.TELEGRAM_WEBHOOK_SECRET);
    })().catch((err) => {
      // If setup failed, don't leave a rejected promise cached: a Promise is
      // truthy whether it resolves or rejects, so `if (!handlerPromise)` would
      // otherwise stay false forever and every future request would keep
      // getting this same failure until Cloudflare recycles the isolate.
      // Resetting it here lets the next request retry setup from scratch.
      handlerPromise = null;
      throw err;
    });
  }
  return handlerPromise;
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} [executionCtx] - Cloudflare ExecutionContext for waitUntil
 */
export async function handleTelegramUpdate(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
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
        const update = await requestForErrorReporting.json() as Update;
        const userId = update.message?.from?.id || update.callback_query?.from?.id;
        if (userId) {
          await reportError(env, "handleTelegramUpdate", err, userId);
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