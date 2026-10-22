/**
 * خواندن/نوشتن FEN.
 * ورودی نامعتبر با `FenError` رد می‌شود تا هیچ‌وقت وضعیت نیمه‌معتبر نسازیم.
 */

import {
	BISHOP,
	CASTLE_ALL,
	CASTLE_BK,
	CASTLE_BQ,
	CASTLE_WK,
	CASTLE_WQ,
	KING,
	KNIGHT,
	PAWN,
	QUEEN,
	ROOK,
	type Color,
	type Position,
} from './types.js';
import { fileOf, rankOf, squareAt } from './board.js';

export class FenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FenError';
	}
}

const CHAR_TO_PIECE: Record<string, number> = {
	p: PAWN,
	n: KNIGHT,
	b: BISHOP,
	r: ROOK,
	q: QUEEN,
	k: KING,
};

const PIECE_TO_CHAR = ['', 'p', 'n', 'b', 'r', 'q', 'k'];

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function emptyPosition(): Position {
	return {
		board: new Int8Array(64),
		turn: 'w',
		castling: 0,
		ep: -1,
		halfmove: 0,
		fullmove: 1,
	};
}

export function clonePosition(pos: Position): Position {
	return {
		board: Int8Array.from(pos.board),
		turn: pos.turn,
		castling: pos.castling,
		ep: pos.ep,
		halfmove: pos.halfmove,
		fullmove: pos.fullmove,
	};
}

export function parseFen(fen: string): Position {
	if (typeof fen !== 'string') throw new FenError('FEN must be a string');
	const parts = fen.trim().split(/\s+/);
	if (parts.length < 2) throw new FenError('FEN needs at least board and side to move');

	const [boardPart, turnPart, castlingPart, epPart, halfPart, fullPart] = parts;
	const place = boardPart.split('/');
	if (place.length !== 8) throw new FenError(`FEN board must have 8 ranks, got ${place.length}`);

	const board = new Int8Array(64);
	for (let r = 0; r < 8; r++) {
		const rank = 7 - r; // رتبه‌ی اول FEN، رتبه‌ی هشتم تخته است
		let file = 0;
		for (const ch of place[r]) {
			if (/[1-8]/.test(ch)) {
				file += Number(ch);
				if (file > 8) throw new FenError(`rank ${8 - r} overflows`);
				continue;
			}
			const lower = ch.toLowerCase();
			const type = CHAR_TO_PIECE[lower];
			if (!type) throw new FenError(`Unknown piece "${ch}" in rank ${8 - r}`);
			if (file > 7) throw new FenError(`rank ${8 - r} overflows`);
			board[squareAt(file, rank)] = ch === lower ? -type : type;
			file++;
		}
		if (file !== 8) throw new FenError(`rank ${8 - r} describes ${file} squares, not 8`);
	}

	if (turnPart !== 'w' && turnPart !== 'b') throw new FenError('side to move must be "w" or "b"');
	const turn = turnPart as Color;

	let castling = 0;
	if (castlingPart && castlingPart !== '-') {
		for (const ch of castlingPart) {
			switch (ch) {
				case 'K':
					castling |= CASTLE_WK;
					break;
				case 'Q':
					castling |= CASTLE_WQ;
					break;
				case 'k':
					castling |= CASTLE_BK;
					break;
				case 'q':
					castling |= CASTLE_BQ;
					break;
				default:
					throw new FenError(`Unknown castling flag "${ch}"`);
			}
		}
	}

	let ep = -1;
	if (epPart && epPart !== '-') {
		if (!/^[a-h][36]$/.test(epPart)) throw new FenError(`Bad en-passant square "${epPart}"`);
		ep = squareAt(epPart.charCodeAt(0) - 97, Number(epPart[1]) - 1);
	}

	const halfmove = halfPart === undefined ? 0 : Number(halfPart);
	const fullmove = fullPart === undefined ? 1 : Number(fullPart);
	if (!Number.isInteger(halfmove) || halfmove < 0) throw new FenError('halfmove clock must be a non-negative integer');
	if (!Number.isInteger(fullmove) || fullmove < 1) throw new FenError('fullmove number must be >= 1');

	return { board, turn, castling: castling & CASTLE_ALL, ep, halfmove, fullmove };
}

export function toFen(pos: Position): string {
	const ranks: string[] = [];
	for (let rank = 7; rank >= 0; rank--) {
		let out = '';
		let empty = 0;
		for (let file = 0; file < 8; file++) {
			const piece = pos.board[squareAt(file, rank)];
			if (piece === 0) {
				empty++;
				continue;
			}
			if (empty) {
				out += String(empty);
				empty = 0;
			}
			const ch = PIECE_TO_CHAR[Math.abs(piece)];
			out += piece > 0 ? ch.toUpperCase() : ch;
		}
		if (empty) out += String(empty);
		ranks.push(out);
	}

	let castling = '';
	if (pos.castling & CASTLE_WK) castling += 'K';
	if (pos.castling & CASTLE_WQ) castling += 'Q';
	if (pos.castling & CASTLE_BK) castling += 'k';
	if (pos.castling & CASTLE_BQ) castling += 'q';

	const ep = pos.ep < 0 ? '-' : `${'abcdefgh'[fileOf(pos.ep)]}${rankOf(pos.ep) + 1}`;

	return `${ranks.join('/')} ${pos.turn} ${castling || '-'} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

/**
 * کلید یکتای وضعیت (بدون شمارنده‌ها) برای شمارش تکرار سه‌باره.
 * شامل حقوق قلعه و en-passant است چون هر دو «حرکات ممکن» را تغییر می‌دهند.
 */
export function positionKey(pos: Position): string {
	const fen = toFen(pos).split(' ');
	return fen.slice(0, 4).join(' ');
}

export function startPosition(): Position {
	return parseFen(START_FEN);
}
