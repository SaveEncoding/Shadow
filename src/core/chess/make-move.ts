/**
 * اجرا و بازگرداندن حرکت روی وضعیت.
 *
 * طراحی: `applyMove` وضعیت را **در جا** تغییر می‌دهد و یک `Undo` برمی‌گرداند.
 * این انتخاب عمدی است: برای perft و جست‌وجوی موتور، کپی‌کردن تخته در هر گره
 * چند برابر کندتر است و تخصیص حافظه‌ی اضافه می‌سازد (در Worker حافظه گران است).
 */

import { CASTLE_BK, CASTLE_BQ, CASTLE_WK, CASTLE_WQ, PAWN, type Move, type Position, type Undo } from './types.js';

const CASTLE_MASK = new Int8Array(64).fill(15);
CASTLE_MASK[0] &= ~CASTLE_WQ; // a1
CASTLE_MASK[4] &= ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_MASK[7] &= ~CASTLE_WK; // h1
CASTLE_MASK[56] &= ~CASTLE_BQ; // a8
CASTLE_MASK[60] &= ~(CASTLE_BK | CASTLE_BQ); // e8
CASTLE_MASK[63] &= ~CASTLE_BK; // h8

/** خانه‌ای که پیاده‌ی گرفته‌شده در en-passant روی آن است */
export function capturedSquareFor(move: Move): number {
	if (!move.ep) return move.to;
	return move.to + (move.piece > 0 ? -8 : 8);
}

export function applyMove(pos: Position, move: Move): Undo {
	const undo: Undo = {
		move,
		castling: pos.castling,
		ep: pos.ep,
		halfmove: pos.halfmove,
		fullmove: pos.fullmove,
		turn: pos.turn,
	};

	const board = pos.board;
	const sign = move.piece > 0 ? 1 : -1;
	const capturedSq = capturedSquareFor(move);
	const captured = board[capturedSq];

	board[move.from] = 0;
	board[capturedSq] = 0;
	board[move.to] = move.promo ? move.promo * sign : move.piece;

	if (move.castle) {
		const rookFrom = move.castle === 'k' ? move.from + 3 : move.from - 4;
		const rookTo = move.castle === 'k' ? move.from + 1 : move.from - 1;
		board[rookTo] = board[rookFrom];
		board[rookFrom] = 0;
	}

	pos.castling &= CASTLE_MASK[move.from] & CASTLE_MASK[move.to];

	// en-passant تنها بعد از پیشروی دو خانه‌ای پیاده معنا دارد
	if (Math.abs(move.piece) === PAWN && Math.abs(move.to - move.from) === 16) {
		pos.ep = (move.from + move.to) >> 1;
	} else {
		pos.ep = -1;
	}

	if (Math.abs(move.piece) === PAWN || captured !== 0) pos.halfmove = 0;
	else pos.halfmove++;

	if (pos.turn === 'b') pos.fullmove++;
	pos.turn = pos.turn === 'w' ? 'b' : 'w';

	return undo;
}

export function undoMove(pos: Position, undo: Undo): void {
	const move = undo.move;
	const board = pos.board;
	const sign = move.piece > 0 ? 1 : -1;

	board[move.to] = 0;

	if (move.ep) {
		board[capturedSquareFor(move)] = move.captured;
	} else if (move.captured) {
		board[move.to] = move.captured;
	}

	// برای ترفیع، مهره‌ی اصلی (پیاده) بازگردانده می‌شود
	board[move.from] = move.piece;

	if (move.castle) {
		const rookFrom = move.castle === 'k' ? move.from + 3 : move.from - 4;
		const rookTo = move.castle === 'k' ? move.from + 1 : move.from - 1;
		board[rookFrom] = board[rookTo];
		board[rookTo] = 0;
	}

	pos.castling = undo.castling;
	pos.ep = undo.ep;
	pos.halfmove = undo.halfmove;
	pos.fullmove = undo.fullmove;
	pos.turn = undo.turn;
}

const PROMO_NAMES: Record<number, string> = { 5: 'q', 4: 'r', 3: 'b', 2: 'n' };

/** نمایش UCI یک حرکت؛ مثلاً "e2e4"، "e7e8q" */
export function moveToUci(move: Move): string {
	const from = `${'abcdefgh'[move.from & 7]}${(move.from >> 3) + 1}`;
	const to = `${'abcdefgh'[move.to & 7]}${(move.to >> 3) + 1}`;
	return from + to + (move.promo ? PROMO_NAMES[move.promo] : '');
}
