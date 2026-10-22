import { describe, it, expect } from 'vitest';
import { parseFen, START_FEN } from '../src/core/chess/fen.js';
import {
	CAPTURE_TARGET_CELL,
	EMPTY_CELL,
	MOVE_TARGET_CELL,
	SELECTED_CELL,
	describeTurn,
	pieceSymbol,
	renderBoardLines,
	renderBoardText,
} from '../src/core/chess/render.js';
import { parseSquare } from '../src/core/chess/board.js';

describe('board rendering', () => {
	it('renders the start position from white with coordinates', () => {
		const lines = renderBoardLines(parseFen(START_FEN));
		expect(lines).toHaveLength(9);
		expect(lines[0]).toBe('8 ♜ ♞ ♝ ♛ ♚ ♝ ♞ ♜');
		expect(lines[1]).toBe('7 ♟ ♟ ♟ ♟ ♟ ♟ ♟ ♟');
		expect(lines[6]).toBe('2 ♙ ♙ ♙ ♙ ♙ ♙ ♙ ♙');
		expect(lines[7]).toBe('1 ♖ ♘ ♗ ♕ ♔ ♗ ♘ ♖');
		expect(lines[8]).toBe('  a b c d e f g h');
	});

	it('flips the board for black', () => {
		const pos = parseFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
		const white = renderBoardLines(pos);
		const black = renderBoardLines(pos, { perspective: 'b' });
		expect(white[7]).toBe('1 ♖ · · · ♔ · · ·');
		expect(black[0]).toBe('1 · · · ♔ · · · ♖');
		expect(black[8]).toBe('  h g f e d c b a');
	});

	it('can omit coordinates', () => {
		expect(renderBoardLines(parseFen(START_FEN), { coords: false })).toHaveLength(8);
	});

	it('marks the selected square and legal targets', () => {
		const pos = parseFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
		const e2 = parseSquare('e2');
		const lines = renderBoardLines(pos, {
			selected: e2,
			targets: [parseSquare('e3'), parseSquare('e4'), parseSquare('d3')],
		});
		const rank2 = lines.find((l) => l.startsWith('2 '));
		const rank3 = lines.find((l) => l.startsWith('3 '));
		expect(rank2).toContain(SELECTED_CELL);
		expect(rank3).toContain(MOVE_TARGET_CELL);
		// d3 خالی است، پس نشانگر هدف است نه مهره
		expect(rank3?.split(' ').filter((c) => c === MOVE_TARGET_CELL)).toHaveLength(2);
	});

	it('marks capture targets with x', () => {
		const pos = parseFen('4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1');
		const lines = renderBoardLines(pos, { targets: [parseSquare('e3'), parseSquare('f3')] });
		const rank3 = lines.find((l) => l.startsWith('3 '));
		expect(rank3).toContain(CAPTURE_TARGET_CELL);
	});

	it('keeps every rendered line the same width', () => {
		const lines = renderBoardLines(parseFen(START_FEN), { coords: false });
		const widths = new Set(lines.map((l) => [...l].length));
		expect(widths.size).toBe(1);
	});

	it('uses distinct symbols for both colors', () => {
		expect(pieceSymbol(1)).toBe('♙');
		expect(pieceSymbol(-1)).toBe('♟');
		expect(pieceSymbol(6)).toBe('♔');
		expect(pieceSymbol(-6)).toBe('♚');
		expect(pieceSymbol(0)).toBeUndefined();
	});

	it('wraps the board in text form', () => {
		const text = renderBoardText(parseFen(START_FEN));
		expect(text.split('\n')).toHaveLength(9);
		expect(text).toContain('♕');
	});

	it('describes the side to move in Persian', () => {
		expect(describeTurn(parseFen(START_FEN), false)).toContain('سفید');
		expect(describeTurn(parseFen(START_FEN), true)).toContain('کیش');
		expect(describeTurn(parseFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1'), false)).toContain('سیاه');
	});
});
