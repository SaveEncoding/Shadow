export interface Env {
	ERROR_KV: KVNamespace;
	my_database: D1Database;
	ASSETS: Fetcher;
	TELEGRAM_TOKEN: string;
}