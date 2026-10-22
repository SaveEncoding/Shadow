/**
 * موتور جست‌وجو: negamax با alpha-beta، عمق‌افزا (iterative deepening) و
 * جست‌وجوی آرام (quiescence) روی برداشت‌ها.
 *
 * سه ویژگی که این ماژول را برای اجرا روی Worker امن می‌کند:
 *  ۱. **سقف گره** (`nodeLimit`) به‌جای سقف زمان → خروجی قطعی و قابل تکرار.
 *  ۲. **هیچ I/O و هیچ تایمری** → در تست می‌توان دقیقاً همان نتیجه را انتظار داشت.
 *  ۳. **seed صریح** برای تنوع کنترل‌شده در سطوح پایین → «موتور vs موتور» بازتولیدپذیر.
 */

import { isInCheck, isSquareAttacked } from './board.js';
import { evaluate } from './eval.js';
import { applyMove, undoMove } from './make-move.js';
import { legalMoves, legalMovesMatching } from './movegen.js';
import { KING, type Move, type Position } from './types.js';

export const MATE_SCORE = 100_000;
const INFINITY = 1_000_000;

export interface SearchOptions {
	depth: number;
	/** سقف تعداد گره‌های جست‌وجو؛ رسیدن به آن، جست‌وجو را متوقف و بهترین نتیجه‌ی کامل را برمی‌گرداند */
	nodeLimit?: number;
}

export interface ScoredMove {
	move: Move;
	score: number;
}

export interface SearchResult {
	move: Move | null;
	score: number;
	depth: number;
	nodes: number;
	/** امتیاز همه‌ی حرکات ریشه در آخرین عمقِ تکمیل‌شده (از دید نوبت‌دار) */
	rootScores: ScoredMove[];
	/** آیا سقف گره باعث توقف شد؟ */
	truncated: boolean;
}

function moveOrderScore(move: Move): number {
	let score = 0;
	if (move.captured) score += 10 * Math.abs(move.captured) - Math.abs(move.piece);
	if (move.promo) score += 800 + move.promo * 10;
	if (move.castle) score += 30;
	return score;
}

class Searcher {
	nodes = 0;
	truncated = false;
	private readonly nodeLimit: number;

	constructor(nodeLimit: number) {
		this.nodeLimit = nodeLimit;
	}

	private outOfNodes(): boolean {
		if (this.nodes >= this.nodeLimit) {
			this.truncated = true;
			return true;
		}
		return false;
	}

	/**
	 * منفی‌بیشینه با هرس آلفا-بتا. امتیاز از دید «نوبت‌دار» برگردانده می‌شود.
	 * `ply` برای ترجیح مات‌های نزدیک‌تر به کار می‌رود.
	 */
	negamax(pos: Position, depth: number, alpha: number, beta: number, ply: number): number {
		this.nodes++;
		if (this.outOfNodes()) return evaluate(pos);

		// در برگ، پیش از تولید کامل حرکات، به جست‌وجوی آرام می‌رویم (صرفه‌جویی زیاد)
		if (depth <= 0) return this.quiescence(pos, alpha, beta, ply);

		const moves = legalMoves(pos);

		if (moves.length === 0) {
			// مات یا پات
			const inCheck = this.isKingAttacked(pos);
			return inCheck ? -MATE_SCORE + ply : 0;
		}

		moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

		let best = -INFINITY;
		for (const move of moves) {
			const undo = applyMove(pos, move);
			const score = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1);
			undoMove(pos, undo);

			if (this.truncated) return best === -INFINITY ? evaluate(pos) : best;

			if (score > best) best = score;
			if (best > alpha) alpha = best;
			if (alpha >= beta) break; // هرس
		}
		return best;
	}

	/**
	 * فقط برداشت‌ها و ترفیع‌ها را ادامه می‌دهد تا افق جست‌وجو «خاموش» نشود.
	 *
	 * نکته‌ی مهم: این تابع **fail-soft** است (بهترین امتیاز واقعی را برمی‌گرداند، نه کران بتا).
	 * اگر fail-hard باشد، همه‌ی حرکات بدِ ریشه امتیازِ برابر با آلفا می‌گیرند و لایه‌ی انتخاب
	 * سطح‌ها (که بر پایه‌ی «همه‌ی حرکات نزدیک به بهترین») کار می‌کند، حرکت‌های مضر را هم‌ارز
	 * بهترین حرکت می‌بیند و گاهی آن‌ها را انتخاب می‌کند.
	 */
	quiescence(pos: Position, alpha: number, beta: number, ply: number): number {
		this.nodes++;
		if (this.outOfNodes()) return evaluate(pos) * (pos.turn === 'w' ? 1 : -1);

		let best = evaluate(pos) * (pos.turn === 'w' ? 1 : -1);
		if (best >= beta) return best;
		if (best > alpha) alpha = best;

		const moves = legalMovesMatching(pos, (m) => m.captured !== 0 || m.promo !== undefined).sort(
			(a, b) => moveOrderScore(b) - moveOrderScore(a),
		);

		for (const move of moves) {
			const undo = applyMove(pos, move);
			const score = -this.quiescence(pos, -beta, -alpha, ply + 1);
			undoMove(pos, undo);
			if (this.truncated) return best;

			if (score > best) best = score;
			if (best > alpha) alpha = best;
			if (alpha >= beta) break;
		}
		return best;
	}

	private isKingAttacked(pos: Position): boolean {
		const kingValue = KING * (pos.turn === 'w' ? 1 : -1);
		for (let sq = 0; sq < 64; sq++) {
			if (pos.board[sq] === kingValue) return isSquareAttacked(pos.board, sq, pos.turn === 'w' ? 'b' : 'w');
		}
		return false;
	}
}

/** جست‌وجوی کامل با عمق ثابت (و سقف گره اختیاری) */
export function search(pos: Position, options: SearchOptions): SearchResult {
	const searcher = new Searcher(options.nodeLimit ?? Number.POSITIVE_INFINITY);
	const legal = legalMoves(pos);
	if (legal.length === 0) {
		const score = isInCheck(pos.board, pos.turn) ? -MATE_SCORE : 0;
		return { move: null, score, depth: 0, nodes: 0, rootScores: [], truncated: false };
	}

	let best: SearchResult = {
		move: legal[0],
		score: 0,
		depth: 0,
		nodes: 0,
		rootScores: legal.map((m) => ({ move: m, score: 0 })),
		truncated: false,
	};

	let ordered = [...legal];

	for (let depth = 1; depth <= options.depth; depth++) {
		let alpha = -INFINITY;
		const beta = INFINITY;
		const scores: ScoredMove[] = [];
		let localBest: Move | null = null;
		let localBestScore = -INFINITY;

		for (const move of ordered) {
			const undo = applyMove(pos, move);
			const score = -searcher.negamax(pos, depth - 1, -beta, -alpha, 1);
			undoMove(pos, undo);

			if (searcher.truncated) break;

			scores.push({ move, score });
			if (score > localBestScore) {
				localBestScore = score;
				localBest = move;
			}
			if (score > alpha) alpha = score;
		}

		if (localBest && scores.length === ordered.length) {
			best = {
				move: localBest,
				score: localBestScore,
				depth,
				nodes: searcher.nodes,
				rootScores: scores,
				truncated: searcher.truncated,
			};
			// در تکرار بعدی، بهترین حرکت‌ها اول بررسی می‌شوند (هر چه زودتر هرس، سریع‌تر)
			ordered = [...scores].sort((a, b) => b.score - a.score).map((s) => s.move);
		}

		if (searcher.truncated) break;
		if (Math.abs(localBestScore) > MATE_SCORE - 100) break; // مات پیدا شد
	}

	if (!best.move) return { ...best, nodes: searcher.nodes, truncated: searcher.truncated };
	return { ...best, nodes: searcher.nodes, truncated: searcher.truncated };
}

/** سطوح سختی؛ هر سطح یک بودجه‌ی گره دارد تا هیچ‌وقت Worker را قفل نکند */
export interface LevelConfig {
	depth: number;
	nodeLimit: number;
	/** مقدار نویز (سانتی‌پیاده) برای تنوع در سطوح پایین */
	noise: number;
	label: string;
}

export const ENGINE_LEVELS: Record<number, LevelConfig> = {
	1: { depth: 1, nodeLimit: 4_000, noise: 150, label: 'آسان' },
	2: { depth: 2, nodeLimit: 20_000, noise: 50, label: 'متوسط' },
	3: { depth: 3, nodeLimit: 60_000, noise: 15, label: 'سخت' },
	4: { depth: 4, nodeLimit: 150_000, noise: 0, label: 'استاد' },
};

/** مولد شبه‌تصادفی قطعی (mulberry32) */
export function makeRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * انتخاب حرکت توسط موتور برای یک سطح مشخص.
 * قطعی است: همان وضعیت + همان seed + همان سطح = همان حرکت.
 */
export function chooseMove(pos: Position, level = 2, seed = 0): SearchResult {
	const config = ENGINE_LEVELS[level] ?? ENGINE_LEVELS[2];
	const result = search(pos, { depth: config.depth, nodeLimit: config.nodeLimit });

	if (!result.move || result.rootScores.length === 0) return result;

	if (config.noise <= 0) return result;

	const random = makeRandom(seed ^ (pos.board.reduce((acc, p) => acc + p, 0) & 0xffff));
	const candidates = result.rootScores.filter((s) => s.score >= result.score - config.noise);
	const pick = candidates[Math.floor(random() * candidates.length)] ?? result.rootScores[0];
	return { ...result, move: pick.move, score: pick.score };
}
