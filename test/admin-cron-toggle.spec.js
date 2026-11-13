import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBot, executionCtxStorage } from '../src/telegram/bot.js';
import { adminPanelFeature } from '../src/telegram/features/adminPanel.js';
import { getCronNotifyState } from '../src/telegram/db/cronNotify.js';

/**
 * تست یکپارچه‌ی دکمه‌ی «اعلان‌های خودکار» در پنل مدیریت.
 *
 * با یک `Bot` واقعی grammY و شبکه‌ی قلابی اجرا می‌شود تا هم regex مربوط به
 * callback_data و هم ذخیره‌ی واقعی در D1 بررسی شود؛ تستِ فقط-UI این‌ها را
 * نمی‌گیرد.
 */

const BOT_INFO = {
	id: 999,
	is_bot: true,
	first_name: 'Shadow',
	username: 'shadow_test_bot',
	can_join_groups: true,
	can_read_all_group_messages: false,
	supports_inline_queries: false,
};

const USER = { id: 777, is_bot: false, first_name: 'Ali', language_code: 'fa' };
const CHAT = { id: 777, type: 'private', first_name: 'Ali' };

let calls = [];

const USERS_TABLE =
	'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, last_name TEXT, language_code TEXT, role INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));';
const USER_LOGS_TABLE =
	'CREATE TABLE IF NOT EXISTS user_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP));';

function fakeResult(method, payload) {
	switch (method) {
		case 'getMe':
			return BOT_INFO;
		case 'editMessageText':
			return { message_id: 50, date: 0, chat: { id: CHAT.id, type: 'private' }, text: payload.text ?? '' };
		case 'sendMessage':
			return { message_id: 51, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text };
		case 'answerCallbackQuery':
			return true;
		default:
			return true;
	}
}

async function setupBot() {
	calls = [];
	const bot = createBot({ ...env, TELEGRAM_TOKEN: '123:test', TELEGRAM_WEBHOOK_SECRET: 'secret' });
	// نقش از env خوانده می‌شود، پس بدون ردیف در `users` هم FOUNDER است.
	adminPanelFeature(bot, { ...env, FOUNDER_TELEGRAM_ID: String(USER.id) });
	bot.api.config.use((prev, method, payload) => {
		calls.push({ method, payload });
		return Promise.resolve({ ok: true, result: fakeResult(method, payload) });
	});
	await bot.init();
	calls = [];
	return bot;
}

let updateId = 1;

function callbackUpdate(data) {
	return {
		update_id: updateId++,
		callback_query: {
			id: String(updateId),
			from: USER,
			chat_instance: 'ci',
			data,
			message: { message_id: 50, date: 1_700_000_000, chat: CHAT, text: 'previous' },
		},
	};
}

async function dispatch(bot, update) {
	const pending = [];
	await executionCtxStorage.run({ waitUntil: (promise) => pending.push(promise), passThroughOnException: () => {} }, () =>
		bot.handleUpdate(update),
	);
	await Promise.all(pending);
}

const lastScreen = () => calls.filter((c) => c.method === 'editMessageText' || c.method === 'sendMessage').at(-1)?.payload;
const lastScreenText = () => lastScreen()?.text ?? '';
const lastButtons = () => (lastScreen()?.reply_markup?.inline_keyboard ?? []).flat();
const lastCallbacks = () => lastButtons().map((b) => b.callback_data);
const buttonText = (callbackData) => lastButtons().find((b) => b.callback_data === callbackData)?.text ?? '';

beforeAll(async () => {
	await env.my_database.exec(USERS_TABLE);
	await env.my_database.exec(USER_LOGS_TABLE);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));',
	);
});

beforeEach(async () => {
	await env.my_database.exec('DELETE FROM bot_settings;');
});

describe('admin cron notification toggle', () => {
	it('opens the screen from the admin panel button', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('admin:cron'));

		expect(lastScreenText()).toContain('اعلان‌های خودکار');
		expect(lastScreenText()).toContain('فقط');
		expect(lastCallbacks()).toEqual(expect.arrayContaining(['admin:cron:t:master', 'admin:cron:t:cleanup', 'admin:cron:t:admin_sync']));
	});

	it('turns the master switch off and back on, persisting to D1', async () => {
		const bot = await setupBot();

		await dispatch(bot, callbackUpdate('admin:cron:t:master'));
		expect((await getCronNotifyState(env.my_database)).master).toBe(false);
		expect(lastScreenText()).toContain('حالت کلی: <b>⛔ خاموش</b>');
		expect(buttonText('admin:cron:t:master')).toContain('⛔');

		await dispatch(bot, callbackUpdate('admin:cron:t:master'));
		expect((await getCronNotifyState(env.my_database)).master).toBe(true);
		expect(lastScreenText()).toContain('حالت کلی: <b>✅ روشن</b>');
		expect(buttonText('admin:cron:t:master')).toContain('✅');
	});

	it('turns a single cron off without touching the other one', async () => {
		const bot = await setupBot();

		await dispatch(bot, callbackUpdate('admin:cron:t:cleanup'));
		const state = await getCronNotifyState(env.my_database);
		expect(state.master).toBe(true);
		expect(state.items.cleanup).toBe(false);
		expect(state.items.admin_sync).toBe(true);

		expect(buttonText('admin:cron:t:cleanup')).toContain('⛔');
		expect(buttonText('admin:cron:t:admin_sync')).toContain('✅');
	});

	it('ignores an unknown toggle target instead of writing it', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('admin:cron:t:daily_prune'));

		// هیچ کلیدی نوشته نمی‌شود و ربات هم کرش نمی‌کند
		expect(await getCronNotifyState(env.my_database)).toEqual({
			master: true,
			items: { cleanup: true, admin_sync: true },
		});
	});
});
