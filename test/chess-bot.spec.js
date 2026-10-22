import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBot, executionCtxStorage } from '../src/telegram/bot.js';
import { chessFeature } from '../src/telegram/features/chess.js';

/**
 * تست یکپارچه‌ی «بات واقعی + فیچر شطرنج».
 *
 * به‌جای شبیه‌سازی دستی `ctx`، یک `Bot` واقعی grammY می‌سازیم و لایه‌ی شبکه‌ی آن را
 * با یک transformer جایگزین می‌کنیم. یعنی همان middlewareها، همان regex های
 * callback_data و همان ترتیب ثبت‌ها اجرا می‌شوند — همان چیزی که در تولید اجرا می‌شود.
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

/** @type {Array<{ method: string, payload: any }>} */
let calls = [];

function fakeResult(method, payload) {
	switch (method) {
		case 'getMe':
			return BOT_INFO;
		case 'sendMessage':
			return { message_id: 50, date: 0, chat: payload.chat_id, text: payload.text };
		case 'editMessageText':
		case 'editMessageReplyMarkup':
			return { message_id: 50, date: 0, chat: { id: 1, type: 'private' }, text: payload.text ?? '' };
		case 'answerCallbackQuery':
			return true;
		case 'sendChatAction':
			return true;
		default:
			return true;
	}
}

async function setupBot() {
	calls = [];
	const bot = createBot({ ...env, TELEGRAM_TOKEN: '123:test', TELEGRAM_WEBHOOK_SECRET: 'secret' });
	chessFeature(bot, env);
	bot.api.config.use((prev, method, payload) => {
		calls.push({ method, payload });
		return Promise.resolve({ ok: true, result: fakeResult(method, payload) });
	});
	await bot.init();
	calls = [];
	return bot;
}

const USER = { id: 777, is_bot: false, first_name: 'Ali', language_code: 'fa' };
const CHAT = { id: 777, type: 'private', first_name: 'Ali' };

let updateId = 1;

function messageUpdate(text) {
	return {
		update_id: updateId++,
		message: {
			message_id: 10,
			date: 1_700_000_000,
			chat: CHAT,
			from: USER,
			text,
			entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
		},
	};
}

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

/**
 * اجرای آپدیت در یک ExecutionContext جعلی تا نوشتن‌های fire-and-forget
 * (ثبت کاربر) قبل از پایان تست تمام شوند؛ وگرنه vitest به‌خاطر
 * «نوشتن D1 بعد از پایان تست» خطا می‌دهد.
 */
async function dispatch(bot, update) {
	const pending = [];
	await executionCtxStorage.run(
		{ waitUntil: (promise) => pending.push(promise), passThroughOnException: () => {} },
		() => bot.handleUpdate(update),
	);
	await Promise.all(pending);
}

const lastCall = (method) => [...calls].reverse().find((c) => c.method === method);
const allTexts = () =>
	calls
		.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
		.map((c) => c.payload.text ?? '');
const callbacksOf = (payload) =>
	(payload?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

beforeAll(async () => {
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, last_name TEXT, language_code TEXT, role INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));',
	);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS user_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, action TEXT NOT NULL, created_at TEXT DEFAULT (CURRENT_TIMESTAMP));',
	);
	await env.my_database.exec(
		"CREATE TABLE IF NOT EXISTS chess_games (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'engine', level INTEGER NOT NULL DEFAULT 2, seed INTEGER NOT NULL DEFAULT 0, start_fen TEXT NOT NULL, fen TEXT NOT NULL, moves TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', result TEXT, reason TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));",
	);
});

beforeEach(async () => {
	await env.my_database.exec('DELETE FROM chess_games;');
});

describe('شطرنج از دید کاربر تلگرام', () => {
	it('/chess shows the chess home screen', async () => {
		const bot = await setupBot();
		await dispatch(bot, messageUpdate('/chess'));

		const text = lastCall('sendMessage')?.payload.text ?? '';
		expect(text).toContain('شطرنج');
		expect(text).toContain('با موتور');
		expect(callbacksOf(lastCall('sendMessage')?.payload)).toContain('cg:l:2');
	});

	it('starting a game renders a board with 64 selectable squares', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:2'));

		const payload = lastCall('editMessageText')?.payload;
		expect(payload).toBeTruthy();
		expect(payload.text).toContain('<pre>');
		expect(payload.text).toContain('نوبت <b>شما</b>');
		const rows = payload.reply_markup.inline_keyboard;
		expect(rows).toHaveLength(10);
		expect(callbacksOf(payload)).toContain('cg:s:12'); // e2
		expect(payload.parse_mode).toBe('HTML');
	});

	it('selecting a piece reveals its legal destinations', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:2'));
		await dispatch(bot, callbackUpdate('cg:s:12'));

		const payload = lastCall('editMessageText')?.payload;
		const data = callbacksOf(payload);
		expect(data).toContain('cg:m:12-20'); // e2-e3
		expect(data).toContain('cg:m:12-28'); // e2-e4
		expect(payload.text).toContain('خانه‌ی مقصد');
	});

	it('playing a move stores it and lets the engine answer', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:1'));
		await dispatch(bot, callbackUpdate('cg:s:12'));
		await dispatch(bot, callbackUpdate('cg:m:12-28'));

		const stored = await env.my_database
			.prepare("SELECT moves, fen FROM chess_games WHERE chat_id = 777 AND status = 'active'")
			.first();
		const moves = JSON.parse(stored.moves);
		expect(moves[0]).toBe('e4');
		expect(moves).toHaveLength(2); // پاسخ موتور
		// بعد از پاسخ موتور، دوباره نوبت سفید (کاربر) است
		expect(stored.fen).toContain(' w ');
		expect(stored.fen).not.toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');

		expect(lastCall('editMessageText')?.payload.text).toContain('1. e4');
	});

	it('an illegal destination is refused with a toast, not an edit', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:2'));
		await dispatch(bot, callbackUpdate('cg:s:12'));
		calls = [];
		await dispatch(bot, callbackUpdate('cg:m:12-13')); // e2-e1? نامعتبر

		const toastCall = lastCall('answerCallbackQuery');
		expect(toastCall?.payload.text).toContain('مجاز');
		expect(lastCall('editMessageText')).toBeUndefined();
	});

	it('undo takes back both the player move and the engine reply', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:1'));
		await dispatch(bot, callbackUpdate('cg:s:12'));
		await dispatch(bot, callbackUpdate('cg:m:12-28'));
		await dispatch(bot, callbackUpdate('cg:u'));

		const stored = await env.my_database
			.prepare("SELECT moves FROM chess_games WHERE chat_id = 777 AND status = 'active'")
			.first();
		expect(JSON.parse(stored.moves)).toEqual([]);
	});

	it('resignation finishes the game and offers a restart', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:1'));
		await dispatch(bot, callbackUpdate('cg:r'));

		const text = lastCall('editMessageText')?.payload.text ?? '';
		expect(text).toContain('پایان بازی');
		expect(text).toContain('استعفا');
		expect(callbacksOf(lastCall('editMessageText')?.payload)).toContain('cg:n');

		const stored = await env.my_database
			.prepare('SELECT status, result, reason FROM chess_games WHERE chat_id = 777 ORDER BY id DESC LIMIT 1')
			.first();
		expect(stored).toMatchObject({ status: 'finished', result: '0-1', reason: 'resignation' });
	});

	it('PGN is delivered after a game', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:1'));
		await dispatch(bot, callbackUpdate('cg:s:12'));
		await dispatch(bot, callbackUpdate('cg:m:12-28'));
		calls = [];
		await dispatch(bot, callbackUpdate('cg:p'));

		const sent = allTexts().join('\n');
		expect(sent).toContain('[Event "Shadow Chess"]');
		expect(sent).toContain('1. e4');
	});

	it('the local two-player mode does not let the engine move', async () => {
		const bot = await setupBot();
		await dispatch(bot, callbackUpdate('cg:l:0'));
		await dispatch(bot, callbackUpdate('cg:s:12'));
		await dispatch(bot, callbackUpdate('cg:m:12-28'));

		const stored = await env.my_database
			.prepare("SELECT moves FROM chess_games WHERE chat_id = 777 AND status = 'active'")
			.first();
		expect(JSON.parse(stored.moves)).toEqual(['e4']);
		expect(lastCall('editMessageText')?.payload.text).toContain('نوبت <b>سیاه</b>');
	});
});
