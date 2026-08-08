import { InlineKeyboard } from "grammy";
import {
  getChannelByTelegramId,
  isUserChannelAdmin,
  getOfficialSuffix,
  setOfficialSuffix,
  getChannels,
} from "../db/channels.js";
import {
  appendSuffixPreservingEntities,
  extractEditableContent,
} from "../utils/messageSuffix.js";
import {
  editMessageTextWithEntities,
  editMessageCaptionWithEntities,
} from "../services/telegramService.js";

/**
 * Official channel suffix: set via /setsuffix, apply by forwarding a post
 * (button) or callback apply_suffix:<channelId>:<messageId>.
 *
 * Formatting of the original body is preserved via Telegram entities
 * (not HTML round-trip).
 */
export function channelSuffixFeature(bot, env) {
  // /setsuffix <channel_id>
  // then next line(s) or same-message remainder = suffix text
  // /setsuffix <channel_id> clear  → remove suffix
  bot.command("setsuffix", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      return ctx.reply("این دستور را در چت خصوصی با بات بزنید.");
    }

    const raw = (ctx.message?.text || "").split("\n");
    const firstLine = raw[0] || "";
    const parts = firstLine.trim().split(/\s+/);
    // parts[0]=/setsuffix parts[1]=channel_id parts[2+]=optional same-line suffix or "clear"
    const channelId = parts[1] ? Number(parts[1]) : NaN;
    if (!Number.isFinite(channelId)) {
      const list = await getChannels(env.my_database, fromId);
      if (!list.length) {
        return ctx.reply(
          "فرمت: <code>/setsuffix &lt;channel_id&gt;</code> و در خط بعد متن پسوند\n" +
            "یا <code>/setsuffix &lt;channel_id&gt; clear</code>\n\n" +
            "هنوز کانالی ثبت نکرده‌اید.",
          { parse_mode: "HTML" }
        );
      }
      let hint = "فرمت: <code>/setsuffix &lt;channel_id&gt;</code> و متن پسوند در خط بعد.\n\nکانال‌های شما:\n";
      for (const ch of list) {
        hint += `• <b>${escapeHtml(ch.title)}</b> — <code>${ch.channel_id}</code>\n`;
      }
      return ctx.reply(hint, { parse_mode: "HTML" });
    }

    const allowed = await isUserChannelAdmin(env.my_database, channelId, fromId);
    if (!allowed) {
      return ctx.reply("⛔️ این کانال برای شما ثبت نشده یا ادمین آن نیستید.");
    }

    const sameLineRest = parts.slice(2).join(" ").trim();
    const multiLineRest = raw.slice(1).join("\n").trim();
    const payload = multiLineRest || sameLineRest;

    if (!payload) {
      const current = await getOfficialSuffix(env.my_database, channelId);
      return ctx.reply(
        current
          ? `پسوند فعلی کانال <code>${channelId}</code>:\n${escapeHtml(current)}\n\nبرای تغییر، دستور را با متن جدید بفرستید.`
          : `پسوندی برای <code>${channelId}</code> تنظیم نشده.\nدوباره بفرستید:\n<code>/setsuffix ${channelId}</code>\nمتن پسوند`,
        { parse_mode: "HTML" }
      );
    }

    if (payload.toLowerCase() === "clear") {
      await setOfficialSuffix(env.my_database, channelId, null);
      return ctx.reply(`✅ پسوند کانال <code>${channelId}</code> پاک شد.`, {
        parse_mode: "HTML",
      });
    }

    await setOfficialSuffix(env.my_database, channelId, payload);
    return ctx.reply(
      `✅ پسوند رسمی برای <code>${channelId}</code> ذخیره شد.\n\n` +
        `برای اعمال: یک پست از همان کانال را برای بات فوروارد کنید و دکمه «افزودن پسوند» را بزنید.`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("getsuffix", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const parts = (ctx.message?.text || "").trim().split(/\s+/);
    const channelId = parts[1] ? Number(parts[1]) : NaN;
    if (!Number.isFinite(channelId)) {
      return ctx.reply("فرمت: <code>/getsuffix &lt;channel_id&gt;</code>", {
        parse_mode: "HTML",
      });
    }
    const allowed = await isUserChannelAdmin(env.my_database, channelId, fromId);
    if (!allowed) {
      return ctx.reply("⛔️ دسترسی ندارید.");
    }
    const current = await getOfficialSuffix(env.my_database, channelId);
    return ctx.reply(
      current
        ? `پسوند <code>${channelId}</code>:\n${escapeHtml(current)}`
        : `پسوندی تنظیم نشده.`,
      { parse_mode: "HTML" }
    );
  });

  // Apply suffix to an original channel message
  // callback data: asfx:<channelId>:<messageId>:<kind>
  // kind = t (text) | c (caption) — content was snapshotted in the forward
  bot.callbackQuery(/^asfx:(-?\d+):(\d+):(t|c)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const channelId = Number(ctx.match[1]);
    const messageId = Number(ctx.match[2]);
    const kind = ctx.match[3];

    const allowed = await isUserChannelAdmin(env.my_database, channelId, fromId);
    if (!allowed) {
      return ctx.answerCallbackQuery({
        text: "دسترسی ندارید.",
        show_alert: true,
      });
    }

    const suffix = await getOfficialSuffix(env.my_database, channelId);
    if (!suffix) {
      return ctx.answerCallbackQuery({
        text: "پسوند تنظیم نشده. /setsuffix",
        show_alert: true,
      });
    }

    // Prefer content stored on the button message's reply_to (the forward).
    // Fallback: cannot re-fetch channel message body via Bot API without storing it.
    const source = ctx.callbackQuery.message?.reply_to_message;
    const content = extractEditableContent(source);
    if (!content.kind) {
      return ctx.answerCallbackQuery({
        text: "متن/کپشن در پیام فوروارد پیدا نشد.",
        show_alert: true,
      });
    }

    const result = appendSuffixPreservingEntities(
      content.text,
      content.entities,
      suffix,
      { maxLen: content.maxLen }
    );

    if (result.skipped === "already_present") {
      return ctx.answerCallbackQuery({ text: "پسوند از قبل هست." });
    }
    if (result.skipped === "too_long") {
      return ctx.answerCallbackQuery({
        text: "با پسوند از سقف طول تلگرام بیشتر می‌شود.",
        show_alert: true,
      });
    }
    if (result.skipped) {
      return ctx.answerCallbackQuery({ text: "انجام نشد.", show_alert: true });
    }

    try {
      if (kind === "c" || content.kind === "caption") {
        await editMessageCaptionWithEntities(
          env,
          channelId,
          messageId,
          result.text,
          result.entities
        );
      } else {
        await editMessageTextWithEntities(
          env,
          channelId,
          messageId,
          result.text,
          result.entities
        );
      }
      await ctx.answerCallbackQuery({ text: "✅ پسوند اضافه شد." });
      try {
        await ctx.editMessageText("✅ پسوند رسمی به پست کانال اضافه شد.");
      } catch {
        /* message may be non-editable */
      }
    } catch (err) {
      console.error("[channelSuffix] edit failed:", err);
      const desc = err?.description || err?.message || "خطای تلگرام";
      await ctx.answerCallbackQuery({
        text: String(desc).slice(0, 180),
        show_alert: true,
      });
    }
  });
}

/**
 * After a successful channel-forward registration path, offer "apply suffix"
 * when the channel already has an official_suffix and the message is editable.
 *
 * @returns {Promise<boolean>} true if a reply with the apply keyboard was sent
 */
export async function maybeOfferSuffixApply(ctx, env, channel) {
  const suffix = await getOfficialSuffix(env.my_database, channel.id);
  if (!suffix) return false;

  const origin = ctx.message?.forward_origin;
  if (origin?.type !== "channel" || origin.message_id == null) return false;

  const content = extractEditableContent(ctx.message);
  if (!content.kind) {
    await ctx.reply(
      "این پست متن/کپشن ندارد؛ پسوند فقط روی متن یا کپشن اعمال می‌شود."
    );
    return true;
  }

  const kind = content.kind === "caption" ? "c" : "t";
  const kb = new InlineKeyboard().text(
    "➕ افزودن پسوند رسمی",
    `asfx:${channel.id}:${origin.message_id}:${kind}`
  );

  await ctx.reply(
    `پسوند رسمی برای «${channel.title}» تنظیم شده.\n` +
      `اگر می‌خواهید به همین پست در کانال اضافه شود:`,
    { reply_markup: kb, reply_parameters: { message_id: ctx.message.message_id } }
  );
  return true;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
