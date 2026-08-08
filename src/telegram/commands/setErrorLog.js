import { Role } from "../constants/roles.js";
import { UserService } from "../services/userService.js";
import { setErrorLogChatId, getErrorLogTarget } from "../db/settings.js";
import { escapeHtml } from "../services/telegramService.js";

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

    // اگر گپ به موضوعات (Topics) تقسیم شده و دستور داخل یکی از آن موضوعات
    // زده شود، is_topic_message ست می‌شود و باید همان موضوع دقیق ذخیره شود؛
    // وگرنه پیام‌های لاگ همیشه به موضوع «عمومی» می‌روند، نه جایی که تنظیم شده.
    const threadId = ctx.message?.is_topic_message
      ? ctx.message.message_thread_id
      : null;

    await setErrorLogChatId(env.my_database, chat.id, threadId);

    const topicNote = threadId
      ? `\n🧵 موضوع: <code>${threadId}</code> (پیام‌های لاگ دقیقاً همین موضوع ارسال می‌شوند)`
      : chat.is_forum
        ? `\n⚠️ این گروه موضوع‌بندی شده ولی دستور داخل موضوع «عمومی» زده شد؛ پیام‌های لاگ به همان‌جا می‌روند.`
        : "";

    await ctx.reply(
      `✅ گپ لاگ خطا ثبت شد.\n<code>${chat.id}</code>\n${chat.title ? escapeHtml(chat.title) : ""}${topicNote}`,
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

    const { chatId, threadId } = await getErrorLogTarget(env.my_database);
    if (chatId === null) {
      return ctx.reply(
        "⚠️ هنوز گپ لاگ تنظیم نشده. داخل گپ مورد نظر /seterrorlog را بزن."
      );
    }
    const threadLine = threadId
      ? `\n🧵 موضوع: <code>${threadId}</code>`
      : "";
    return ctx.reply(`📋 گپ لاگ فعلی: <code>${chatId}</code>${threadLine}`, {
      parse_mode: "HTML",
    });
  });
}
