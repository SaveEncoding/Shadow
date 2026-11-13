/**
 * نوع ردیف‌های D1 که چند لایه با آن‌ها کار می‌کنند.
 *
 * چرا این‌جا و نه در هر ماژول؟ چون اسکیمای `schema.sql` یک منبع حقیقت است و
 * اگر هر ماژول نسخه‌ی خودش را تعریف کند، اولین ستون تازه فقط در یکی‌شان
 * اضافه می‌شود و بقیه بی‌صدا از آن بی‌خبر می‌مانند (همین اتفاق باعث شده بود
 * `getChannelByTelegramId` فقط سه ستون را اعلام کند در حالی که `SELECT *`
 * همه را برمی‌گرداند).
 *
 * ستون‌هایی که SQLite با `DEFAULT CURRENT_TIMESTAMP` پر می‌کند `string | null`
 * هستند چون مقدار پیش‌فرض در سطح SQL است، نه در سطح TypeScript.
 */

/** ردیف جدول `channels` */
export interface ChannelRow {
	id: number;
	channel_id: number;
	title: string;
	username: string | null;
	owner_id: number | null;
	registered_by: number;
	/** آخرین همگام‌سازی ادمین‌ها؛ `null` یعنی هرگز */
	admins_synced_at: string | null;
	official_suffix: string | null;
	/** JSON آرایه‌ی MessageEntity (آفست‌ها نسبت به `official_suffix`) */
	official_suffix_entities: string | null;
	suffix_skip_marker: string | null;
	created_at: string | null;
	updated_at: string | null;
}

/** ردیف جدول `channel_admins` */
export interface ChannelAdminRow {
	channel_id: number;
	user_id: number;
	added_at: string | null;
}
