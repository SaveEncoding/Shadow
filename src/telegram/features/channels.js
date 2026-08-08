import { registerChannel, getChannels } from "../db/channels.js";
import { maybeOfferSuffixApply } from "./channelSuffix.js";

/**
  * If the message is a forwarded post from a channel, it returns that channel's information;
  * otherwise, it returns `null`. A pure function independent of grammY/D1 that is easy to test.
  */
export function getForwardedChannel(message) {
  const origin = message?.forward_origin;
  if (origin?.type !== "channel") {
    return null;
  }
  return origin.chat;
}

/** Does the assigned membership status indicate channel ownership or admin rights? */
export function isChannelOwner(memberStatus) {
  return memberStatus === "administrator" || memberStatus === "creator";
}

/**
 * Only when the chat is private AND the message is actually a forward from a channel
 * does it return that channel's info. In any group (including a discussion group linked
 * to a channel, which Telegram auto-forwards channel posts into), this always returns
 * null, because channel registration must only happen through a direct chat with the bot.
 */
export function getChannelToRegister(chatType, message) {
  if (chatType !== "private") {
    return null;
  }
  return getForwardedChannel(message);
}

/**
 * When the getChatMember call fails (not because the user is not an admin, but because
 * we couldn't check their status at all), it describes the error based on the Telegram error message.
 */
export function describeChannelAccessError(err) {
  const description = (err?.description ?? "").toLowerCase();

  if (description.includes("chat not found")) {
    return "❌ این کانال شناسایی نشد. لطفاً پست رو دوباره از همون کانال فوروارد کنید.";
  }

  if (description.includes("not a member") || description.includes("member list is inaccessible")) {
    return (
      "🤖 بات هنوز به این کانال اضافه نشده.\n\n" +
      "لطفاً اول بات رو به‌عنوان ادمین به کانال اضافه کنید، بعد همون پست رو دوباره فوروارد کنید."
    );
  }

  return "⚠️ خطا در بررسی وضعیت کانال. لطفاً کمی بعد دوباره تلاش کنید.";
}

/**
 * When `getChatMember` succeeds but the user is not an admin or owner, it displays a more specific message based on their status
 * (e.g., a regular member versus someone who is not a channel member at all).
 */
export function describeNonOwnerStatus(memberStatus) {
  if (memberStatus === "left" || memberStatus === "kicked") {
    return "❌ شما عضو این کانال نیستید.";
  }
  return "❌ فقط ادمین‌ها یا سازنده‌ی کانال می‌تونن اون رو ثبت کنن.";
}

/**
  * Registering a channel by forwarding a post from that channel, after verifying that  
  * the user is indeed the admin/owner of that channel.
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
      text += channel.username ? ` (@${channel.username})` : "";

      if (channel.owner_id === ctx.from.id) {
        text += " — مالک";
      } else if (channel.registered_by === ctx.from.id) {
        text += " — ثبت‌کننده";
      }

      text += "\n";
    }
    return ctx.reply(text);
  });

  // This handler must be registered in `FEATURES` before `echo`; for messages that are not channel forwards (in a private chat), `next()` is called so that `echo` can process them as well.
  bot.on("message", async (ctx, next) => {
    const channel = getChannelToRegister(ctx.chat?.type, ctx.message);
    if (!channel) {
      return next();
    }

    let member;
    try {
      member = await ctx.api.getChatMember(channel.id, ctx.from.id);
    } catch (err) {
      console.error("[channelsFeature] getChatMember failed:", err);
      return ctx.reply(describeChannelAccessError(err));
    }

    if (!isChannelOwner(member.status)) {
      return ctx.reply(describeNonOwnerStatus(member.status));
    }

    const isOwner = member.status === "creator";
    const { isNewChannel } = await registerChannel(
      env.my_database,
      ctx.from.id,
      {
        id: channel.id,
        title: channel.title,
        username: channel.username ?? null,
      },
      { isOwner }
    );

    if (isNewChannel) {
      await ctx.reply(`✅ کانال «${channel.title}» با موفقیت ثبت شد.`);
    } else {
      await ctx.reply(
        `✅ این کانال قبلاً توسط یکی دیگه از ادمین‌ها ثبت شده بود؛ شما هم به لیست ادمین‌های «${channel.title}» اضافه شدید.`
      );
    }

    // If an official suffix is configured, offer one-tap apply on this forwarded post.
    await maybeOfferSuffixApply(ctx, env, channel);
  });
}
