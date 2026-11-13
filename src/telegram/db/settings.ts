/**
 * Key-value bot settings stored in D1.
 * Keys used today:
 *   error_log_chat_id   – private group/supergroup that receives error reports
 *   error_log_thread_id – forum topic (message_thread_id) inside that group,
 *                         when it was set from a topic instead of "General"
 */

import type { SettingRow } from './rows.js';

export const SETTING_ERROR_LOG_CHAT_ID = 'error_log_chat_id';
export const SETTING_ERROR_LOG_THREAD_ID = 'error_log_thread_id';

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
	const row = await db.prepare('SELECT value FROM bot_settings WHERE key = ?').bind(key).first<Pick<SettingRow, 'value'>>();

	if (row == null || row.value == null) return null;
	return String(row.value);
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
	await db
		.prepare(
			`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
		)
		.bind(key, String(value))
		.run();
}

/** شناسه‌ی چت تلگرامِ لاگ خطا؛ `null` یعنی تنظیم نشده */
export async function getErrorLogChatId(db: D1Database): Promise<number | null> {
	const raw = await getSetting(db, SETTING_ERROR_LOG_CHAT_ID);
	if (raw === null || raw === undefined || raw === '') return null;
	const id = Number(raw);
	return Number.isFinite(id) ? id : null;
}

/**
 * message_thread_id؛ `null` یعنی گروه topic-split نیست یا لاگ از تاپیک
 * «General» تنظیم شده است.
 */
export async function getErrorLogThreadId(db: D1Database): Promise<number | null> {
	const raw = await getSetting(db, SETTING_ERROR_LOG_THREAD_ID);
	if (raw === null || raw === undefined || raw === '') return null;
	const id = Number(raw);
	return Number.isFinite(id) ? id : null;
}

/**
 * ترکیب getErrorLogChatId + getErrorLogThreadId — هر جا پیام لاگ فرستاده
 * می‌شود هر دو با هم لازم است، پس این تابع تکرارِ «thread id تنظیم نشده» را
 * یک‌جا جمع می‌کند.
 */
export async function getErrorLogTarget(db: D1Database): Promise<{ chatId: number | null; threadId: number | null }> {
	const [chatId, threadId] = await Promise.all([getErrorLogChatId(db), getErrorLogThreadId(db)]);
	return { chatId, threadId };
}

/**
 * @param threadId message_thread_id تاپیکی که دستور در آن اجرا شده، یا
 *   `null`/داده‌نشده برای گروه بدون تاپیک (تا هر thread id قبلی پاک شود).
 */
export async function setErrorLogChatId(db: D1Database, chatId: number | string, threadId: number | string | null = null): Promise<void> {
	await setSetting(db, SETTING_ERROR_LOG_CHAT_ID, String(chatId));
	await setSetting(db, SETTING_ERROR_LOG_THREAD_ID, threadId === null || threadId === undefined ? '' : String(threadId));
}
