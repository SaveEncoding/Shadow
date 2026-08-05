import { Bot } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { AsyncLocalStorage } from "node:async_hooks";
import { UserService } from "./services/userService.js";

/** Per-request Cloudflare ExecutionContext (for waitUntil). */
export const executionCtxStorage = new AsyncLocalStorage();

// In-memory throttle: avoid writing to D1 on every message from the same user.
// Best-effort only (isolate may be recycled; multiple isolates can run in parallel).
const lastSeen = new Map();
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export function createBot(env) {
  if (!env.TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN is not set in secrets");
  }

  const bot = new Bot(env.TELEGRAM_TOKEN);
  const userService = new UserService(env.my_database);

  bot.use(conversations());

  bot.use(async (ctx, next) => {
    const from = ctx.from;

    if (isDirectUserInteraction(ctx) && from?.id) {
      const now = Date.now();
      if (!lastSeen.has(from.id) || now - lastSeen.get(from.id) > THROTTLE_MS) {
        lastSeen.set(from.id, now);

        // Fire-and-forget: do not block the webhook response on the D1 write.
        const promise = userService
          .registerOrUpdate(from)
          .catch((err) => console.error("Failed to register user:", err));

        const execCtx = executionCtxStorage.getStore();
        if (execCtx?.waitUntil) {
          execCtx.waitUntil(promise);
        }
      }
    }

    return next();
  });

  return bot;
};

export function isDirectUserInteraction(ctx) {
  // Private chat with the bot: Every message or callback query counts.
  if (ctx.chat?.type === "private") {
    return true;
  }

  // Pressing an inline bot button—even within a group—means the user has interacted directly with the bot.
  if (ctx.callbackQuery) {
    return true;
  }

  // Inside a group/supergroup: It only counts if the user has actually called the bot
  // (not just any message exchanged in the group)
  if (ctx.message) {
    const isCommand = ctx.message.text?.startsWith("/");
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me?.id;
    if (isCommand || isReplyToBot) {
      return true;
    }
  }

  return false;
}
