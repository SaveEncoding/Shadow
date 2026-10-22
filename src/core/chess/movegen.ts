/**
 * تولید حرکات.
 *
 * `pseudoMoves` همه‌ی حرکات «شبه‌قانونی» را می‌سازد (ممکن است شاه در کیش بماند).
 * `legalMoves` هر کدام را اجرا می‌کند و آن‌هایی را که شاه را در کیش می‌گذارند حذف می‌کند.
 * قلعه‌روی مستقیماً در `pseudoMoves` بررسی امنیت خانه‌ها را انجام می‌دهد چون شرطش
 * در چند مرحله است و جدا کردنش خوانایی را خراب می‌کند.
 */

import { isInCheck, isSquareAttacked, onBoard } from './board.js';
import { applyMove, undoMove } from './make-move.js';
import {
	BISHOP,
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
	type Move,
	type Position,
} from './types.js';

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

const PROMOTION_PIECES = [QUEEN, ROOK, BISHOP, KNIGHT];

function addPawnMove(
	out: Move[],
	from: number,
	to: number,
	piece: number,
	captured: number,
	isPromotion: boolean,
	ep = false,
): void {
	if (isPromotion) {
		for (const promo of PROMOTION_PIECES) {
			out.push({ from, to, piece, captured, promo });
		}
		return;
	}
	out.push(ep ? { from, to, piece, captured, ep: true } : { from, to, piece, captured });
}

function addCastling(out: Move[], pos: Position): void {
	const board = pos.board;
	const turn = pos.turn;
	const sign = turn === 'w' ? 1 : -1;
	const kingFrom = turn === 'w' ? 4 : 60;

	if (board[kingFrom] !== KING * sign) return; // شاه جابه‌جا شده (FEN غیرمعمول)
	const enemy: Color = turn === 'w' ? 'b' : 'w';
	// در قلعه‌روی شاه نباید از خانه‌ای عبور کند که مورد حمله است
	if (isSquareAttacked(board, kingFrom, enemy)) return;

	const kingside = turn === 'w' ? CASTLE_WK : CASTLE_BK;
	if (pos.castling & kingside) {
		if (
			board[kingFrom + 1] === 0 &&
			board[kingFrom + 2] === 0 &&
			board[kingFrom + 3] === ROOK * sign &&
			!isSquareAttacked(board, kingFrom + 1, enemy) &&
			!isSquareAttacked(board, kingFrom + 2, enemy)
		) {
			out.push({ from: kingFrom, to: kingFrom + 2, piece: KING * sign, captured: 0, castle: 'k' });
		}
	}

	const queenside = turn === 'w' ? CASTLE_WQ : CASTLE_BQ;
	if (pos.castling & queenside) {
		if (
			board[kingFrom - 1] === 0 &&
			board[kingFrom - 2] === 0 &&
			board[kingFrom - 3] === 0 &&
			board[kingFrom - 4] === ROOK * sign &&
			!isSquareAttacked(board, kingFrom - 1, enemy) &&
			!isSquareAttacked(board, kingFrom - 2, enemy)
		) {
			out.push({ from: kingFrom, to: kingFrom - 2, piece: KING * sign, captured: 0, castle: 'q' });
		}
	}
}

/** همه‌ی حرکات شبه‌قانونی نوبت‌دار */
export function pseudoMoves(pos: Position): Move[] {
	const board = pos.board;
	const out: Move[] = [];
	const turn = pos.turn;
	const sign = turn === 'w' ? 1 : -1;
	const enemy = -sign;
	const startRank = turn === 'w' ? 1 : 6;
	const promoRank = turn === 'w' ? 7 : 0;
	const pawnDir = turn === 'w' ? 8 : -8;

	for (let from = 0; from < 64; from++) {
		const piece = board[from];
		if (piece === 0 || piece * sign <= 0) continue;

		const type = Math.abs(piece);
		const file = from & 7;
		const rank = from >> 3;

		if (type === PAWN) {
			const oneRank = rank + (turn === 'w' ? 1 : -1);
			if (oneRank >= 0 && oneRank < 8) {
				const one = oneRank * 8 + file;
				if (board[one] === 0) {
					addPawnMove(out, from, one, piece, 0, oneRank === promoRank);
					const twoRank = rank + (turn === 'w' ? 2 : -2);
					if (rank === startRank) {
						const two = twoRank * 8 + file;
						if (board[two] === 0) out.push({ from, to: two, piece, captured: 0 });
					}
				}
				for (const df of [-1, 1]) {
					const f = file + df;
					if (f < 0 || f > 7) continue;
					const to = oneRank * 8 + f;
					const target = board[to];
					if (target === KING * enemy) continue;
					if (target !== 0 && target * enemy > 0) {
						addPawnMove(out, from, to, piece, target, oneRank === promoRank);
					} else if (target === 0 && to === pos.ep) {
						out.push({ from, to, piece, captured: PAWN * enemy, ep: true });
					}
				}
			}
			continue;
		}

		if (type === KNIGHT || type === KING) {
			const deltas = type === KNIGHT ? KNIGHT_DELTAS : KING_DELTAS;
			for (const [df, dr] of deltas) {
				const f = file + df;
				const r = rank + dr;
				if (!onBoard(f, r)) continue;
				const to = r * 8 + f;
				const target = board[to];
				if (target !== 0 && target * sign > 0) continue;
				if (target === KING * enemy) continue; // گرفتن شاه هرگز حرکت قانونی نیست
				out.push({ from, to, piece, captured: target });
			}
			continue;
		}

		const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
		for (const [df, dr] of dirs) {
			let f = file + df;
			let r = rank + dr;
			while (onBoard(f, r)) {
				const to = r * 8 + f;
				const target = board[to];
				if (target === 0) {
					out.push({ from, to, piece, captured: 0 });
				} else {
					if (target * sign < 0 && target !== KING * enemy) out.push({ from, to, piece, captured: target });
					break; // اولین مهره مانع است
				}
				f += df;
				r += dr;
			}
		}
	}

	addCastling(out, pos);
	return out;
}

/** فقط حرکاتی که شاهِ نوبت‌دار را در کیش نمی‌گذارند */
export function legalMoves(pos: Position): Move[] {
	const out: Move[] = [];
	for (const move of pseudoMoves(pos)) {
		const undo = applyMove(pos, move);
		const illegal = isInCheck(pos.board, undo.turn);
		undoMove(pos, undo);
		if (!illegal) out.push(move);
	}
	return out;
}

/**
 * حرکات قانونی که از یک صافی عبور می‌کنند.
 * مهم: صافی **قبل** از بررسی قانونی اجرا می‌شود تا برای جست‌وجوی برداشت‌ها
 * (که فقط ۵–۱۰ حرکت دارد) هزینه‌ی بررسی ۳۵ حرکت پرداخت نشود.
 */
export function legalMovesMatching(pos: Position, predicate: (move: Move) => boolean): Move[] {
	const out: Move[] = [];
	for (const move of pseudoMoves(pos)) {
		if (!predicate(move)) continue;
		const undo = applyMove(pos, move);
		const illegal = isInCheck(pos.board, undo.turn);
		undoMove(pos, undo);
		if (!illegal) out.push(move);
	}
	return out;
}

/** حرکات قانونی از یک خانه‌ی مشخص */
export function legalMovesFrom(pos: Position, from: number): Move[] {
	return legalMoves(pos).filter((m) => m.from === from);
}

export function hasLegalMoves(pos: Position): boolean {
	for (const move of pseudoMoves(pos)) {
		const undo = applyMove(pos, move);
		const illegal = isInCheck(pos.board, undo.turn);
		undoMove(pos, undo);
		if (!illegal) return true;
	}
	return false;
}
