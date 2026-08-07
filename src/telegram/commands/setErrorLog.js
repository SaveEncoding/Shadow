import { Role } from "../constants/roles.js";
import { UserService } from "../services/userService.js";
import { setErrorLogChatId, getErrorLogChatId } from "../db/settings.js";

/**
 * /seterrorlog — bind the current group as the private error-log chat.
 * Must be run inside a group/supergroup by EXEC_ADMIN+.
 *
 * /geterrorlog — show the currently configured log chat id (admins only).
 */
export function setErrorLogCommand(bot, env) {
  const userService = new UserService(env.my_database);

  bot.command("seterrorlog", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const role = await userService.getEffectiveRole(fromId, env);
    if (role < Role.EXEC_ADMIN) {
      return ctx.reply("⛔️ فقط ادمین بات می‌تواند گپ لاگ خطا را تنظیم کند.");
    }

    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
      return ctx.reply(
        "ℹ️ این دستور را داخل همان گپ خصوصی/سوپرگروهی بزن که می‌خواهی خطاها آنجا فرستاده شوند."
      );
    }

    await setErrorLogChatId(env.my_database, chat.id);
    await ctx.reply(
      `✅ گپ لاگ خطا ثبت شد.\n<code>${chat.id}</code>\n${chat.title ? escapeHtml(chat.title) : ""}`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("geterrorlog", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const role = await userService.getEffectiveRole(fromId, env);
    if (role < Role.EXEC_ADMIN) {
      return ctx.reply("⛔️ فقط ادمین بات.");
    }

    const chatId = await getErrorLogChatId(env.my_database);
    if (chatId === null) {
      return ctx.reply(
        "⚠️ هنوز گپ لاگ تنظیم نشده. داخل گپ مورد نظر /seterrorlog را بزن."
      );
    }
    return ctx.reply(`📋 گپ لاگ فعلی: <code>${chatId}</code>`, {
      parse_mode: "HTML",
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
