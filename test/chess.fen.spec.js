import { describe, it, expect } from 'vitest';
import { FenError, START_FEN, parseFen, positionKey, startPosition, toFen } from '../src/core/chess/fen.js';
import { findKing, isInCheck, parseSquare, squareName } from '../src/core/chess/board.js';

// موقعیت‌های مرجع برای تست رفت‌وبرگشت FEN
const ROUND_TRIP = [
	START_FEN,
	'8/8/8/8/8/8/8/8 w - - 0 1',
	'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
	'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
	'4k3/8/8/8/8/8/8/4K3 b - - 42 77',
	'8/P7/8/8/8/8/7p/4K2k w - - 0 1',
];

describe('FEN parsing', () => {
	it('parses the start position exactly', () => {
		const pos = parseFen(START_FEN);
		expect(pos.turn).toBe('w');
		expect(pos.castling).toBe(15);
		expect(pos.ep).toBe(-1);
		expect(pos.halfmove).toBe(0);
		expect(pos.fullmove).toBe(1);
		expect(pos.board[0]).toBe(4); // a1 = white rook
		expect(pos.board[63]).toBe(-4); // h8 = black rook
	});
});

describe('FEN round trip', () => {
	for (const fen of ROUND_TRIP) {
		it(`round-trips ${fen}`, () => {
			expect(toFen(parseFen(fen))).toBe(fen);
		});
	}

	it('round-trips a position reached by out-of-order input', () => {
		// همان FEN با ترتیب متفاوت قلعه‌روی نباید خراب شود
		const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w qk - 0 1');
		expect(pos.castling).toBe(12); // فقط قلعه‌روی سیاه
		expect(toFen(pos)).toContain(' kq ');
	});

	it('parses en-passant target square', () => {
		const pos = parseFen('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
		expect(squareName(pos.ep)).toBe('d6');
	});
});

describe('FEN validation', () => {
	const bad = [
		'',
		'8/8/8/8/8/8/8 w - - 0 1',
		'8/8/8/8/8/8/8/9 w - - 0 1',
		'8/8/8/8/8/8/8/7X w - - 0 1',
		'8/8/8/8/8/8/8/8 x - - 0 1',
		'8/8/8/8/8/8/8/8 w Z - 0 1',
		'8/8/8/8/8/8/8/8 w - e5 0 1',
		'8/8/8/8/8/8/8/8 w - - -1 1',
		'8/8/8/8/8/8/8/8 w - - 0 0',
	];

	for (const fen of bad) {
		it(`rejects ${JSON.stringify(fen)}`, () => {
			expect(() => parseFen(fen)).toThrow(FenError);
		});
	}
});

describe('position helpers', () => {
	it('finds both kings', () => {
		const pos = startPosition();
		expect(squareName(findKing(pos.board, 'w'))).toBe('e1');
		expect(squareName(findKing(pos.board, 'b'))).toBe('e8');
	});

	it('detects check', () => {
		const pos = parseFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
		expect(isInCheck(pos.board, 'w')).toBe(true);
		expect(isInCheck(pos.board, 'b')).toBe(false);
	});

	it('positionKey ignores clocks but keeps side, castling and ep', () => {
		const a = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		const b = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 9 40');
		const c = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
		expect(positionKey(a)).toBe(positionKey(b));
		expect(positionKey(a)).not.toBe(positionKey(c));
	});

	it('maps square names both ways', () => {
		expect(parseSquare('a1')).toBe(0);
		expect(parseSquare('h8')).toBe(63);
		expect(parseSquare('e4')).toBe(28);
		expect(squareName(28)).toBe('e4');
		expect(parseSquare('z9')).toBeNull();
		expect(parseSquare('a')).toBeNull();
	});
});
