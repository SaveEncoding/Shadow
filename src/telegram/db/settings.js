/**
 * Key-value bot settings stored in D1.
 * Keys used today:
 *   error_log_chat_id   – private group/supergroup that receives error reports
 *   error_log_thread_id – forum topic (message_thread_id) inside that group,
 *                         when it was set from a topic instead of "General"
 */

export const SETTING_ERROR_LOG_CHAT_ID = "error_log_chat_id";
export const SETTING_ERROR_LOG_THREAD_ID = "error_log_thread_id";

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
 * @returns {Promise<number|null>} message_thread_id, or null if the group
 *   isn't topic-split or the log was set from the "General" topic.
 */
export async function getErrorLogThreadId(db) {
  const raw = await getSetting(db, SETTING_ERROR_LOG_THREAD_ID);
  if (raw === null || raw === undefined || raw === "") return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

/**
 * Convenience combo of getErrorLogChatId + getErrorLogThreadId — every
 * call site that sends a log message needs both together, so this saves
 * duplicating the "unset thread id" handling everywhere.
 * @param {D1Database} db
 * @returns {Promise<{ chatId: number|null, threadId: number|null }>}
 */
export async function getErrorLogTarget(db) {
  const [chatId, threadId] = await Promise.all([
    getErrorLogChatId(db),
    getErrorLogThreadId(db),
  ]);
  return { chatId, threadId };
}

/**
 * @param {D1Database} db
 * @param {number|string} chatId
 * @param {number|string|null} [threadId] - message_thread_id of the topic
 *   the command was run in, or null/omitted for a non-topic group so any
 *   previously-stored thread id is cleared.
 */
export async function setErrorLogChatId(db, chatId, threadId = null) {
  await setSetting(db, SETTING_ERROR_LOG_CHAT_ID, String(chatId));
  await setSetting(
    db,
    SETTING_ERROR_LOG_THREAD_ID,
    threadId === null || threadId === undefined ? "" : String(threadId)
  );
}
