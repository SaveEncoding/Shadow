import { describe, it, expect } from 'vitest';
import { buildPgn, pgnHeaders, pgnMoveText } from '../src/core/chess/pgn.js';

describe('PGN headers', () => {
	it('writes the seven mandatory tags', () => {
		const headers = pgnHeaders({ moves: [], result: '1-0', white: 'Ali', black: 'Shadow', date: '2026.10.22' });
		expect(headers).toHaveLength(7);
		expect(headers[0]).toBe('[Event "Shadow Chess"]');
		expect(headers[2]).toBe('[Date "2026.10.22"]');
		expect(headers[4]).toBe('[White "Ali"]');
		expect(headers[6]).toBe('[Result "1-0"]');
	});

	it('adds SetUp/FEN for non-standard starts', () => {
		const headers = pgnHeaders({
			moves: [],
			result: '1/2-1/2',
			startFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
		});
		expect(headers).toContain('[SetUp "1"]');
		expect(headers).toContain('[FEN "4k3/8/8/8/8/8/8/4K3 w - - 0 1"]');
	});

	it('escapes quotes and backslashes in tag values', () => {
		const headers = pgnHeaders({ moves: [], result: '*', white: 'a"b\\c' });
		expect(headers[4]).toBe('[White "a\\"b\\\\c"]');
	});
});

describe('PGN move text', () => {
	it('numbers moves from white and black', () => {
		expect(pgnMoveText(['e4', 'e5', 'Nf3'], '1-0')).toBe('1. e4 e5 2. Nf3 1-0');
	});

	it('handles a black-only first move', () => {
		expect(pgnMoveText([], '*')).toBe('*');
	});

	it('wraps long games under 80 characters per line', () => {
		const moves = Array.from({ length: 80 }, (_, i) => `N${(i % 8) + 1}f3`);
		const text = pgnMoveText(moves, '1/2-1/2');
		for (const line of text.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('builds a full document ending with a newline and result', () => {
		const pgn = buildPgn({
			moves: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'],
			result: '1-0',
			white: 'player',
			black: 'engine',
			comments: ['level: 2'],
		});
		expect(pgn.endsWith('\n')).toBe(true);
		expect(pgn).toContain('[White "player"]');
		expect(pgn).toContain('{ level: 2 }');
		expect(pgn).toContain('4. Qxf7# 1-0');
	});
});
