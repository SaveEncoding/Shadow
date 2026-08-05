/**
 * Key-value bot settings stored in D1.
 * Keys used today:
 *   error_log_chat_id  – private group/supergroup that receives error reports
 */

export const SETTING_ERROR_LOG_CHAT_ID = "error_log_chat_id";

/**
 * @param {D1Database} db
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getSetting(db, key) {
  /** @type {{ value: string } | null} */
  const row = await db
    .prepare("SELECT value FROM bot_settings WHERE key = ?")
    .bind(key)
    .first();
    
  if (row == null || row.value == null) return null;
  return String(row.value);
}

/**
 * @param {D1Database} db
 * @param {string} key
 * @param {string} value
 */
export async function setSetting(db, key, value) {
  await db
    .prepare(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(key, String(value))
    .run();
}

/**
 * @param {D1Database} db
 * @returns {Promise<number|null>} Telegram chat id, or null if not configured
 */
export async function getErrorLogChatId(db) {
  const raw = await getSetting(db, SETTING_ERROR_LOG_CHAT_ID);
  if (raw === null || raw === undefined || raw === "") return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

/**
 * @param {D1Database} db
 * @param {number|string} chatId
 */
export async function setErrorLogChatId(db, chatId) {
  await setSetting(db, SETTING_ERROR_LOG_CHAT_ID, String(chatId));
}
