import { describe, it, expect } from 'vitest';
import { parseFen } from '../src/core/chess/fen.js';
import { applyMove } from '../src/core/chess/make-move.js';
import { getStatus, isInsufficientMaterial } from '../src/core/chess/status.js';
import { moveFromSan } from '../src/core/chess/san.js';

function play(fen, sans) {
	const pos = parseFen(fen);
	for (const san of sans) {
		const move = moveFromSan(pos, san);
		if (!move) throw new Error(`illegal SAN ${san}`);
		applyMove(pos, move);
	}
	return pos;
}

describe('game status', () => {
	it('detects checkmate (fool\'s mate)', () => {
		const pos = play('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['f3', 'e5', 'g4', 'Qh4#']);
		const status = getStatus(pos);
		expect(status.over).toBe(true);
		expect(status.reason).toBe('checkmate');
		expect(status.result).toBe('0-1');
		expect(status.winner).toBe('b');
		expect(status.check).toBe(true);
	});

	it('detects stalemate', () => {
		const status = getStatus(parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'));
		expect(status.over).toBe(true);
		expect(status.reason).toBe('stalemate');
		expect(status.result).toBe('1/2-1/2');
		expect(status.winner).toBeNull();
		expect(status.check).toBe(false);
	});

	it('keeps playing while a legal move exists', () => {
		const status = getStatus(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
		expect(status.over).toBe(false);
		expect(status.check).toBe(false);
	});

	it('reports check without ending the game', () => {
		const status = getStatus(parseFen('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1'));
		expect(status.over).toBe(false);
		expect(status.check).toBe(true);
	});

	it('declares a draw after 50 moves without a pawn move or capture', () => {
		const status = getStatus(parseFen('4k3/8/8/8/8/8/4R3/4K3 w - - 100 80'));
		expect(status.over).toBe(true);
		expect(status.reason).toBe('fifty-move');
	});

	it('declares a draw on threefold repetition when told about it', () => {
		const pos = parseFen('4k3/8/8/8/8/8/4R3/4K3 w - - 4 40');
		expect(getStatus(pos, { repetitionCount: 2 }).over).toBe(false);
		expect(getStatus(pos, { repetitionCount: 3 }).reason).toBe('threefold');
	});

	it('treats an empty kings-only board as a dead draw', () => {
		const status = getStatus(parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
		expect(status.over).toBe(true);
		expect(status.reason).toBe('insufficient-material');
	});
});

describe('insufficient material', () => {
	const drawish = [
		'4k3/8/8/8/8/8/8/4K3 w - - 0 1',
		'4k3/8/8/8/8/8/8/2B1K3 w - - 0 1',
		'4k3/8/8/8/8/8/8/2N1K3 w - - 0 1',
		'4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1', // دو فیل هم‌رنگ
	];
	const notDrawish = [
		'4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
		'4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',
		'4k3/8/8/8/8/8/8/3QK3 w - - 0 1',
		'4kn2/8/8/8/8/8/8/2N1K3 w - - 0 1', // K+N vs K+N مات ممکن است
		'4k3/8/8/8/8/8/8/1B2KB2 w - - 0 1', // دو فیل هم‌رنگ سفید
	];

	for (const fen of drawish) {
		it(`draw: ${fen}`, () => expect(isInsufficientMaterial(parseFen(fen))).toBe(true));
	}
	for (const fen of notDrawish) {
		it(`playable: ${fen}`, () => expect(isInsufficientMaterial(parseFen(fen))).toBe(false));
	}
});
