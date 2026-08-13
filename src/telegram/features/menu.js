import { UserService } from "../services/userService.js";
import {
  getChannels,
  getChannelByTelegramId,
  isUserChannelAdmin,
  setOfficialSuffix,
  setSuffixSkipMarker,
} from "../db/channels.js";
import { Role, RoleLabel } from "../constants/roles.js";
import { renderScreen, toast } from "../ui/render.js";
import { sanitizeEntities } from "../utils/messageSuffix.js";
import {
  setPendingInput,
  getPendingInput,
  clearPendingInput,
} from "../ui/pendingInput.js";
import {
  homeText,
  homeKeyboard,
  addChannelText,
  addChannelKeyboard,
  channelsListText,
  channelsListKeyboard,
  channelDetailText,
  channelDetailKeyboard,
  channelSuffixHelpText,
  channelSuffixKeyboard,
  channelSkipHelpText,
  channelSkipKeyboard,
  awaitInputText,
  awaitInputKeyboard,
  confirmClearText,
  confirmClearKeyboard,
  statsText,
  statsKeyboard,
  settingsText,
  settingsKeyboard,
  helpText,
  helpKeyboard,
  supportText,
  supportKeyboard,
  adminHubText,
  adminHubKeyboard,
  soonText,
  soonKeyboard,
} from "../ui/screens.js";

/**
 * Central user-facing menu. All navigation edits the same message (renderScreen).
 * Legacy callbacks (home, add_channel, my_channels, help, settings, stats, panel)
 * are aliased here so old keyboards keep working.
 *
 * Suffix / skip-marker can be set entirely via glass buttons + the next text message
 * (no dependency on /setsuffix for the happy path).
 */
export function menuFeature(bot, env) {
  const userService = new UserService(env.my_database);

  async function roleOf(ctx) {
    if (!ctx.from?.id) return Role.NORMAL;
    return userService.getEffectiveRole(ctx.from.id, env);
  }

  async function requireChannelAdmin(ctx, channelId) {
    const allowed = await isUserChannelAdmin(
      env.my_database,
      channelId,
      ctx.from.id
    );
    if (!allowed) {
      await toast(ctx, "دسترسی به این کانال ندارید.");
      return null;
    }
    const ch = await getChannelByTelegramId(env.my_database, channelId);
    if (!ch) {
      await toast(ctx, "کانال پیدا نشد.");
      return null;
    }
    return ch;
  }

  // ----- Home -----
  const goHome = async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const role = await roleOf(ctx);
    await renderScreen(ctx, homeText(role), homeKeyboard(role));
  };

  bot.callbackQuery(["m:h", "home"], goHome);

  // ----- Add channel -----
  bot.callbackQuery(["m:a", "add_channel"], async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    await renderScreen(ctx, addChannelText(), addChannelKeyboard());
  });

  // ----- Channel list -----
  bot.callbackQuery(["m:l", "my_channels"], async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const channels = await getChannels(env.my_database, ctx.from.id);
    await renderScreen(
      ctx,
      channelsListText(channels, ctx.from.id),
      channelsListKeyboard(channels)
    );
  });

  // ----- Channel detail -----
  bot.callbackQuery(/^m:c:(-?\d+)$/, async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    await renderScreen(
      ctx,
      channelDetailText(ch, ctx.from.id),
      channelDetailKeyboard(channelId)
    );
  });

  // ----- Suffix screen -----
  bot.callbackQuery(/^m:cs:(-?\d+)$/, async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    await renderScreen(
      ctx,
      channelSuffixHelpText(ch),
      channelSuffixKeyboard(channelId)
    );
  });

  // Start waiting for suffix text
  bot.callbackQuery(/^m:cs:set:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;

    setPendingInput(ctx.from.id, {
      type: "suffix",
      channelId,
      promptChatId: ctx.chat?.id,
      promptMessageId: ctx.callbackQuery?.message?.message_id,
    });

    await renderScreen(
      ctx,
      awaitInputText("suffix", ch.title),
      awaitInputKeyboard(channelId, "suffix")
    );
  });

  // Cancel waiting for suffix
  bot.callbackQuery(/^m:cs:x:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    await renderScreen(
      ctx,
      channelSuffixHelpText(ch),
      channelSuffixKeyboard(channelId)
    );
  });

  // Confirm clear suffix
  bot.callbackQuery(/^m:cs:clr:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    if (!ch.official_suffix) {
      return toast(ctx, "پسوندی برای پاک کردن نیست.");
    }
    await renderScreen(
      ctx,
      confirmClearText("suffix", ch.title),
      confirmClearKeyboard(channelId, "suffix")
    );
  });

  bot.callbackQuery(/^m:cs:clr2:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    await setOfficialSuffix(env.my_database, channelId, null);
    const updated = await getChannelByTelegramId(env.my_database, channelId);
    await renderScreen(
      ctx,
      channelSuffixHelpText(updated || ch),
      channelSuffixKeyboard(channelId)
    );
    await toast(ctx, "پسوند پاک شد.");
  });

  // ----- Skip marker screen -----
  bot.callbackQuery(/^m:sk:(-?\d+)$/, async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    await renderScreen(
      ctx,
      channelSkipHelpText(ch),
      channelSkipKeyboard(channelId)
    );
  });

  bot.callbackQuery(/^m:sk:set:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;

    setPendingInput(ctx.from.id, {
      type: "skip",
      channelId,
      promptChatId: ctx.chat?.id,
      promptMessageId: ctx.callbackQuery?.message?.message_id,
    });

    await renderScreen(
      ctx,
      awaitInputText("skip", ch.title),
      awaitInputKeyboard(channelId, "skip")
    );
  });

  bot.callbackQuery(/^m:sk:x:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    await renderScreen(
      ctx,
      channelSkipHelpText(ch),
      channelSkipKeyboard(channelId)
    );
  });

  bot.callbackQuery(/^m:sk:clr:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    if (!ch.suffix_skip_marker) {
      return toast(ctx, "مارکری برای پاک کردن نیست.");
    }
    await renderScreen(
      ctx,
      confirmClearText("skip", ch.title),
      confirmClearKeyboard(channelId, "skip")
    );
  });

  bot.callbackQuery(/^m:sk:clr2:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const ch = await requireChannelAdmin(ctx, channelId);
    if (!ch) return;
    await setSuffixSkipMarker(env.my_database, channelId, null);
    const updated = await getChannelByTelegramId(env.my_database, channelId);
    await renderScreen(
      ctx,
      channelSkipHelpText(updated || ch),
      channelSkipKeyboard(channelId)
    );
    await toast(ctx, "مارکر پاک شد.");
  });

  // ----- Stats -----
  bot.callbackQuery(["m:st", "stats"], async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const role = await roleOf(ctx);
    const channels = await getChannels(env.my_database, ctx.from.id);
    let roleStats = null;
    if (role >= Role.EXEC_ADMIN) {
      const counts = await userService.getRoleStats();
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      roleStats = { counts, labels: RoleLabel, total };
    }
    await renderScreen(
      ctx,
      statsText({ channelCount: channels.length, roleStats, userRole: role }),
      statsKeyboard()
    );
  });

  // ----- Settings -----
  bot.callbackQuery(["m:se", "settings"], async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    await renderScreen(ctx, settingsText(), settingsKeyboard());
  });

  // ----- Help -----
  bot.callbackQuery(["m:hp", "help"], async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    await renderScreen(ctx, helpText(), helpKeyboard());
  });

  // ----- Support -----
  bot.callbackQuery("m:sp", async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    await renderScreen(ctx, supportText(), supportKeyboard());
  });

  // ----- Admin hub -----
  bot.callbackQuery(["m:ad", "panel"], async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const role = await roleOf(ctx);
    if (role < Role.EXEC_ADMIN) {
      return toast(ctx, "این بخش مخصوص ادمین‌های ربات است.");
    }
    await renderScreen(ctx, adminHubText(role), adminHubKeyboard(role));
  });

  // ----- Coming soon stubs -----
  bot.callbackQuery(/^m:soon:(.+)$/, async (ctx) => {
    if (ctx.from?.id) clearPendingInput(ctx.from.id);
    const key = ctx.match[1];
    await renderScreen(ctx, soonText(key), soonKeyboard());
  });

  // ----- Collect text while a glass-button flow is pending -----
  // Registered before channelsFeature/echo; only consumes when pending is set.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from?.id) return next();

    const pending = getPendingInput(ctx.from.id);
    if (!pending) return next();

    // Ignore bot commands so /start etc. still work.
    const text = (ctx.message.text || "").trim();
    if (text.startsWith("/")) {
      clearPendingInput(ctx.from.id);
      return next();
    }

    if (!text) {
      await ctx.reply("متن خالی پذیرفته نمی‌شود. دوباره بفرستید یا انصراف دهید.");
      return;
    }

    const allowed = await isUserChannelAdmin(
      env.my_database,
      pending.channelId,
      ctx.from.id
    );
    if (!allowed) {
      clearPendingInput(ctx.from.id);
      await ctx.reply("⛔️ دسترسی به این کانال را از دست داده‌اید.");
      return;
    }

    clearPendingInput(ctx.from.id);

    if (pending.type === "suffix") {
      // Preserve bold/spoiler/links/… from the user's formatted message.
      const entities = sanitizeEntities(ctx.message.entities);
      await setOfficialSuffix(
        env.my_database,
        pending.channelId,
        text,
        entities
      );
    } else if (pending.type === "skip") {
      await setSuffixSkipMarker(env.my_database, pending.channelId, text);
    }

    const ch = await getChannelByTelegramId(env.my_database, pending.channelId);
    const screenText =
      pending.type === "suffix"
        ? channelSuffixHelpText(ch)
        : channelSkipHelpText(ch);
    const screenKb =
      pending.type === "suffix"
        ? channelSuffixKeyboard(pending.channelId)
        : channelSkipKeyboard(pending.channelId);

    // Prefer editing the prompt message so the chat stays tidy.
    if (pending.promptChatId && pending.promptMessageId) {
      try {
        await ctx.api.editMessageText(
          pending.promptChatId,
          pending.promptMessageId,
          screenText,
          {
            parse_mode: "HTML",
            reply_markup: screenKb,
            link_preview_options: { is_disabled: true },
          }
        );
        await ctx.reply(
          pending.type === "suffix"
            ? "✅ پسوند رسمی ذخیره شد" +
              (sanitizeEntities(ctx.message.entities).length
                ? " (با فرمت)."
                : ".")
            : "✅ مارکر رد ذخیره شد."
        );
        return;
      } catch (err) {
        console.warn("[menu] edit after input failed:", err?.message || err);
      }
    }

    await ctx.reply(
      (pending.type === "suffix"
        ? "✅ پسوند رسمی ذخیره شد.\n\n"
        : "✅ مارکر رد ذخیره شد.\n\n") + screenText,
      {
        parse_mode: "HTML",
        reply_markup: screenKb,
        link_preview_options: { is_disabled: true },
      }
    );
  });
}
