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
 * SAN بدون پسوند کیش/مات.
 *
 * جدا کردنش دو فایده دارد: `moveToSan` همان `coreSan + checkSuffix` است (پس
 * رفتارش عیناً حفظ می‌شود)، و `replay` می‌تواند برای «پیدا کردن حرکت از روی
 * SAN» فقط بخش ارزان را بسازد و پسوند کیش را یک‌بار، فقط برای حرکتِ پیدا‌شده،
 * حساب کند. پسوند گران است چون حرکت را اجرا و برمی‌گرداند.
 */
function coreSan(pos: Position, move: Move, legal?: readonly Move[]): string {
	const type = Math.abs(move.piece);

	if (move.castle) {
		return move.castle === 'k' ? 'O-O' : 'O-O-O';
	}

	const target = squareName(move.to);
	const isCapture = move.captured !== 0 || move.ep === true;

	if (type === PAWN) {
		let san = isCapture ? `${'abcdefgh'[fileOf(move.from)]}x${target}` : target;
		if (move.promo) san += `=${PROMO_LETTERS[move.promo]}`;
		return san;
	}

	const letter = PIECE_LETTERS[type];
	// رفع ابهام: اگر مهره‌ی هم‌نوع دیگری هم می‌تواند به همان خانه برود، مبدأ باید ذکر شود.
	const candidates = legal ?? legalMoves(pos);
	const rivals = candidates.filter((m) => m.to === move.to && m.from !== move.from && Math.abs(m.piece) === type && !m.castle);

	let disambiguation = '';
	if (rivals.length > 0) {
		const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
		const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
		if (!sameFile) disambiguation = 'abcdefgh'[fileOf(move.from)]!;
		else if (!sameRank) disambiguation = String(rankOf(move.from) + 1);
		else disambiguation = squareName(move.from);
	}

	return `${letter}${disambiguation}${isCapture ? 'x' : ''}${target}`;
}

/**
 * SAN یک حرکت. ورودی باید از `legalMoves(pos)` آمده باشد.
 *
 * `legal` اختیاری است: وقتی فراخوان از قبل فهرست حرکات قانونیِ همین وضعیت را
 * دارد (مثل `replay` که برای هر نیم‌حرکت یک‌بار تولیدش می‌کند)، دادن آن باعث
 * می‌شود برای «رفع ابهام» دوباره حرکت‌ها تولید نشوند. نتیجه دقیقاً یکی است.
 */
export function moveToSan(pos: Position, move: Move, legal?: readonly Move[]): string {
	return coreSan(pos, move, legal) + checkSuffix(pos, move);
}

/** SAN بدون پسوند کیش/مات (برای تطبیق سریع در `replay`) */
export function moveToSanCore(pos: Position, move: Move, legal?: readonly Move[]): string {
	return coreSan(pos, move, legal);
}

/** پیدا کردن حرکت از روی SAN؛ اگر بی‌معنا باشد null */
export function moveFromSan(pos: Position, san: string): Move | null {
	const normalized = san.replace(/[+#!?]+$/, '').trim();
	const legal = legalMoves(pos);
	for (const move of legal) {
		if (moveToSan(pos, move, legal).replace(/[+#!?]+$/, '') === normalized) return move;
	}
	return null;
}

/** SAN همه‌ی حرکات قانونی — برای تست و دیباگ */
export function legalSans(pos: Position): string[] {
	const legal = legalMoves(pos);
	return legal.map((m) => moveToSan(pos, m, legal));
}
