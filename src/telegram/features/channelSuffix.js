import { InlineKeyboard } from "grammy";
import {
  getChannelByTelegramId,
  isUserChannelAdmin,
  getOfficialSuffix,
  setOfficialSuffix,
  getSuffixSkipMarker,
  setSuffixSkipMarker,
  getChannels,
} from "../db/channels.js";
import {
  appendSuffixPreservingEntities,
  extractEditableContent,
  shouldSkipAutoSuffix,
  hasValidBotStamp,
  attachBotStamp,
  stripBotStamp,
} from "../utils/messageSuffix.js";
import {
  editMessageTextWithEntities,
  editMessageCaptionWithEntities,
} from "../services/telegramService.js";

/**
 * Official channel suffix:
 * - Manual: /setsuffix, forward + button
 * - Automatic: every new channel_post and edited_channel_post
 * - Opt-out: if post text/caption contains the admin-defined skip marker
 * - Anti-loop: after the bot edits, an invisible content stamp is appended;
 *   edited_channel_post with a valid stamp is ignored. If an admin edits the
 *   post the stamp no longer matches and the bot may re-apply the suffix.
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
      let hint =
        "فرمت: <code>/setsuffix &lt;channel_id&gt;</code> و متن پسوند در خط بعد.\n\nکانال‌های شما:\n";
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
        `از این به بعد روی <b>هر پست جدید</b> کانال به‌صورت خودکار اعمال می‌شود ` +
        `(مگر متن شامل مارکر رد باشد — <code>/setsuffixskip</code>).\n` +
        `همچنین می‌توانید پست را فوروارد کنید و دکمه دستی را بزنید.`,
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
    const marker = await getSuffixSkipMarker(env.my_database, channelId);
    let msg = current
      ? `پسوند <code>${channelId}</code>:\n${escapeHtml(current)}`
      : `پسوندی تنظیم نشده.`;
    msg += marker
      ? `\n\nمارکر رد خودکار: <code>${escapeHtml(marker)}</code>`
      : `\n\nمارکر رد خودکار: تنظیم نشده (همه پست‌ها ادیت می‌شوند).`;
    return ctx.reply(msg, { parse_mode: "HTML" });
  });

  // /setsuffixskip <channel_id> <marker...>
  // /setsuffixskip <channel_id> clear
  bot.command("setsuffixskip", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      return ctx.reply("این دستور را در چت خصوصی با بات بزنید.");
    }

    const raw = (ctx.message?.text || "").split("\n");
    const firstLine = raw[0] || "";
    const parts = firstLine.trim().split(/\s+/);
    const channelId = parts[1] ? Number(parts[1]) : NaN;
    if (!Number.isFinite(channelId)) {
      return ctx.reply(
        "فرمت:\n<code>/setsuffixskip &lt;channel_id&gt; &lt;مارکر&gt;</code>\n" +
          "یا <code>/setsuffixskip &lt;channel_id&gt; clear</code>\n\n" +
          "اگر مارکر در متن/کپشن پست باشد، پسوند خودکار اضافه <b>نمی‌شود</b>.\n" +
          "مثال مارکر: <code>#nosuffix</code> یا <code>🚫</code>",
        { parse_mode: "HTML" }
      );
    }

    const allowed = await isUserChannelAdmin(env.my_database, channelId, fromId);
    if (!allowed) {
      return ctx.reply("⛔️ این کانال برای شما ثبت نشده یا ادمین آن نیستید.");
    }

    const sameLineRest = parts.slice(2).join(" ").trim();
    const multiLineRest = raw.slice(1).join("\n").trim();
    const payload = multiLineRest || sameLineRest;

    if (!payload) {
      const current = await getSuffixSkipMarker(env.my_database, channelId);
      return ctx.reply(
        current
          ? `مارکر فعلی: <code>${escapeHtml(current)}</code>\nبرای تغییر دوباره دستور را با مارکر جدید بفرستید.`
          : `مارکری تنظیم نشده. مثال:\n<code>/setsuffixskip ${channelId} #nosuffix</code>`,
        { parse_mode: "HTML" }
      );
    }

    if (payload.toLowerCase() === "clear") {
      await setSuffixSkipMarker(env.my_database, channelId, null);
      return ctx.reply(`✅ مارکر رد برای <code>${channelId}</code> پاک شد.`, {
        parse_mode: "HTML",
      });
    }

    await setSuffixSkipMarker(env.my_database, channelId, payload);
    return ctx.reply(
      `✅ مارکر رد ذخیره شد: <code>${escapeHtml(payload)}</code>\n` +
        `هر پستی که این عبارت را در متن یا کپشن داشته باشد، پسوند خودکار نمی‌گیرد.`,
      { parse_mode: "HTML" }
    );
  });

  // --- Automatic: new + edited posts in registered channels ---
  // Loop prevention is content-stamp based (not by ignoring edited_channel_post).
  bot.on(["channel_post", "edited_channel_post"], async (ctx) => {
    try {
      await autoApplySuffixToChannelPost(ctx, env);
    } catch (err) {
      console.error("[channelSuffix] autoApply failed:", err);
    }
  });

  // Apply suffix to an original channel message (manual button)
  // callback data: asfx:<channelId>:<messageId>:<kind>
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
      const stampedText = attachBotStamp(result.text);
      if (kind === "c" || content.kind === "caption") {
        await editMessageCaptionWithEntities(
          env,
          channelId,
          messageId,
          stampedText,
          result.entities
        );
      } else {
        await editMessageTextWithEntities(
          env,
          channelId,
          messageId,
          stampedText,
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
 * Auto-append official_suffix on channel_post / edited_channel_post when:
 * - channel is registered in D1
 * - official_suffix is set
 * - post has text or caption
 * - skip marker is absent from the body
 * - message does not already carry a valid bot content-stamp
 *
 * After a successful edit the text is stamped so the resulting
 * edited_channel_post is recognized as our own and skipped. An admin edit
 * that changes the body invalidates the stamp and allows re-application.
 */
export async function autoApplySuffixToChannelPost(ctx, env) {
  const post = ctx.channelPost ?? ctx.editedChannelPost;
  if (!post) return { applied: false, reason: "no_post" };

  const channelId = post.chat?.id;
  if (channelId == null) return { applied: false, reason: "no_chat" };

  // Only registered channels (avoids editing random channels the bot admins)
  const channel = await getChannelByTelegramId(env.my_database, channelId);
  if (!channel) return { applied: false, reason: "not_registered" };

  const suffix = channel.official_suffix;
  if (suffix == null || suffix === "") {
    return { applied: false, reason: "no_suffix" };
  }

  const content = extractEditableContent(post);
  if (!content.kind) return { applied: false, reason: "no_text" };

  // Our previous edit left a valid stamp → this edited_channel_post is the echo.
  if (hasValidBotStamp(content.text)) {
    return { applied: false, reason: "bot_stamped" };
  }

  // Drop a broken/leftover stamp before further processing.
  const { text: bodyText } = stripBotStamp(content.text);

  const marker = channel.suffix_skip_marker ?? null;
  if (shouldSkipAutoSuffix(bodyText, marker)) {
    return { applied: false, reason: "skip_marker" };
  }

  const result = appendSuffixPreservingEntities(
    bodyText,
    content.entities,
    String(suffix),
    { maxLen: content.maxLen }
  );

  if (result.skipped) {
    // Suffix already there (e.g. admin kept it) → still stamp so future
    // edited_channel_post events from unrelated metadata don't re-enter.
    if (result.skipped === "already_present") {
      const stamped = attachBotStamp(result.text);
      if (stamped !== content.text) {
        if (content.kind === "caption") {
          await editMessageCaptionWithEntities(
            env,
            channelId,
            post.message_id,
            stamped,
            result.entities
          );
        } else {
          await editMessageTextWithEntities(
            env,
            channelId,
            post.message_id,
            stamped,
            result.entities
          );
        }
        return { applied: true, reason: "stamped_existing" };
      }
    }
    return { applied: false, reason: result.skipped };
  }

  const stampedText = attachBotStamp(result.text);

  if (content.kind === "caption") {
    await editMessageCaptionWithEntities(
      env,
      channelId,
      post.message_id,
      stampedText,
      result.entities
    );
  } else {
    await editMessageTextWithEntities(
      env,
      channelId,
      post.message_id,
      stampedText,
      result.entities
    );
  }

  return { applied: true, reason: null };
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
    {
      reply_markup: kb,
      reply_parameters: { message_id: ctx.message.message_id },
    }
  );
  return true;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
