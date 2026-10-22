import { describe, it, expect } from 'vitest';
import { parseFen, toFen } from '../src/core/chess/fen.js';
import { perft, perftDivide } from '../src/core/chess/perft.js';

/**
 * مراجع استاندارد perft (chessprogramming.org/Perft_Results).
 * اگر این اعداد درست باشند، تولید حرکت (شامل قلعه‌روی، en-passant، ترفیع و
 * همه‌ی حالت‌های کیش) درست است — این تنها تستی است که چنین پوششی دارد.
 */
const CASES = [
	{
		name: 'startpos',
		fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		expected: [20, 400, 8902, 197281],
	},
	{
		name: 'kiwipete',
		fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
		expected: [48, 2039, 97862],
	},
	{
		name: 'position3 (en-passant, pins, promotions)',
		fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
		expected: [14, 191, 2812, 43238],
	},
	{
		name: 'position4 (castling, promotions)',
		fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
		expected: [6, 264, 9467, 422333],
	},
	{
		name: 'position5',
		fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
		expected: [44, 1486, 62379],
	},
	{
		name: 'position6',
		fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
		expected: [46, 2079, 89890],
	},
];

describe('perft: legal move generation', () => {
	for (const testCase of CASES) {
		for (let depth = 1; depth <= testCase.expected.length; depth++) {
			it(`${testCase.name} depth ${depth}`, () => {
				const pos = parseFen(testCase.fen);
				expect(perft(pos, depth)).toBe(testCase.expected[depth - 1]);
			});
		}
	}

	it('leaves the position untouched', () => {
		const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
		const pos = parseFen(fen);
		perft(pos, 3);
		// پس از صد‌ها هزار apply/undo، وضعیت باید بیت‌به‌بیت همان اول باشد
		expect(toFen(pos)).toBe(fen);
	});
});

describe('perftDivide', () => {
	it('divide sums to total', () => {
		const pos = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
		const total = perft(pos, 3);
		const divide = perftDivide(pos, 3);
		const sum = Object.values(divide).reduce((a, b) => a + b, 0);
		expect(sum).toBe(total);
		expect(Object.keys(divide)).toHaveLength(48);
	});
});
