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