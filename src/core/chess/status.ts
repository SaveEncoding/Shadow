/**
 * وضعیت بازی: مات، پات، مساوی‌های قانونی.
 * «تکرار سه‌باره» نیاز به تاریخچه دارد؛ چون این ماژول حالت‌دار نیست،
 * شمارش تکرار از بیرون داده می‌شود (لایه‌ی بازی این کار را می‌کند).
 */

import { fileOf, isInCheck, opposite, rankOf } from './board.js';
import { legalMoves } from './movegen.js';
import {
	BISHOP,
	KNIGHT,
	PAWN,
	QUEEN,
	ROOK,
	type Color,
	type GameStatus,
	type Position,
} from './types.js';

export interface StatusOptions {
	/** چند بار وضعیت فعلی (با نوبت و حقوق قلعه و en-passant) تکرار شده است */
	repetitionCount?: number;
	/** سقف نیم‌حرکت برای قاعده‌ی ۵۰ حرکت (پیش‌فرض ۱۰۰) */
	halfmoveLimit?: number;
}

/**
 * آیا ماده‌ی کافی برای مات وجود ندارد؟ (وضعیت مرده)
 * فقط موارد قطعی: K-K، K+B-K، K+N-K، و K+B-K+B با دو فیل هم‌رنگ.
 */
export function isInsufficientMaterial(pos: Position): boolean {
	const minors: Array<{ type: number; square: number; color: Color }> = [];

	for (let sq = 0; sq < 64; sq++) {
		const piece = pos.board[sq];
		if (piece === 0) continue;
		const type = Math.abs(piece);
		const color: Color = piece > 0 ? 'w' : 'b';

		if (type === PAWN || type === ROOK || type === QUEEN) return false;
		if (type === KNIGHT || type === BISHOP) minors.push({ type, square: sq, color });
	}

	if (minors.length === 0) return true; // K vs K
	if (minors.length === 1) return true; // K+B یا K+N vs K

	if (minors.length === 2) {
		const [a, b] = minors;
		if (a.color === b.color) return false; // K+B+B یا K+N+N — مات ممکن است
		if (a.type === KNIGHT || b.type === KNIGHT) return false; // K+N vs K+N
		// دو فیل در خانه‌های هم‌رنگ → مات غیرممکن
		const aColor = (fileOf(a.square) + rankOf(a.square)) & 1;
		const bColor = (fileOf(b.square) + rankOf(b.square)) & 1;
		return aColor === bColor;
	}

	return false;
}

export function getStatus(pos: Position, options: StatusOptions = {}): GameStatus {
	const check = isInCheck(pos.board, pos.turn);
	const hasMoves = legalMoves(pos).length > 0;

	if (!hasMoves) {
		if (check) {
			return {
				over: true,
				result: pos.turn === 'w' ? '0-1' : '1-0',
				reason: 'checkmate',
				winner: opposite(pos.turn),
				check: true,
			};
		}
		return { over: true, result: '1/2-1/2', reason: 'stalemate', winner: null, check: false };
	}

	const halfmoveLimit = options.halfmoveLimit ?? 100;
	if (pos.halfmove >= halfmoveLimit) {
		return { over: true, result: '1/2-1/2', reason: 'fifty-move', winner: null, check };
	}

	if ((options.repetitionCount ?? 0) >= 3) {
		return { over: true, result: '1/2-1/2', reason: 'threefold', winner: null, check };
	}

	if (isInsufficientMaterial(pos)) {
		return {
			over: true,
			result: '1/2-1/2',
			reason: 'insufficient-material',
			winner: null,
			check,
		};
	}

	return { over: false, result: null, reason: null, winner: null, check };
}
