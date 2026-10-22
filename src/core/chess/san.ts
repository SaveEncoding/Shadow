/**
 * تبدیل حرکت ↔ نماد جبری استاندارد (SAN).
 * برای PGN، تاریخچه و تست‌ها لازم است.
 */

import { fileOf, isInCheck, rankOf, squareName } from './board.js';
import { applyMove, undoMove } from './make-move.js';
import { legalMoves } from './movegen.js';
import { BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, type Move, type Position } from './types.js';

const PIECE_LETTERS: Record<number, string> = {
	[PAWN]: '',
	[KNIGHT]: 'N',
	[BISHOP]: 'B',
	[ROOK]: 'R',
	[QUEEN]: 'Q',
	[KING]: 'K',
};

const PROMO_LETTERS: Record<number, string> = {
	[QUEEN]: 'Q',
	[ROOK]: 'R',
	[BISHOP]: 'B',
	[KNIGHT]: 'N',
};

/**
 * پسوند کیش/مات. پس از اجرای حرکت، نوبت به حریف می‌رسد؛ پس «کیش» یعنی
 * شاهِ نوبت‌دار (حریف) در کیش باشد. مات فقط وقتی است که حریف هیچ حرکت قانونی نداشته باشد.
 */
function checkSuffix(pos: Position, move: Move): string {
	const undo = applyMove(pos, move);
	const checking = isInCheck(pos.board, pos.turn);
	const mate = checking && legalMoves(pos).length === 0;
	undoMove(pos, undo);
	if (!checking) return '';
	return mate ? '#' : '+';
}

/**
 * SAN یک حرکت. ورودی باید از `legalMoves(pos)` آمده باشد.
 */
export function moveToSan(pos: Position, move: Move): string {
	const type = Math.abs(move.piece);

	if (move.castle) {
		return (move.castle === 'k' ? 'O-O' : 'O-O-O') + checkSuffix(pos, move);
	}

	const target = squareName(move.to);
	const isCapture = move.captured !== 0 || move.ep === true;

	if (type === PAWN) {
		let san = isCapture ? `${'abcdefgh'[fileOf(move.from)]}x${target}` : target;
		if (move.promo) san += `=${PROMO_LETTERS[move.promo]}`;
		return san + checkSuffix(pos, move);
	}

	const letter = PIECE_LETTERS[type];
	// رفع ابهام: اگر مهره‌ی هم‌نوع دیگری هم می‌تواند به همان خانه برود، مبدأ باید ذکر شود.
	const rivals = legalMoves(pos).filter(
		(m) => m.to === move.to && m.from !== move.from && Math.abs(m.piece) === type && !m.castle,
	);

	let disambiguation = '';
	if (rivals.length > 0) {
		const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
		const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
		if (!sameFile) disambiguation = 'abcdefgh'[fileOf(move.from)];
		else if (!sameRank) disambiguation = String(rankOf(move.from) + 1);
		else disambiguation = squareName(move.from);
	}

	const san = `${letter}${disambiguation}${isCapture ? 'x' : ''}${target}`;
	return san + checkSuffix(pos, move);
}

/** پیدا کردن حرکت از روی SAN؛ اگر بی‌معنا باشد null */
export function moveFromSan(pos: Position, san: string): Move | null {
	const normalized = san.replace(/[+#!?]+$/, '').trim();
	for (const move of legalMoves(pos)) {
		if (moveToSan(pos, move).replace(/[+#!?]+$/, '') === normalized) return move;
	}
	return null;
}

/** SAN همه‌ی حرکات قانونی — برای تست و دیباگ */
export function legalSans(pos: Position): string[] {
	return legalMoves(pos).map((m) => moveToSan(pos, m));
}
