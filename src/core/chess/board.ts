/**
 * کمک‌کننده‌های تخته: تبدیل نام خانه، رنگ مهره، و تشخیص حمله.
 * همه توابع خالص‌اند و هیچ حالتی را تغییر نمی‌دهند.
 */

import { BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, type Color, type PieceCode, type Square } from './types.js';

export const FILES = 'abcdefgh';

export function fileOf(sq: number): number {
	return sq & 7;
}

export function rankOf(sq: number): number {
	return sq >> 3;
}

export function squareAt(file: number, rank: number): Square {
	return rank * 8 + file;
}

export function onBoard(file: number, rank: number): boolean {
	return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

/** شماره‌ی خانه ← نام جبری؛ مثلاً 4 → "e1" */
export function squareName(sq: number): string {
	return `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;
}

/** نام جبری ← شماره‌ی خانه؛ ورودی نامعتبر → null */
export function parseSquare(name: string): Square | null {
	if (typeof name !== 'string' || name.length !== 2) return null;
	const file = FILES.indexOf(name[0].toLowerCase());
	const rank = Number(name[1]) - 1;
	if (file < 0 || !Number.isInteger(rank) || rank < 0 || rank > 7) return null;
	return squareAt(file, rank);
}

export function pieceType(piece: PieceCode): number {
	return Math.abs(piece);
}

export function pieceColor(piece: PieceCode): Color {
	return piece > 0 ? 'w' : 'b';
}

export function colorSign(color: Color): 1 | -1 {
	return color === 'w' ? 1 : -1;
}

export function opposite(color: Color): Color {
	return color === 'w' ? 'b' : 'w';
}

const KNIGHT_DELTAS: ReadonlyArray<readonly [number, number]> = [
	[1, 2],
	[2, 1],
	[2, -1],
	[1, -2],
	[-1, -2],
	[-2, -1],
	[-2, 1],
	[-1, 2],
];

const KING_DELTAS: ReadonlyArray<readonly [number, number]> = [
	[0, 1],
	[1, 1],
	[1, 0],
	[1, -1],
	[0, -1],
	[-1, -1],
	[-1, 0],
	[-1, 1],
];

const BISHOP_DIRS: ReadonlyArray<readonly [number, number]> = [
	[1, 1],
	[1, -1],
	[-1, -1],
	[-1, 1],
];

const ROOK_DIRS: ReadonlyArray<readonly [number, number]> = [
	[0, 1],
	[1, 0],
	[0, -1],
	[-1, 0],
];

/**
 * آیا خانه‌ی `sq` توسط مهره‌های رنگ `by` مورد حمله است؟
 * این تابع پایه‌ی همه‌ی بررسی‌های قانونی بودن حرکت است.
 */
export function isSquareAttacked(board: Int8Array, sq: Square, by: Color): boolean {
	const sign = by === 'w' ? 1 : -1;
	const file = fileOf(sq);
	const rank = rankOf(sq);

	// پیاده‌ها: پیاده‌ی سفید از یک رتبه پایین‌تر به بالا حمله می‌کند.
	// پس مهاجمِ خانه‌ی (file, rank) در رتبه‌ی rank-1 (سفید) یا rank+1 (سیاه) است.
	const pawnRank = by === 'w' ? rank - 1 : rank + 1;
	if (pawnRank >= 0 && pawnRank < 8) {
		for (const df of [-1, 1]) {
			const f = file + df;
			if (f >= 0 && f < 8 && board[pawnRank * 8 + f] === PAWN * sign) return true;
		}
	}

	// اسب
	for (const [df, dr] of KNIGHT_DELTAS) {
		const f = file + df;
		const r = rank + dr;
		if (onBoard(f, r) && board[r * 8 + f] === KNIGHT * sign) return true;
	}

	// شاه
	for (const [df, dr] of KING_DELTAS) {
		const f = file + df;
		const r = rank + dr;
		if (onBoard(f, r) && board[r * 8 + f] === KING * sign) return true;
	}

	// مهره‌های لغزنده: فیل/وزیر روی قطرها
	for (const [df, dr] of BISHOP_DIRS) {
		let f = file + df;
		let r = rank + dr;
		while (onBoard(f, r)) {
			const p = board[r * 8 + f];
			if (p !== 0) {
				if (p === BISHOP * sign || p === QUEEN * sign) return true;
				break;
			}
			f += df;
			r += dr;
		}
	}

	// رخ/وزیر روی خطوط
	for (const [df, dr] of ROOK_DIRS) {
		let f = file + df;
		let r = rank + dr;
		while (onBoard(f, r)) {
			const p = board[r * 8 + f];
			if (p !== 0) {
				if (p === ROOK * sign || p === QUEEN * sign) return true;
				break;
			}
			f += df;
			r += dr;
		}
	}

	return false;
}

/** خانه‌ی شاهِ رنگ مشخص؛ اگر شاه روی تخته نباشد ‎-1 */
export function findKing(board: Int8Array, color: Color): Square {
	const target = KING * colorSign(color);
	for (let i = 0; i < 64; i++) {
		if (board[i] === target) return i;
	}
	return -1;
}

/** آیا شاهِ `color` در کیش است؟ */
export function isInCheck(board: Int8Array, color: Color): boolean {
	const king = findKing(board, color);
	if (king < 0) return false;
	return isSquareAttacked(board, king, opposite(color));
}
