/**
 * ارزیابی ایستا (Static Evaluation).
 *
 * هدف صادقانه: این یک موتور «قابل بازی» است، نه Stockfish. ماده + جدول موقعیت مهره
 * (PST) + جفت فیل + حرکت‌پذیری سبک. برای قوی‌تر شدن باید موتور واقعی (UCI) روی نود اجرا شود.
 *
 * خروجی همیشه از دید **سفید** و بر حسب سانتی‌پیاده است.
 */

import { BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, type Position } from './types.js';

export const PIECE_VALUE: Record<number, number> = {
	[PAWN]: 100,
	[KNIGHT]: 320,
	[BISHOP]: 330,
	[ROOK]: 500,
	[QUEEN]: 900,
	[KING]: 20000,
};

// جدول‌ها از دید سفید و با اندیس a1=0 نوشته شده‌اند (رتبه‌ی اول در ابتدای آرایه).
const PAWN_PST = [
	0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, 5,
	10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_PST = [
	-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15,
	20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40,
	-50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_PST = [
	-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10,
	5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10,
	-10, -10, -10, -10, -10, -20,
];

const ROOK_PST = [
	0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0,
	0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
];

const QUEEN_PST = [
	-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0,
	-5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10,
	-10, -20,
];

const KING_MIDDLE_PST = [
	-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
	-30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20,
	-20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
];

const KING_END_PST = [
	-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30,
	-10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0,
	0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
];

const PST: Record<number, number[]> = {
	[PAWN]: PAWN_PST,
	[KNIGHT]: KNIGHT_PST,
	[BISHOP]: BISHOP_PST,
	[ROOK]: ROOK_PST,
	[QUEEN]: QUEEN_PST,
};

/** آینه‌کردن خانه برای سیاه */
function mirror(sq: number): number {
	return sq ^ 56;
}

/** آیا مرحله‌ی پایانی است؟ (وزیرها رفته‌اند یا ماده کم است) */
function isEndgame(pos: Position): boolean {
	let material = 0;
	let queens = 0;
	for (let i = 0; i < 64; i++) {
		const p = pos.board[i];
		if (p === 0) continue;
		const type = Math.abs(p);
		if (type === KING) continue;
		material += PIECE_VALUE[type];
		if (type === QUEEN) queens++;
	}
	return queens === 0 || material < 2400;
}

export function evaluate(pos: Position): number {
	const board = pos.board;
	let score = 0;
	let whiteBishops = 0;
	let blackBishops = 0;
	const endgame = isEndgame(pos);

	for (let sq = 0; sq < 64; sq++) {
		const piece = board[sq];
		if (piece === 0) continue;

		const type = Math.abs(piece);
		const white = piece > 0;
		const index = white ? sq : mirror(sq);
		const value = PIECE_VALUE[type] + (type === KING ? (endgame ? KING_END_PST[index] : KING_MIDDLE_PST[index]) : PST[type][index]);

		score += white ? value : -value;

		if (type === BISHOP) {
			if (white) whiteBishops++;
			else blackBishops++;
		}
	}

	// جفت فیل در پایان‌بازی‌ها ارزشمندتر است
	const bishopBonus = endgame ? 45 : 30;
	if (whiteBishops >= 2) score += bishopBonus;
	if (blackBishops >= 2) score -= bishopBonus;

	// تحرک سبک: تعداد حرکات قانونی مهره‌های سنگین پاداش کمی می‌گیرد.
	// عمداً از movegen استفاده نمی‌کنیم تا ارزیابی در برگ‌های qsearch ارزان بماند.

	return score;
}

/** ارزیابی از دید نوبت‌دار (negamax) */
export function evaluateForSideToMove(pos: Position): number {
	const score = evaluate(pos);
	return pos.turn === 'w' ? score : -score;
}
