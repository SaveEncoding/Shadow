import { UserService } from "../services/userService.js";
import {
  getChannels,
  getChannelByTelegramId,
  isUserChannelAdmin,
} from "../db/channels.js";
import { Role, RoleLabel } from "../constants/roles.js";
import { renderScreen, toast } from "../ui/render.js";
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
  channelSkipHelpText,
  backToChannelKeyboard,
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
 */
export function menuFeature(bot, env) {
  const userService = new UserService(env.my_database);

  async function roleOf(ctx) {
    if (!ctx.from?.id) return Role.NORMAL;
    return userService.getEffectiveRole(ctx.from.id, env);
  }

  // ----- Home -----
  const goHome = async (ctx) => {
    const role = await roleOf(ctx);
    await renderScreen(ctx, homeText(role), homeKeyboard(role));
  };

  bot.callbackQuery(["m:h", "home"], goHome);

  // ----- Add channel -----
  bot.callbackQuery(["m:a", "add_channel"], async (ctx) => {
    await renderScreen(ctx, addChannelText(), addChannelKeyboard());
  });

  // ----- Channel list -----
  bot.callbackQuery(["m:l", "my_channels"], async (ctx) => {
    const channels = await getChannels(env.my_database, ctx.from.id);
    await renderScreen(
      ctx,
      channelsListText(channels, ctx.from.id),
      channelsListKeyboard(channels)
    );
  });

  // ----- Channel detail -----
  bot.callbackQuery(/^m:c:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const allowed = await isUserChannelAdmin(
      env.my_database,
      channelId,
      ctx.from.id
    );
    if (!allowed) {
      return toast(ctx, "دسترسی به این کانال ندارید.");
    }
    const ch = await getChannelByTelegramId(env.my_database, channelId);
    if (!ch) {
      return toast(ctx, "کانال پیدا نشد.");
    }
    await renderScreen(
      ctx,
      channelDetailText(ch, ctx.from.id),
      channelDetailKeyboard(channelId)
    );
  });

  bot.callbackQuery(/^m:cs:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const allowed = await isUserChannelAdmin(
      env.my_database,
      channelId,
      ctx.from.id
    );
    if (!allowed) return toast(ctx, "دسترسی ندارید.");
    const ch = await getChannelByTelegramId(env.my_database, channelId);
    if (!ch) return toast(ctx, "کانال پیدا نشد.");
    await renderScreen(
      ctx,
      channelSuffixHelpText(ch),
      backToChannelKeyboard(channelId)
    );
  });

  bot.callbackQuery(/^m:sk:(-?\d+)$/, async (ctx) => {
    const channelId = Number(ctx.match[1]);
    const allowed = await isUserChannelAdmin(
      env.my_database,
      channelId,
      ctx.from.id
    );
    if (!allowed) return toast(ctx, "دسترسی ندارید.");
    const ch = await getChannelByTelegramId(env.my_database, channelId);
    if (!ch) return toast(ctx, "کانال پیدا نشد.");
    await renderScreen(
      ctx,
      channelSkipHelpText(ch),
      backToChannelKeyboard(channelId)
    );
  });

  // ----- Stats -----
  bot.callbackQuery(["m:st", "stats"], async (ctx) => {
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
    await renderScreen(ctx, settingsText(), settingsKeyboard());
  });

  // ----- Help -----
  bot.callbackQuery(["m:hp", "help"], async (ctx) => {
    await renderScreen(ctx, helpText(), helpKeyboard());
  });

  // ----- Support -----
  bot.callbackQuery("m:sp", async (ctx) => {
    await renderScreen(ctx, supportText(), supportKeyboard());
  });

  // ----- Admin hub -----
  bot.callbackQuery(["m:ad", "panel"], async (ctx) => {
    const role = await roleOf(ctx);
    if (role < Role.EXEC_ADMIN) {
      return toast(ctx, "این بخش مخصوص ادمین‌های ربات است.");
    }
    await renderScreen(ctx, adminHubText(role), adminHubKeyboard(role));
  });

  // ----- Coming soon stubs -----
  bot.callbackQuery(/^m:soon:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    await renderScreen(ctx, soonText(key), soonKeyboard());
  });
}
