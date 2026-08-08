import { UserService } from "./services/userService.js";
import { sendMessage } from "./services/telegramService.js";
import { reportError } from "./utils/Error.js";
import { getErrorLogTarget } from "./db/settings.js";

const INACTIVE_DAYS = 30;

/**
  * Automatic cleanup of inactive users (older than INACTIVE_DAYS), excluding users with role >= VIP.
  * Invoked via Cron Trigger (wrangler.jsonc -> triggers.crons).
  */
export async function runScheduledCleanup(env) {
  const userService = new UserService(env.my_database);

  try {
    const { deletedCount, deletedIds } = await userService.deleteInactiveUsers(INACTIVE_DAYS);
    console.log(`[cleanup] Removed ${deletedCount} inactive user(s):`, deletedIds);

    // Always report the run's outcome to the log chat (not just when something was
    // deleted), so it can be tracked periodically even on a no-op run.
    const summary =
      deletedCount > 0
        ? `🧹 پاکسازی خودکار انجام شد.\n${deletedCount} کاربر غیرفعال (بیش از ${INACTIVE_DAYS} روز، role = 0) حذف شد.`
        : `🧹 پاکسازی خودکار انجام شد.\nهیچ کاربر غیرفعالی برای حذف پیدا نشد.`;
    const { chatId: logChatId, threadId: logThreadId } = await getErrorLogTarget(env.my_database);
    if (logChatId !== null) {
      try {
        await sendMessage(env, logChatId, summary, { threadId: logThreadId });
      } catch (err) {
        const reason =
          err?.description || err?.message || err?.name || String(err) || "unknown error";
        console.error(
          `[cleanup] Failed to notify log chat ${logChatId}: ${reason} (error_code=${err?.error_code ?? "n/a"})`,
          err?.stack
        );
      }
    }
  } catch (err) {
    console.error("[cleanup] Scheduled cleanup failed:", err);
    await reportError(env, "runScheduledCleanup", err);
  }
}
