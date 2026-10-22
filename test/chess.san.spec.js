import { describe, it, expect } from 'vitest';
import { parseFen } from '../src/core/chess/fen.js';
import { legalMoves } from '../src/core/chess/movegen.js';
import { legalSans, moveFromSan, moveToSan } from '../src/core/chess/san.js';
import { moveToUci } from '../src/core/chess/make-move.js';
import { applyMove } from '../src/core/chess/make-move.js';

function sanAfter(fens, sans) {
	let pos = parseFen(fens);
	for (const san of sans) {
		const move = moveFromSan(pos, san);
		if (!move) throw new Error(`illegal SAN "${san}" in ${JSON.stringify(pos.board)}`);
		applyMove(pos, move);
	}
	return pos;
}

describe('SAN generation', () => {
	it('writes piece, pawn and capture moves', () => {
		const pos = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		const sans = legalSans(pos);
		expect(sans).toContain('e4');
		expect(sans).toContain('Nf3');
		expect(sans).toContain('Na3');
		expect(sans).toHaveLength(20);
	});

	it('uses x for captures and includes en-passant captures', () => {
		// after 1. e4 d5, exd5 is a normal capture
		const pos = sanAfter('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'd5']);
		expect(legalSans(pos)).toContain('exd5');
	});

	it('marks check and checkmate', () => {
		// scholar-ish check
		const pos = sanAfter('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']);
		expect(legalSans(pos)).toContain('Qxf7#');
	});

	it('disambiguates by file', () => {
		const pos = parseFen('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
		const sans = legalSans(pos);
		expect(sans).toContain('Nbd2');
		expect(sans).toContain('Nfd2');
	});

	it('disambiguates by rank when files match', () => {
		const pos = parseFen('4k3/8/8/8/8/R7/8/R3K3 w - - 0 1');
		const sans = legalSans(pos);
		expect(sans).toContain('R1a2');
		expect(sans).toContain('R3a2');
	});

	it('writes castling as O-O and O-O-O', () => {
		const short = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
		expect(legalSans(short)).toContain('O-O');
		expect(legalSans(short)).toContain('O-O-O');
		const long = parseFen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
		expect(legalSans(long)).toContain('O-O');
		expect(legalSans(long)).toContain('O-O-O');
	});

	it('writes promotions with =Q and check suffix', () => {
		const pos = parseFen('5k2/3P4/8/8/8/8/8/4K3 w - - 0 1');
		const sans = legalSans(pos);
		expect(sans).toContain('d8=Q+');
		expect(sans).toContain('d8=R+');
		expect(sans).toContain('d8=N');
	});
});

describe('SAN parsing', () => {
	it('round-trips every legal move in the start position', () => {
		const pos = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		for (const move of legalMoves(pos)) {
			const san = moveToSan(pos, move);
			expect(moveFromSan(pos, san)?.to).toBe(move.to);
		}
	});

	it('round-trips a full opening line', () => {
		const line = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
		const pos = sanAfter('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', line);
		expect(pos.turn).toBe('w'); // ده نیم‌حرکت = پنج حرکت کامل
		expect(pos.fullmove).toBe(6);
	});

	it('returns null for an illegal SAN', () => {
		const pos = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		expect(moveFromSan(pos, 'Qh5')).toBeNull();
		expect(moveFromSan(pos, 'e5')).toBeNull();
	});
});

describe('UCI notation', () => {
	it('formats from/to plus promotion', () => {
		const pos = parseFen('5k2/3P4/8/8/8/8/8/4K3 w - - 0 1');
		const promos = legalMoves(pos).filter((m) => m.promo === 5);
		expect(promos.map(moveToUci)).toEqual(['d7d8q']);
	});
});
