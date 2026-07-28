import { Bot } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { UserService } from "./services/userService.js";

export function createBot(env) {
  if (!env.TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN is not set in secrets");
  }

  const bot = new Bot(env.TELEGRAM_TOKEN);
  const userService = new UserService(env.my_database);

  bot.use(conversations());

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    const isDirectInteraction = isDirectUserInteraction(ctx);

    if (isDirectInteraction) {
      try {
        await userService.registerOrUpdate(from);
      } catch (err) {
        console.error("Failed to register user:", err);
      }
    }
    return next();
  });

  return bot;
};

function isDirectUserInteraction(ctx) {
  if (ctx.chat?.type === "private") {
    return true;
  }

  if (ctx.callbackQuery) {
    return true;
  }

  if (ctx.message && ctx.chat?.type !== "private") {
    return true;
  }

  return false;
}