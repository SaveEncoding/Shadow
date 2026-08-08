import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
	setErrorLogChatId,
	getErrorLogChatId,
	getErrorLogThreadId,
	getErrorLogTarget,
} from '../src/telegram/db/settings.js';

beforeAll(async () => {
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));'
	);
});

describe('error log chat + thread settings', () => {
	it('stores chat id with no thread id for a non-topic group', async () => {
		await setErrorLogChatId(env.my_database, -100111);

		expect(await getErrorLogChatId(env.my_database)).toBe(-100111);
		expect(await getErrorLogThreadId(env.my_database)).toBeNull();
		expect(await getErrorLogTarget(env.my_database)).toEqual({
			chatId: -100111,
			threadId: null,
		});
	});

	it('stores chat id together with the topic it was set from', async () => {
		await setErrorLogChatId(env.my_database, -100222, 45);

		expect(await getErrorLogTarget(env.my_database)).toEqual({
			chatId: -100222,
			threadId: 45,
		});
	});

	it('clears a previously stored thread id when re-set without one', async () => {
		await setErrorLogChatId(env.my_database, -100333, 7);
		expect(await getErrorLogThreadId(env.my_database)).toBe(7);

		await setErrorLogChatId(env.my_database, -100333);
		expect(await getErrorLogThreadId(env.my_database)).toBeNull();
	});
});
