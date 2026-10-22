import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	chessContext,
	commitMove,
	createGame,
	illegalMoveMessage,
	isPlayableChatType,
	playEngineTurn,
	screenFor,
} from '../src/telegram/features/chess.js';
import { getActiveGame } from '../src/telegram/db/chess.js';
import { parseSquare } from '../src/core/chess/board.js';
import { newGame } from '../src/core/chess/game.js';

beforeAll(async () => {
	await env.my_database.exec(
		"CREATE TABLE IF NOT EXISTS chess_games (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'engine', level INTEGER NOT NULL DEFAULT 2, seed INTEGER NOT NULL DEFAULT 0, start_fen TEXT NOT NULL, fen TEXT NOT NULL, moves TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', result TEXT, reason TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));",
	);
});

beforeEach(async () => {
	await env.my_database.exec('DELETE FROM chess_games;');
});

const db = env.my_database;

describe('chessContext', () => {
	it('prefers the callback message chat over the user id', () => {
		const ctx = {
			chat: { id: -1001, type: 'supergroup' },
			from: { id: 42, first_name: 'Ali' },
			callbackQuery: { message: { chat: { id: -1001 } } },
		};
		expect(chessContext(ctx)).toMatchObject({ chatId: -1001, userId: 42, chatType: 'supergroup', userName: 'Ali' });
	});

	it('falls back to the user id in private chats without a chat object', () => {
		const ctx = { from: { id: 7, username: 'bob' } };
		expect(chessContext(ctx)).toMatchObject({ chatId: 7, userId: 7, userName: 'bob' });
	});

	it('survives an empty context', () => {
		expect(chessContext({})).toMatchObject({ chatId: null, userId: null });
	});
});

describe('isPlayableChatType', () => {
	it('allows private, group and supergroup only', () => {
		expect(isPlayableChatType('private')).toBe(true);
		expect(isPlayableChatType('group')).toBe(true);
		expect(isPlayableChatType('supergroup')).toBe(true);
		expect(isPlayableChatType('channel')).toBe(false);
		expect(isPlayableChatType(undefined)).toBe(false);
	});
});

describe('createGame', () => {
	it('creates an engine game with the requested level', async () => {
		const row = await createGame(db, { chatId: 500, userId: 5, level: 3 });
		expect(row.mode).toBe('engine');
		expect(row.level).toBe(3);
		expect(row.seed).toBeGreaterThanOrEqual(0);
	});

	it('treats level 0 as a local two-player game', async () => {
		const row = await createGame(db, { chatId: 501, userId: 5, level: 0 });
		expect(row.mode).toBe('local');
		expect(row.level).toBe(0);
	});
});

describe('playEngineTurn', () => {
	it('answers when it is the engine side to move', () => {
		const row = { mode: 'engine', level: 2, seed: 11, game: newGame() };
		const afterUser = {
			...row,
			game: { ...row.game, moves: ['e4'], fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1' },
		};
		const result = playEngineTurn(afterUser);
		expect(result.game.moves).toHaveLength(2);
		expect(result.game.fen).not.toBe(afterUser.game.fen);
	});

	it('is deterministic for the same position and seed', () => {
		const base = {
			mode: 'engine',
			level: 3,
			seed: 99,
			game: { startFen: newGame().startFen, moves: ['e4'], fen: '', result: null, reason: null },
		};
		const a = playEngineTurn({ ...base });
		const b = playEngineTurn({ ...base });
		expect(a.game.moves.at(-1)).toBe(b.game.moves.at(-1));
	});

	it('does nothing in local mode', () => {
		const row = {
			mode: 'local',
			level: 0,
			seed: 0,
			game: { startFen: newGame().startFen, moves: ['e4'], fen: '', result: null, reason: null },
		};
		expect(playEngineTurn(row)).toBe(row);
	});

	it('does nothing when it is the human side to move', () => {
		const row = { mode: 'engine', level: 2, seed: 0, game: newGame() };
		expect(playEngineTurn(row).game.moves).toEqual([]);
	});
});

describe('commitMove', () => {
	it('stores the user move together with the engine reply', async () => {
		const row = await createGame(db, { chatId: 600, userId: 6, level: 2 });
		const result = await commitMove(db, row, parseSquare('e2'), parseSquare('e4'));

		expect(result.ok).toBe(true);
		expect(result.san).toBe('e4');
		expect(result.row.game.moves).toHaveLength(2);

		const stored = await getActiveGame(db, 600);
		expect(stored.game.moves).toEqual(result.row.game.moves);
		expect(stored.game.fen).toBe(result.row.game.fen);
	});

	it('rejects an illegal move without touching the database', async () => {
		const row = await createGame(db, { chatId: 601, userId: 6, level: 2 });
		const result = await commitMove(db, row, parseSquare('e2'), parseSquare('e5'));

		expect(result.ok).toBe(false);
		expect(result.code).toBe('illegal');
		const stored = await getActiveGame(db, 601);
		expect(stored.game.moves).toEqual([]);
	});

	it('rejects a stale row (two taps racing)', async () => {
		const row = await createGame(db, { chatId: 602, userId: 6, level: 2 });
		await commitMove(db, row, parseSquare('e2'), parseSquare('e4'));

		// همان ردیف قدیمی دوباره استفاده می‌شود
		const again = await commitMove(db, row, parseSquare('d2'), parseSquare('d4'));
		expect(again.ok).toBe(false);
		expect(again.code).toBe('stale');
	});

	it('finishes the game on checkmate and does not let the engine reply', async () => {
		const { startGame } = await import('../src/telegram/db/chess.js');
		const row = await startGame(db, {
			chatId: 603,
			userId: 6,
			mode: 'engine',
			level: 2,
			startFen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
		});

		const result = await commitMove(db, row, parseSquare('a1'), parseSquare('a8'));
		expect(result.ok).toBe(true);
		expect(result.san).toBe('Ra8#');
		expect(result.row.game.moves).toEqual(['Ra8#']);
		expect(result.row.game.result).toBe('1-0');
		expect(result.row.game.reason).toBe('checkmate');
		expect(await getActiveGame(db, 603)).toBeNull();
	});
});

describe('screenFor', () => {
	it('returns a board keyboard while the game is running', () => {
		const row = { mode: 'engine', level: 2, seed: 0, game: newGame() };
		const screen = screenFor(row);
		expect(screen.keyboard.inline_keyboard).toHaveLength(10);
		expect(screen.status.over).toBe(false);
	});

	it('returns a restart keyboard once the game is over', () => {
		const row = {
			mode: 'local',
			level: 0,
			seed: 0,
			game: { ...newGame(), result: '1/2-1/2', reason: 'stalemate' },
		};
		const screen = screenFor(row);
		const data = screen.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
		expect(data).toContain('cg:n');
		expect(data).toContain('cg:p');
		expect(screen.text).toContain('مساوی');
	});
});

describe('illegalMoveMessage', () => {
	it('explains every known error code in Persian', () => {
		expect(illegalMoveMessage('no-piece')).toContain('مهره‌ای');
		expect(illegalMoveMessage('promotion-required')).toContain('ترفیع');
		expect(illegalMoveMessage('game-over')).toContain('تمام');
		expect(illegalMoveMessage('stale')).toContain('به‌روز');
		expect(illegalMoveMessage('unknown')).toContain('مجاز نیست');
	});
});
