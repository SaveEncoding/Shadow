// import { addUser }
// from "../db/users";

// import { sendMessage }
// from "../services/telegramService";
import { withErrorHandling } from "../utils/Errorhandler.js";
import { homeInlineKeyboard } from "../keyboards/home.js";


export async function startCommand(bot, env, ctx) {
    try {
        bot.command("start", async (ctx) => {
            await ctx.reply("👋 <b>بات Shadow</b> فعال شد.\n\nمدیریت کانال‌های تلگرام", {
            parse_mode: "HTML",
            reply_markup : homeInlineKeyboard()
            });
        });

    } catch (err) {
        console.error("[startCommand] Error:", err);
        throw err;
    }

}

export default withErrorHandling(startCommand, "startCommand")
