import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	closeGame,
	getActiveGame,
	getChessStats,
	getGame,
	saveGame,
	startGame,
} from '../src/telegram/db/chess.js';
import { START_FEN } from '../src/core/chess/fen.js';

beforeAll(async () => {
	// D1 `exec` هر دستور را در یک خط انتظار دارد؛ پس CREATE را یک‌خطی می‌نویسیم
	// (همان اسکیمای `src/telegram/db/schema.sql`).
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS chess_games (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT \'engine\', level INTEGER NOT NULL DEFAULT 2, seed INTEGER NOT NULL DEFAULT 0, start_fen TEXT NOT NULL, fen TEXT NOT NULL, moves TEXT NOT NULL DEFAULT \'[]\', status TEXT NOT NULL DEFAULT \'active\', result TEXT, reason TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));',
	);
});

beforeEach(async () => {
	await env.my_database.exec('DELETE FROM chess_games;');
});

describe('startGame', () => {
	it('creates an active game with an empty history', async () => {
		const row = await startGame(env.my_database, { chatId: 10, userId: 1, mode: 'engine', level: 3, seed: 7 });
		expect(row.id).toBeGreaterThan(0);
		expect(row.game.moves).toEqual([]);
		expect(row.game.fen).toBe(START_FEN);

		const active = await getActiveGame(env.my_database, 10);
		expect(active.level).toBe(3);
		expect(active.seed).toBe(7);
	});

	it('abandons the previous active game in the same chat', async () => {
		const first = await startGame(env.my_database, { chatId: 10, userId: 1 });
		const second = await startGame(env.my_database, { chatId: 10, userId: 1 });
		expect(second.id).toBeGreaterThan(first.id);

		const active = await getActiveGame(env.my_database, 10);
		expect(active.id).toBe(second.id);

		const old = await getGame(env.my_database, first.id);
		const row = await env.my_database.prepare('SELECT status FROM chess_games WHERE id = ?').bind(first.id).first();
		expect(row.status).toBe('abandoned');
	});

	it('keeps games of different chats independent', async () => {
		await startGame(env.my_database, { chatId: 10, userId: 1 });
		await startGame(env.my_database, { chatId: 20, userId: 2 });
		const a = await getActiveGame(env.my_database, 10);
		const b = await getActiveGame(env.my_database, 20);
		expect(a.chatId).toBe(10);
		expect(b.chatId).toBe(20);
	});
});

describe('saveGame (optimistic concurrency)', () => {
	it('writes when the expected fen matches', async () => {
		const row = await startGame(env.my_database, { chatId: 10, userId: 1 });
		const next = { ...row.game, moves: ['e4'], fen: START_FEN.replace('w KQkq', 'b KQkq') };
		expect(await saveGame(env.my_database, row.id, next, START_FEN)).toBe(true);

		const stored = await getActiveGame(env.my_database, 10);
		expect(stored.game.moves).toEqual(['e4']);
	});

	it('refuses to overwrite a newer position', async () => {
		const row = await startGame(env.my_database, { chatId: 10, userId: 1 });
		const next = { ...row.game, moves: ['e4'], fen: 'stale-check' };
		expect(await saveGame(env.my_database, row.id, next, 'a fen that is not current')).toBe(false);

		const stored = await getActiveGame(env.my_database, 10);
		expect(stored.game.moves).toEqual([]);
	});

	it('serializes moves as JSON and survives a malformed row', async () => {
		const row = await startGame(env.my_database, { chatId: 10, userId: 1 });
		await env.my_database.prepare("UPDATE chess_games SET moves = 'not-json' WHERE id = ?").bind(row.id).run();
		const stored = await getActiveGame(env.my_database, 10);
		expect(stored.game.moves).toEqual([]);
	});
});

describe('closeGame', () => {
	it('marks the game finished and removes it from the active slot', async () => {
		const row = await startGame(env.my_database, { chatId: 10, userId: 1 });
		await closeGame(env.my_database, row.id, { ...row.game, result: '1-0', reason: 'checkmate' });
		expect(await getActiveGame(env.my_database, 10)).toBeNull();
	});
});

describe('getChessStats', () => {
	it('counts results of engine games per user', async () => {
		const db = env.my_database;
		const results = ['1-0', '0-1', '1/2-1/2', '1-0'];
		for (const [index, result] of results.entries()) {
			const row = await startGame(db, { chatId: 100 + index, userId: 42 });
			await closeGame(db, row.id, { ...row.game, result, reason: 'checkmate' });
		}
		// یک بازی محلی (دو نفره) نباید در آمار حساب شود
		const localRow = await startGame(db, { chatId: 200, userId: 42, mode: 'local', level: 0 });
		await closeGame(db, localRow.id, { ...localRow.game, result: '1-0', reason: 'checkmate' });

		const stats = await getChessStats(db, 42);
		expect(stats).toEqual({ played: 4, wins: 2, losses: 1, draws: 1 });
	});

	it('returns zeros for a new user', async () => {
		const stats = await getChessStats(env.my_database, 999);
		expect(stats).toEqual({ played: 0, wins: 0, losses: 0, draws: 0 });
	});
});
