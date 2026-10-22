/**
 * شمارش perft: تعداد گره‌های برگِ درخت حرکات تا عمق مشخص.
 * استانداردِ طلایی برای اثبات درستی تولید حرکت. فقط برای تست و دیباگ است.
 */

import { applyMove, undoMove } from './make-move.js';
import { legalMoves } from './movegen.js';
import type { Position } from './types.js';

export function perft(pos: Position, depth: number): number {
	if (depth <= 0) return 1;
	const moves = legalMoves(pos);
	if (depth === 1) return moves.length;

	let nodes = 0;
	for (const move of moves) {
		const undo = applyMove(pos, move);
		nodes += perft(pos, depth - 1);
		undoMove(pos, undo);
	}
	return nodes;
}

/** تقسیم perft به ازای هر حرکت ریشه — برای پیدا کردن محل باگ */
export function perftDivide(pos: Position, depth: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const move of legalMoves(pos)) {
		const undo = applyMove(pos, move);
		const key = `${'abcdefgh'[move.from & 7]}${(move.from >> 3) + 1}${'abcdefgh'[move.to & 7]}${(move.to >> 3) + 1}${
			move.promo ? 'pnbrqk'[move.promo] : ''
		}`;
		out[key] = perft(pos, depth - 1);
		undoMove(pos, undo);
	}
	return out;
}
