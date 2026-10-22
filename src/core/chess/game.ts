/**
 * لایه‌ی «بازی» — وضعیت یک بازی کامل، مستقل از تلگرام و دیتابیس.
 *
 * تصمیم طراحی: تنها چیزی که ذخیره می‌شود `startFen` و لیست حرکت‌های SAN است.
 * هر چیز دیگر (تخته، شمارش تکرار سه‌باره، وضعیت) با بازپخش (replay) بازسازی می‌شود.
 * چرا؟ چون یک منبع حقیقت داریم و امکان «وضعیت ناسازگار» از بین می‌رود؛
 * بازپخش ۱۰۰ حرکت هم زیر یک میلی‌ثانیه است.
 */

import { START_FEN, parseFen, positionKey, toFen } from './fen.js';
import { applyMove } from './make-move.js';
import { legalMoves } from './movegen.js';
import { buildPgn } from './pgn.js';
import { moveToSan } from './san.js';
import { getStatus } from './status.js';
import type { GameEndReason, GameResult, GameStatus, Move, Position } from './types.js';

export type IllegalMoveCode = 'illegal' | 'no-piece' | 'promotion-required' | 'game-over' | 'bad-input';

export class IllegalMoveError extends Error {
	readonly code: IllegalMoveCode;

	constructor(code: IllegalMoveCode, message: string) {
		super(message);
		this.name = 'IllegalMoveError';
		this.code = code;
	}
}

export interface GameRecord {
	startFen: string;
	/** FEN فعلی (کش‌شده برای نمایش؛ منبع حقیقت همان startFen + moves است) */
	fen: string;
	/** حرکت‌ها به ترتیب، در قالب SAN */
	moves: string[];
	/** نتیجه، اگر بازی تمام شده باشد */
	result: GameResult | null;
	reason: GameEndReason | null;
}

export interface ReplayResult {
	position: Position;
	/** کلید وضعیت ← تعداد تکرار (برای قاعده‌ی سه‌بار) */
	counts: Map<string, number>;
}

/** بازپخش حرکت‌ها از وضعیت شروع */
export function replay(startFen: string, moves: readonly string[]): ReplayResult {
	const position = parseFen(startFen);
	const counts = new Map<string, number>();
	counts.set(positionKey(position), 1);

	for (const san of moves) {
		const legal = legalMoves(position);
		const move = legal.find((m) => moveToSan(position, m) === san);
		if (!move) {
			throw new IllegalMoveError('illegal', `حرکت نامعتبر در تاریخچه: ${san}`);
		}
		applyMove(position, move);
		const key = positionKey(position);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return { position, counts };
}

export function newGame(startFen: string = START_FEN): GameRecord {
	const position = parseFen(startFen);
	return { startFen, fen: toFen(position), moves: [], result: null, reason: null };
}

export function positionOf(game: GameRecord): Position {
	return replay(game.startFen, game.moves).position;
}

/** وضعیت فعلی، با در نظر گرفتن تکرار سه‌باره */
export function currentStatus(game: GameRecord): GameStatus {
	const { position, counts } = replay(game.startFen, game.moves);
	if (game.result && game.reason) {
		return {
			over: true,
			result: game.result,
			reason: game.reason,
			winner: game.result === '1-0' ? 'w' : game.result === '0-1' ? 'b' : null,
			check: false,
		};
	}
	return getStatus(position, { repetitionCount: counts.get(positionKey(position)) ?? 1 });
}

/** حرکات قانونی از یک خانه؛ برای هایلایت مقصدها در UI */
export function legalTargetsFrom(game: GameRecord, from: number): Move[] {
	return legalMoves(positionOf(game)).filter((m) => m.from === from);
}

export interface MoveOutcome {
	game: GameRecord;
	san: string;
	status: GameStatus;
	move: Move;
}

/**
 * اجرای حرکت کاربر (از خانه‌ی مبدأ به مقصد).
 * خطاها با `IllegalMoveError` و کد مشخص برمی‌گردند تا UI پیام فارسی مناسب بسازد.
 */
export function applyUserMove(
	game: GameRecord,
	from: number,
	to: number,
	promo?: number,
): MoveOutcome {
	const status = currentStatus(game);
	if (status.over) throw new IllegalMoveError('game-over', 'این بازی تمام شده است');

	const { position } = replay(game.startFen, game.moves);
	const all = legalMoves(position);
	const candidates = all.filter((m) => m.from === from && m.to === to);

	if (candidates.length === 0) {
		if (all.some((m) => m.from === from)) {
			throw new IllegalMoveError('illegal', 'این حرکت برای این مهره مجاز نیست');
		}
		throw new IllegalMoveError('no-piece', 'در این خانه مهره‌ای از نوبت شما نیست');
	}

	let move: Move;
	if (candidates.length > 1) {
		if (!promo) throw new IllegalMoveError('promotion-required', 'مهره‌ی ترفیع را انتخاب کنید');
		const chosen = candidates.find((m) => m.promo === promo);
		if (!chosen) throw new IllegalMoveError('illegal', 'ترفیع به این مهره مجاز نیست');
		move = chosen;
	} else {
		move = candidates[0];
	}

	const san = moveToSan(position, move);
	const next: GameRecord = {
		...game,
		moves: [...game.moves, san],
		result: null,
		reason: null,
	};
	applyMove(position, move);
	next.fen = toFen(position);

	const nextStatus = getStatus(position, {
		repetitionCount: countRepetitions(next),
	});

	return { game: { ...next, result: nextStatus.result, reason: nextStatus.reason }, san, status: nextStatus, move };
}

function countRepetitions(game: GameRecord): number {
	const { position, counts } = replay(game.startFen, game.moves);
	return counts.get(positionKey(position)) ?? 1;
}

/** پایان دادن به بازی به دلیلی خارج از تخته (استعفا، وقت، توافق) */
export function finishGame(game: GameRecord, result: GameResult, reason: GameEndReason): GameRecord {
	return { ...game, result, reason };
}

/** برگرداندن `plies` نیم‌حرکت به عقب */
export function takeBack(game: GameRecord, plies = 1): GameRecord {
	if (plies <= 0) return game;
	const moves = game.moves.slice(0, Math.max(0, game.moves.length - plies));
	const { position } = replay(game.startFen, moves);
	return { ...game, moves, fen: toFen(position), result: null, reason: null };
}

export interface PgnBuildOptions {
	white?: string;
	black?: string;
	level?: number;
	event?: string;
	date?: string;
}

export function gameToPgn(game: GameRecord, options: PgnBuildOptions = {}): string {
	const status = currentStatus(game);
	const result = game.result ?? (status.result || '*');
	const comments: string[] = [];
	if (options.level) comments.push(`level: ${options.level}`);
	return buildPgn({
		moves: game.moves,
		result,
		white: options.white,
		black: options.black,
		event: options.event,
		date: options.date,
		startFen: game.startFen === START_FEN ? undefined : game.startFen,
		comments,
	});
}
