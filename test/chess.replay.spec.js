import { describe, it, expect } from 'vitest';
import {
	IllegalMoveError,
	START_FEN,
	applyMove,
	applyUserMove,
	currentStatus,
	gameState,
	legalMoves,
	moveToSan,
	newGame,
	positionOf,
	replay,
	toFen,
} from '../src/core/chess/index.js';
import { parseSquare } from '../src/core/chess/board.js';
import { moveToSanCore } from '../src/core/chess/san.js';

const SQ = (name) => parseSquare(name);

/** یک بازی اسکریپت‌شده (نه تصادفی) تا تست‌ها قطعی بمانند */
const SCRIPT = [
	['e2', 'e4'],
	['e7', 'e5'],
	['g1', 'f3'],
	['b8', 'c6'],
	['f1', 'b5'],
	['a7', 'a6'],
	['b5', 'a4'],
	['g8', 'f6'],
	['e1', 'g1'],
	['f8', 'e7'],
	['f1', 'e1'],
	['b7', 'b5'],
];

function scriptedGame() {
	let game = newGame();
	for (const [from, to] of SCRIPT) game = applyUserMove(game, SQ(from), SQ(to)).game;
	return game;
}

describe('replay fast path', () => {
	it('rebuilds exactly the position reached by playing the moves', () => {
		const game = scriptedGame();
		const replayed = replay(game.startFen, game.moves);
		expect(toFen(replayed.position)).toBe(game.fen);
		expect(toFen(replayed.position)).toBe(toFen(positionOf(game)));
	});

	it('still rejects SAN that is not a legal move', () => {
		expect(() => replay(START_FEN, ['e4', 'e5', 'Qxf7'])).toThrow(IllegalMoveError);
		expect(() => replay(START_FEN, ['e4', 'e5', 'not-a-move'])).toThrow(IllegalMoveError);
	});

	it('still rejects a wrong check/mate suffix', () => {
		// Nf3 کیش نیست: تطبیق جزئی نباید آن را بپذیرد.
		expect(() => replay(START_FEN, ['Nf3+'])).toThrow(IllegalMoveError);
		expect(() => replay(START_FEN, ['e4#'])).toThrow(IllegalMoveError);
		// و حرکتِ درست با پسوند درست پذیرفته می‌شود.
		expect(() => replay(START_FEN, ['Nf3'])).not.toThrow();
		expect(() => replay('rnbqkbnr/ppppp2p/5p2/6p1/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', ['Qh5#'])).not.toThrow();
	});

	it('find the same move whether or not the SAN has a check suffix', () => {
		const game = scriptedGame();
		const positions = [replay(START_FEN, []).position, replay(game.startFen, game.moves).position];
		for (const position of positions) {
			for (const move of legalMoves(position)) {
				const full = moveToSan(position, move);
				const core = moveToSanCore(position, move);
				expect(full.startsWith(core)).toBe(true);
				expect(['', '+', '#']).toContain(full.slice(core.length));
			}
		}
	});

	it('gives the same SAN whether or not the caller passes the legal list', () => {
		const position = positionOf(scriptedGame());
		const legal = legalMoves(position);
		for (const move of legal) {
			expect(moveToSan(position, move, legal)).toBe(moveToSan(position, move));
		}
	});
});

describe('gameState', () => {
	it('matches positionOf + currentStatus at every point of the game', () => {
		let game = newGame();
		expect(gameState(game)).toEqual({ position: positionOf(game), status: currentStatus(game) });

		// هر نیم‌حرکت با هم مقایسه شود تا هم‌ارزی به یک وضعیت خاص محدود نماند.
		const fen = game.startFen;
		const moves = [];
		for (const [from, to] of SCRIPT) {
			const outcome = applyUserMove(game, SQ(from), SQ(to));
			game = outcome.game;
			moves.push(outcome.san);
			const state = gameState({ ...game, moves });
			expect(state.position).toEqual(positionOf({ ...game, moves }));
			expect(state.status).toEqual(currentStatus({ ...game, moves }));
			expect(state.status).toEqual(outcome.status);
			expect(toFen(state.position)).toBe(game.fen);
		}
		expect(game.startFen).toBe(fen);
	});

	it('keeps an explicit result even when the board is still playable', () => {
		const resigned = { ...scriptedGame(), result: '0-1', reason: 'resignation' };
		const { status } = gameState(resigned);
		expect(status).toMatchObject({ over: true, result: '0-1', reason: 'resignation', winner: 'b', check: false });
	});
});

describe('repetition counting stays exact', () => {
	it('reports the same status as a full replay after every move', () => {
		// چرخه‌ی اسب‌ها وضعیت شروع را تکرار می‌کند؛ شمارش افزایشی باید مثل
		// بازپخشِ کامل، تکرار سوم را تشخیص بدهد.
		let game = newGame();
		const cycle = [
			['g1', 'f3'],
			['g8', 'f6'],
			['f3', 'g1'],
			['f6', 'g8'],
		];
		for (let round = 0; round < 2; round++) {
			for (const [from, to] of cycle) {
				const outcome = applyUserMove(game, SQ(from), SQ(to));
				game = outcome.game;
				expect(outcome.status).toEqual(currentStatus(game));
			}
		}
		expect(currentStatus(game)).toMatchObject({ over: true, reason: 'threefold' });
	});

	it('does not count a position that was only reached once as a repetition', () => {
		// بعد از حرکت، وضعیت تازه یک‌بار شمرده می‌شود، نه دو بار.
		const game = applyUserMove(newGame(), SQ('e2'), SQ('e4')).game;
		expect(currentStatus(game).over).toBe(false);
		const position = positionOf(game);
		const applied = { ...position };
		applyMove(applied, legalMoves(position)[0]);
		expect(toFen(applied)).not.toBe(game.fen);
	});
});
