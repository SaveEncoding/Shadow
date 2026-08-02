import { addChannel, getChannels } from "../db/channels.js";

/**
 * اگه پیام یه پست فوروواردشده از یه کانال باشه، اطلاعات همون کانال رو برمی‌گردونه؛
 * در غیر این صورت null. یه تابع خالص و مستقل از grammY/D1 که راحت تست می‌شه.
 */
export function getForwardedChannel(message) {
  const origin = message?.forward_origin;
  if (origin?.type !== "channel") {
    return null;
  }
  return origin.chat;
}

/** آیا وضعیت عضویت داده‌شده، مالکیت/ادمین بودن روی کانال رو نشون می‌ده؟ */
export function isChannelOwner(memberStatus) {
  return memberStatus === "administrator" || memberStatus === "creator";
}

/**
 * ثبت‌نام کانال از طریق فوروارد کردن یه پست از اون کانال، پس از تأیید اینکه
 * کاربر واقعاً ادمین/مالک همون کانال هست.
 */
export function channelsFeature(bot, env) {
  bot.callbackQuery("add_channel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "📤 یک پست از کانال خودتون رو برای من فوروارد کنید.\n\n" +
        "توجه: بات باید از قبل به‌عنوان ادمین به اون کانال اضافه شده باشه."
    );
  });

  bot.callbackQuery("my_channels", async (ctx) => {
    await ctx.answerCallbackQuery();
    const channels = await getChannels(env.my_database, ctx.from.id);

    if (!channels.length) {
      return ctx.reply("هیچ کانالی ثبت نشده است.");
    }

    let text = "📋 کانال‌های شما:\n\n";
    for (const channel of channels) {
      text += `• ${channel.title}`;
      text += channel.username ? ` (@${channel.username})\n` : "\n";
    }
    return ctx.reply(text);
  });

  // این handler باید قبل از echo توی FEATURES ثبت بشه؛ برای پیام‌هایی که فوروارد
  // کانال نیستن next() صدا زده می‌شه تا echo هم بتونه پردازششون کنه.
  bot.on("message", async (ctx, next) => {
    const channel = getForwardedChannel(ctx.message);
    if (!channel) {
      return next();
    }

    let member;
    try {
      member = await ctx.api.getChatMember(channel.id, ctx.from.id);
    } catch (err) {
      console.error("[channelsFeature] getChatMember failed:", err);
      return ctx.reply(
        "برای ثبت این کانال، بات باید از قبل به‌عنوان ادمین به اون کانال اضافه شده باشه."
      );
    }

    if (!isChannelOwner(member.status)) {
      return ctx.reply("فقط ادمین‌های خود کانال می‌تونن اون رو ثبت کنن.");
    }

    await addChannel(env.my_database, ctx.from.id, {
      id: channel.id,
      title: channel.title,
      username: channel.username ?? null,
    });

    return ctx.reply(`✅ کانال «${channel.title}» با موفقیت ثبت شد.`);
  });
}
