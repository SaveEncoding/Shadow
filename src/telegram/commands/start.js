import { homeInlineKeyboard } from "../keyboards/home.js";

/**
 * Registers the /start command on the bot.
 * Call once per bot instance, e.g. from main-tel.js's feature list.
 */
export function startCommand(bot, env) {
  try {
    bot.command("start", async (ctx) => {
      await ctx.reply("👋 <b>بات Shadow</b> فعال شد.\n\nمدیریت کانال‌های تلگرام", {
        parse_mode: "HTML",
        reply_markup: homeInlineKeyboard()
      });
    });
  } catch (err) {
    console.error("[startCommand] Error:", err);
    throw err;
  }
}
