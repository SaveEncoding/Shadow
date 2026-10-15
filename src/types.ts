export interface Env {
	ERROR_KV: KVNamespace;
	my_database: D1Database;
	/** Optional R2 bucket for media uploads (video/subtitle/result). */
	MEDIA_BUCKET?: R2Bucket;
	TELEGRAM_TOKEN: string;
	TELEGRAM_WEBHOOK_SECRET: string;
	/** Telegram user id of the founder (highest privilege, env fallback). */
	FOUNDER_TELEGRAM_ID?: string;
	/** Optional URL of an external muxer service to notify when a job is queued. */
	MEDIA_MUXER_URL?: string;
	/** Optional shared secret for media API endpoints. */
	MEDIA_API_SECRET?: string;
}
