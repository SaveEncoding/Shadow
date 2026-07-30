import { UserService } from "./services/userService.js";
import { sendMessage } from "./services/telegramService.js";
import { reportErrorToAdmin } from "./utils/Error.js";
import { ADMINS } from "./config.js";

const INACTIVE_DAYS = 30;

/**
  * Automatic cleanup of inactive users (older than INACTIVE_DAYS), excluding VIP users.
  * Invoked via Cron Trigger (wrangler.jsonc -> triggers.crons).
  */
export async function runScheduledCleanup(env) {
  const userService = new UserService(env.my_database);

  try {
    const { deletedCount, deletedIds } = await userService.deleteInactiveUsers(INACTIVE_DAYS);
    console.log(`[cleanup] Removed ${deletedCount} inactive user(s):`, deletedIds);

    if (deletedCount > 0) {
      const summary = `🧹 پاکسازی خودکار انجام شد.\n${deletedCount} کاربر غیرفعال (بیش از ${INACTIVE_DAYS} روز، غیر VIP) حذف شد.`;
      for (const adminId of ADMINS) {
        try {
          await sendMessage(env, adminId, summary);
        } catch (err) {
          console.error(`[cleanup] Failed to notify admin ${adminId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[cleanup] Scheduled cleanup failed:", err);
    await reportErrorToAdmin(env, "runScheduledCleanup", err);
  }
}
