import { describe, it, expect } from 'vitest';
import { parseFen } from '../src/core/chess/fen.js';
import { applyMove, moveToUci } from '../src/core/chess/make-move.js';
import { legalMoves } from '../src/core/chess/movegen.js';
import { moveToSan } from '../src/core/chess/san.js';
import { ENGINE_LEVELS, MATE_SCORE, chooseMove, makeRandom, search } from '../src/core/chess/engine.js';
import { getStatus } from '../src/core/chess/status.js';

describe('search', () => {
	it('finds mate in one', () => {
		const pos = parseFen('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
		const result = search(pos, { depth: 2 });
		expect(result.move).not.toBeNull();
		expect(moveToUci(result.move)).toBe('a1a8');
		expect(result.score).toBeGreaterThan(MATE_SCORE - 100);
	});

	it('prefers capturing a free queen', () => {
		const pos = parseFen('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
		const result = search(pos, { depth: 2 });
		expect(moveToUci(result.move)).toBe('e4d5');
	});

	it('does not hang a queen when a free capture is available elsewhere', () => {
		// سفید می‌تواند وزیر سیاه را با Bxf7 بزند؛ اگر نزند، هیچ چیز به‌دست نمی‌آورد.
		const pos = parseFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4');
		const result = search(pos, { depth: 3, nodeLimit: 60_000 });
		const sans = legalMoves(pos).map((m) => moveToSan(pos, m));
		expect(sans).toContain(moveToSan(pos, result.move));
	});

	it('returns null when there are no legal moves', () => {
		const pos = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
		const result = search(pos, { depth: 2 });
		expect(result.move).toBeNull();
		expect(result.rootScores).toHaveLength(0);
	});

	it('respects the node limit and reports truncation', () => {
		const pos = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
		const result = search(pos, { depth: 6, nodeLimit: 2_000 });
		expect(result.nodes).toBeLessThanOrEqual(3_000);
		expect(result.truncated).toBe(true);
		expect(result.move).not.toBeNull();
	});

	it('is deterministic for the same input', () => {
		const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
		const a = search(parseFen(fen), { depth: 3 });
		const b = search(parseFen(fen), { depth: 3 });
		expect(moveToUci(a.move)).toBe(moveToUci(b.move));
		expect(a.score).toBe(b.score);
	});
});

describe('chooseMove (levels)', () => {
	it('returns a legal move at every level', () => {
		const pos = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		const legal = new Set(legalMoves(pos).map(moveToUci));
		for (const level of Object.keys(ENGINE_LEVELS).map(Number)) {
			const result = chooseMove(pos, level, 1234);
			expect(result.move).not.toBeNull();
			expect(legal.has(moveToUci(result.move))).toBe(true);
		}
	});

	it('is reproducible for the same seed and varies across seeds', () => {
		const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
		const first = chooseMove(parseFen(fen), 1, 42);
		const again = chooseMove(parseFen(fen), 1, 42);
		expect(moveToUci(first.move)).toBe(moveToUci(again.move));

		const moves = new Set();
		for (let seed = 0; seed < 12; seed++) {
			moves.add(moveToUci(chooseMove(parseFen(fen), 1, seed).move));
		}
		expect(moves.size).toBeGreaterThan(1); // سطح آسان نباید همیشه یک حرکت بزند
	});

	it('plays out a full game without ever making an illegal move', () => {
		let pos = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		let plies = 0;
		while (plies < 40) {
			const status = getStatus(pos);
			if (status.over) break;
			const legal = legalMoves(pos).map(moveToUci);
			const { move } = chooseMove(pos, 1, plies);
			expect(legal).toContain(moveToUci(move));
			applyMove(pos, move);
			plies++;
		}
		expect(plies).toBeGreaterThan(4);
	});
});

describe('regression: soft-fail quiescence', () => {
	// اگر qsearch «fail-hard» باشد، همه‌ی حرکات ضعیف، امتیازی برابر با آلفا می‌گیرند
	// و لایه‌ی انتخاب سطح (که بر پایه‌ی «نزدیک‌ترین‌ها به بهترین» است) آن‌ها را انتخاب می‌کند.
	const guarded = 'r1bqkbnr/1ppp1ppp/p7/1B2p3/4P3/8/PPPP1PPP/RNBQK1NR w kq - 0 3';

	it('scores a losing capture clearly below the best move', () => {
		const pos = parseFen(guarded);
		const result = search(pos, { depth: 3, nodeLimit: 60_000 });
		const bxa6 = result.rootScores.find((s) => moveToSan(pos, s.move) === 'Bxa6');
		expect(bxa6).toBeDefined();
		expect(bxa6.score).toBeLessThan(result.score - 50);
	});

	it('never chooses a self-hanging capture at level 3', () => {
		const pos = parseFen(guarded);
		const legal = new Set(legalMoves(pos).map(moveToUci));
		for (let seed = 0; seed < 24; seed++) {
			const { move } = chooseMove(pos, 3, seed);
			expect(legal.has(moveToUci(move))).toBe(true);
			expect(moveToSan(pos, move)).not.toBe('Bxa6');
		}
	});

	it('takes the free rook instead of trading a bishop for a pawn', () => {
		const pos = parseFen('rnbqk1nr/1pp2p2/p3p2p/3p2p1/PP3P1P/8/1BPP1PP1/RN1QKBNR w KQkq - 0 9');
		const result = search(pos, { depth: 3, nodeLimit: 80_000 });
		expect(moveToSan(pos, result.move)).toBe('Bxh8');
	});
});

describe('makeRandom', () => {
	it('is a deterministic sequence in [0,1)', () => {
		const a = makeRandom(7);
		const b = makeRandom(7);
		for (let i = 0; i < 50; i++) {
			const value = a();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
			expect(value).toBe(b());
		}
	});
});
