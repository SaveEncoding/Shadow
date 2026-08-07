export interface Env {
	ERROR_KV: KVNamespace;
	my_database: D1Database;
	TELEGRAM_TOKEN: string;
	TELEGRAM_WEBHOOK_SECRET: string;
	/** Telegram user id of the founder (highest privilege, env fallback). */
	FOUNDER_TELEGRAM_ID?: string;
}
