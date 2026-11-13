import { UserService } from './services/userService.js';
import { notifyCronLog } from './services/cronLog.js';
import { reportError } from './utils/Error.js';
import type { Env } from '../types.js';

const INACTIVE_DAYS = 30;

/**
 * Automatic cleanup of inactive users (older than INACTIVE_DAYS), excluding users with role >= VIP.
 * Invoked via Cron Trigger (wrangler.jsonc -> triggers.crons).
 */
export async function runScheduledCleanup(env: Env): Promise<void> {
	const userService = new UserService(env.my_database);

	try {
		const { deletedCount, deletedIds } = await userService.deleteInactiveUsers(INACTIVE_DAYS);
		console.log(`[cleanup] Removed ${deletedCount} inactive user(s):`, deletedIds);

		// Always report the run's outcome to the log chat (not just when something was
		// deleted), so it can be tracked periodically even on a no-op run.
		// از پنل مدیریت می‌شود فقط همین پیام را خاموش کرد؛ خودِ پاک‌سازی همیشه اجرا می‌شود.
		const summary =
			deletedCount > 0
				? `🧹 پاکسازی خودکار انجام شد.\n${deletedCount} کاربر غیرفعال (بیش از ${INACTIVE_DAYS} روز، role = 0) حذف شد.`
				: `🧹 پاکسازی خودکار انجام شد.\nهیچ کاربر غیرفعالی برای حذف پیدا نشد.`;
		await notifyCronLog(env, 'cleanup', summary, 'cleanup');
	} catch (err) {
		console.error('[cleanup] Scheduled cleanup failed:', err);
		await reportError(env, 'runScheduledCleanup', err);
	}
}
