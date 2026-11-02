export interface Env {
	ERROR_KV: KVNamespace;
	my_database: D1Database;
	TELEGRAM_TOKEN: string;
	TELEGRAM_WEBHOOK_SECRET: string;
	/** Telegram user id of the founder (highest privilege, env fallback). */
	FOUNDER_TELEGRAM_ID?: string;
	/**
	 * X (توییتر) — یکی از این دو برای فعال‌شدن منابع X لازم است:
	 * توکن رسمی API (پرداخت به‌ازای مصرف) یا آدرس یک پل RSS با {username}.
	 */
	X_BEARER_TOKEN?: string;
	X_RSS_TEMPLATE?: string;
	/** «1» = منابع X روشن؛ پیش‌فرض خاموش (تعلیق) */
	X_SOURCES_ENABLED?: string;
}
