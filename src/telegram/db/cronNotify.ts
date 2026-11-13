/**
 * خواندن/نوشتن تنظیم «اعلان‌های خودکار کرون» در `bot_settings`.
 *
 * چرا یک SELECT با `IN` و نه سه `getSetting` جدا؟ چون هر اجرای کرون این را
 * می‌خواند؛ یک رفت‌وبرگشت به D1 در هر اجرا کافی است.
 */

import {
	CRON_NOTIFY_SETTING_KEYS,
	cronNotifyItemSettingKey,
	cronNotifyStateFromRows,
	isCronNotifyEnabled as isEnabledInState,
	SETTING_CRON_NOTIFY_MASTER,
	type CronNotifyKey,
	type CronNotifyState,
	type CronNotifyTarget,
} from '../../core/settings/cronNotify.js';

/** وضعیت کامل (کلید اصلی + تک‌تک کرون‌ها) با یک کوئری */
export async function getCronNotifyState(db: D1Database): Promise<CronNotifyState> {
	const placeholders = CRON_NOTIFY_SETTING_KEYS.map(() => '?').join(', ');
	const { results } = await db
		.prepare(`SELECT key, value FROM bot_settings WHERE key IN (${placeholders})`)
		.bind(...CRON_NOTIFY_SETTING_KEYS)
		.all<{ key: string; value: string }>();

	return cronNotifyStateFromRows(results ?? []);
}

/** آیا پیام این کرون باید فرستاده شود؟ */
export async function isCronNotifyEnabled(db: D1Database, key: CronNotifyKey): Promise<boolean> {
	return isEnabledInState(await getCronNotifyState(db), key);
}

/** ذخیره‌ی یک کلید؛ بقیه دست نمی‌خورند */
export async function setCronNotifyFlag(db: D1Database, target: CronNotifyTarget, enabled: boolean): Promise<void> {
	const settingKey = target === 'master' ? SETTING_CRON_NOTIFY_MASTER : cronNotifyItemSettingKey(target);

	await db
		.prepare(
			`INSERT INTO bot_settings (key, value, updated_at)
			 VALUES (?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(key) DO UPDATE SET
			   value = excluded.value,
			   updated_at = CURRENT_TIMESTAMP`,
		)
		.bind(settingKey, enabled ? '1' : '0')
		.run();
}
