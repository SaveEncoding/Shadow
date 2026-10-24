/**
 * ساخت جدول‌های فیچر «کپی و زمان‌بندی پست» در D1 تست.
 *
 * همان دستورهای `src/telegram/db/schema.sql` هستند، فقط تک‌خطی و بدون کامنت
 * (چون `D1Database.exec` دستور چندخطی را اجرا نمی‌کند).
 */
export const SCHEDULE_SCHEMA = [
	'CREATE TABLE IF NOT EXISTS post_sources ( id INTEGER PRIMARY KEY AUTOINCREMENT, source_channel_id INTEGER NOT NULL UNIQUE, source_title TEXT, source_username TEXT, target_channel_id INTEGER NOT NULL, delay_minutes INTEGER NOT NULL DEFAULT 30, enabled INTEGER NOT NULL DEFAULT 1, notify_chat_id INTEGER, added_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL );',
	'CREATE INDEX IF NOT EXISTS idx_post_sources_target ON post_sources(target_channel_id);',
	'CREATE TABLE IF NOT EXISTS post_queue ( id INTEGER PRIMARY KEY AUTOINCREMENT, source_channel_id INTEGER NOT NULL, source_title TEXT, source_username TEXT, target_channel_id INTEGER NOT NULL, media_group_id TEXT, status TEXT NOT NULL DEFAULT \'collecting\', publish_at INTEGER NOT NULL, finalize_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER, published_message_id INTEGER, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_by INTEGER, preview_chat_id INTEGER, preview_message_id INTEGER, edited INTEGER NOT NULL DEFAULT 0 );',
	'CREATE INDEX IF NOT EXISTS idx_post_queue_ready ON post_queue(status, publish_at);',
	'CREATE INDEX IF NOT EXISTS idx_post_queue_target ON post_queue(target_channel_id, status, publish_at);',
	'CREATE INDEX IF NOT EXISTS idx_post_queue_collect ON post_queue(source_channel_id, media_group_id, status);',
	'CREATE TABLE IF NOT EXISTS post_queue_items ( queue_id INTEGER NOT NULL, source_message_id INTEGER NOT NULL, kind TEXT NOT NULL, file_id TEXT, text TEXT, entities TEXT, extra TEXT, PRIMARY KEY (queue_id, source_message_id), FOREIGN KEY (queue_id) REFERENCES post_queue(id) ON DELETE CASCADE );',
	'CREATE TABLE IF NOT EXISTS post_seen ( source_channel_id INTEGER NOT NULL, source_message_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (source_channel_id, source_message_id) );',
	'CREATE TABLE IF NOT EXISTS post_edit_sessions ( id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL UNIQUE, chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL, field TEXT NOT NULL, target_message_id INTEGER NOT NULL, expires_at INTEGER NOT NULL );',
	'CREATE TABLE IF NOT EXISTS post_capture_sessions ( user_id INTEGER PRIMARY KEY, target_channel_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT \'manual\', delay_minutes INTEGER NOT NULL DEFAULT 30, expires_at INTEGER NOT NULL );',
];

export async function createScheduleTables(db) {
	for (const statement of SCHEDULE_SCHEMA) {
		await db.exec(statement);
	}
}

/** پاک‌کردن همه‌ی جدول‌های این فیچر بین تست‌ها */
export async function resetScheduleTables(db) {
	for (const table of [
		'post_queue_items',
		'post_queue',
		'post_sources',
		'post_seen',
		'post_edit_sessions',
		'post_capture_sessions',
	]) {
		await db.exec(`DELETE FROM ${table};`);
	}
}

/** جدول کانال‌ها؛ فقط ستون‌هایی که این فیچر می‌خواند */
export const CHANNELS_TABLE =
	'CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL UNIQUE, title TEXT, username TEXT, type TEXT, official_suffix TEXT, official_suffix_entities TEXT, owner_id INTEGER, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));';

export const CHANNEL_ADMINS_TABLE =
	'CREATE TABLE IF NOT EXISTS channel_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL UNIQUE);';
