import { describe, it, expect } from 'vitest';
import {
	IllegalMoveError,
	applyUserMove,
	currentStatus,
	finishGame,
	gameToPgn,
	legalTargetsFrom,
	newGame,
	positionOf,
	replay,
	takeBack,
} from '../src/core/chess/game.js';
import { parseSquare } from '../src/core/chess/board.js';
import { toFen } from '../src/core/chess/fen.js';

const SQ = (name) => parseSquare(name);

function play(game, from, to, promo) {
	return applyUserMove(game, SQ(from), SQ(to), promo);
}

describe('game record', () => {
	it('starts from the standard position', () => {
		const game = newGame();
		expect(game.moves).toEqual([]);
		expect(game.result).toBeNull();
		expect(currentStatus(game).over).toBe(false);
	});

	it('records SAN moves and keeps the FEN in sync', () => {
		let { game } = play(newGame(), 'e2', 'e4');
		({ game } = play(game, 'e7', 'e5'));
		expect(game.moves).toEqual(['e4', 'e5']);
		expect(game.fen).toBe(toFen(positionOf(game)));
		expect(game.fen.split(' ')[1]).toBe('w');
	});

	it('rejects a move from an empty square', () => {
		const game = newGame();
		expect(() => play(game, 'e5', 'e6')).toThrow(IllegalMoveError);
		try {
			play(game, 'e5', 'e6');
		} catch (err) {
			expect(err.code).toBe('no-piece');
		}
	});

	it('rejects an illegal move with a specific code', () => {
		const game = newGame();
		try {
			play(game, 'e2', 'e5');
			throw new Error('should not reach');
		} catch (err) {
			expect(err).toBeInstanceOf(IllegalMoveError);
			expect(err.code).toBe('illegal');
		}
	});

	it('asks for a promotion piece when the move is ambiguous', () => {
		const game = newGame('5k2/3P4/8/8/8/8/8/4K3 w - - 0 1');
		try {
			play(game, 'd7', 'd8');
			throw new Error('should not reach');
		} catch (err) {
			expect(err.code).toBe('promotion-required');
		}
		const promoted = play(game, 'd7', 'd8', 5);
		expect(promoted.san).toBe('d8=Q+');
		expect(promoted.game.moves).toEqual(['d8=Q+']);
	});

	it('exposes legal targets for a selected piece', () => {
		const game = newGame();
		const targets = legalTargetsFrom(game, SQ('e2')).map((m) => m.to);
		expect(targets).toHaveLength(2);
		expect(targets).toContain(SQ('e3'));
		expect(targets).toContain(SQ('e4'));
	});

	it('marks the game finished on checkmate', () => {
		let game = newGame();
		for (const [from, to] of [
			['f2', 'f3'],
			['e7', 'e5'],
			['g2', 'g4'],
			['d8', 'h4'],
		]) {
			game = play(game, from, to).game;
		}
		const status = currentStatus(game);
		expect(status.over).toBe(true);
		expect(status.reason).toBe('checkmate');
		expect(game.result).toBe('0-1');
		expect(game.reason).toBe('checkmate');
	});

	it('refuses to move after the game is over', () => {
		let game = newGame();
		for (const [from, to] of [
			['f2', 'f3'],
			['e7', 'e5'],
			['g2', 'g4'],
			['d8', 'h4'],
		]) {
			game = play(game, from, to).game;
		}
		expect(() => play(game, 'a2', 'a3')).toThrow(IllegalMoveError);
	});

	it('detects threefold repetition through the history', () => {
		// تکرار حرکت اسب‌ها: Nf3 Nf6 Ng1 Ng8 چند بار
		let game = newGame();
		const cycle = [
			['g1', 'f3'],
			['g8', 'f6'],
			['f3', 'g1'],
			['f6', 'g8'],
		];
		for (let i = 0; i < 2; i++) for (const [from, to] of cycle) game = play(game, from, to).game;
		// اینجا وضعیت شروع برای بار سوم تکرار شده است
		const status = currentStatus(game);
		expect(status.over).toBe(true);
		expect(status.reason).toBe('threefold');
	});

	it('takeBack rewinds one or two plies and clears the result', () => {
		let game = newGame();
		game = play(game, 'e2', 'e4').game;
		game = play(game, 'e7', 'e5').game;
		game = finishGame(game, '1-0', 'resignation');

		const one = takeBack(game, 1);
		expect(one.moves).toEqual(['e4']);
		expect(one.result).toBeNull();

		const two = takeBack(game, 2);
		expect(two.moves).toEqual([]);
		expect(two.fen).toBe(game.startFen);
	});

	it('replay rebuilds the position from moves only', () => {
		const { position } = replay('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'c5', 'Nf3']);
		expect(toFen(position)).toContain(' b '); // سه نیم‌حرکت → نوبت سیاه
		expect(position.board[28]).toBe(1); // e4 pawn
	});

	it('replay throws on a corrupted history', () => {
		expect(() => replay('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'e5', 'Qa5'])).toThrow(
			IllegalMoveError,
		);
	});
});

describe('PGN export', () => {
	it('writes a complete game with result', () => {
		let game = newGame();
		for (const [from, to] of [
			['f2', 'f3'],
			['e7', 'e5'],
			['g2', 'g4'],
			['d8', 'h4'],
		]) {
			game = play(game, from, to).game;
		}
		const pgn = gameToPgn(game, { white: 'ali', black: 'Shadow', level: 2 });
		expect(pgn).toContain('[White "ali"]');
		expect(pgn).toContain('[Black "Shadow"]');
		expect(pgn).toContain('[Result "0-1"]');
		expect(pgn).toContain('1. f3 e5 2. g4 Qh4# 0-1');
		expect(pgn).toContain('{ level: 2 }');
	});

	it('uses * for an unfinished game', () => {
		const game = play(newGame(), 'e2', 'e4').game;
		expect(gameToPgn(game)).toContain('[Result "*"]');
	});
});
