import { Api } from "grammy";
import { getChannelsNeedingAdminSync, syncChannelAdmins } from "./db/channels.js";
import { sendMessage } from "./services/telegramService.js";
import { getErrorLogChatId } from "./db/settings.js";

// Each execution synchronizes at most this many channels, ensuring that—even with a very large number of channels—
// the execution time of each cron job remains limited and predictable. Full coverage is achieved over the course of several
// consecutive executions (using a round-robin approach based on the oldest sync).
const BATCH_SIZE = 200;

/**
  * It synchronizes the list of admins for a batch of channels with Telegram.
  * Unlike checking on a per-user basis at the moment of the click, here a single request per channel
  * (`getChatAdministrators`) suffices to retrieve all its admins at once.
  */
export async function refreshChannelAdmins(env) {
  const api = new Api(env.TELEGRAM_TOKEN);
  const channels = await getChannelsNeedingAdminSync(env.my_database, BATCH_SIZE);

  let totalAdded = 0;
  let totalRemoved = 0;
  let failed = 0;

  for (const channel of channels) {
    try {
      const admins = await api.getChatAdministrators(channel.channel_id);
      const adminUserIds = admins.map((admin) => admin.user.id);

      const { added, removed } = await syncChannelAdmins(env.my_database, channel.channel_id, adminUserIds);
      totalAdded += added;
      totalRemoved += removed;
    } catch (err) {
      // The bot has probably been removed from the channel or the channel no longer exists; we'll just skip it.
      // (admins_synced_at This channel is not updated, so the next batch will try again)
      failed += 1;
      console.error(`[refreshChannelAdmins] Failed to sync channel ${channel.channel_id}:`, err);
    }
  }

  console.log(
    `[refreshChannelAdmins] Synced ${channels.length} channel(s): +${totalAdded} admin(s), -${totalRemoved} admin(s), ${failed} failed.`
  );

  // Report the run's outcome to the log chat, same as runScheduledCleanup, so it
  // can be tracked periodically instead of only living in console logs.
  const summary =
    `🔄 همگام‌سازی ادمین‌های کانال انجام شد.\n` +
    `${channels.length} کانال بررسی شد: +${totalAdded} ادمین اضافه، -${totalRemoved} ادمین حذف` +
    (failed > 0 ? `، ${failed} کانال با خطا مواجه شد` : ``) +
    `.`;
  try {
    const logChatId = await getErrorLogChatId(env.my_database);
    if (logChatId !== null) {
      await sendMessage(env, logChatId, summary);
    }
  } catch (err) {
    console.error("[refreshChannelAdmins] Failed to notify log chat:", err);
  }

  return { synced: channels.length, added: totalAdded, removed: totalRemoved, failed };
}
