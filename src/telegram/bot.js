import { Bot } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { UserService } from "./services/userService";

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

  bot.command("start", async (ctx) => {
    await ctx.reply("👋 <b>بات Shadow</b> فعال شد.\n\nمدیریت کانال‌های تلگرام", {
      parse_mode: "HTML"
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply("دستورات:\n/addchannel - افزودن کانال\n/mychannels - لیست کانال‌ها\n/post - ارسال پست");
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