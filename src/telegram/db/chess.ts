/**
 * ذخیره‌سازی بازی‌های شطرنج در D1.
 *
 * قرارداد: هر چت حداکثر **یک** بازی فعال دارد. شروع بازی جدید، بازی قبلی را
 * `abandoned` می‌کند تا هیچ‌وقت دو تخته‌ی فعال در یک چت نداشته باشیم.
 *
 * نوشتن با «شرط fen فعلی» انجام می‌شود (optimistic concurrency): اگر کاربر
 * دو بار سریع روی یک مهره بزند، یکی از دو درخواست موفق می‌شود و دیگری
 * `{ updated: false }` می‌گیرد — به‌جای اینکه یک حرکت روی دیگری بنویسد.
 */

import { START_FEN } from '../../core/chess/fen.js';
import type { GameRecord } from '../../core/chess/index.js';
import type { GameEndReason, GameResult } from '../../core/chess/types.js';
import type { ChessGameRow } from './rows.js';

/** یک بازی که UI و فیچر شطرنج با آن کار می‌کنند (نام‌ها camelCase، لایه‌ی دامنه) */
export interface StoredGame {
	id: number;
	chatId: number;
	userId: number;
	mode: 'engine' | 'local';
	level: number;
	seed: number;
	game: GameRecord;
}

export interface StartGameOptions {
	chatId: number;
	userId: number;
	mode?: 'engine' | 'local';
	level?: number;
	seed?: number;
	startFen?: string;
}

export async function startGame(
	db: D1Database,
	{ chatId, userId, mode = 'engine', level = 2, seed = 0, startFen = START_FEN }: StartGameOptions,
): Promise<StoredGame> {
	await db
		.prepare("UPDATE chess_games SET status = 'abandoned', updated_at = CURRENT_TIMESTAMP WHERE chat_id = ? AND status = 'active'")
		.bind(chatId)
		.run();

	const result = await db
		.prepare(
			`INSERT INTO chess_games (chat_id, user_id, mode, level, seed, start_fen, fen, moves, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'active')`,
		)
		.bind(chatId, userId, mode, level, seed, startFen, startFen)
		.run();

	return {
		id: Number(result.meta?.last_row_id),
		chatId,
		userId,
		mode,
		level,
		seed,
		game: { startFen, fen: startFen, moves: [], result: null, reason: null },
	};
}

const GAME_RESULTS: readonly GameResult[] = ['1-0', '0-1', '1/2-1/2'];
const GAME_END_REASONS: readonly GameEndReason[] = [
	'checkmate',
	'stalemate',
	'insufficient-material',
	'fifty-move',
	'threefold',
	'resignation',
	'timeout',
	'agreement',
];

/**
 * اعتبارسنجی مقدار متنی دیتابیس به‌جای cast کور.
 * مقدار ناشناخته (ردیف دست‌کاری‌شده یا نسخه‌ی قدیمی‌تر) `null` می‌شود، که همان
 * رفتار «بازی تمام‌نشده» است — بهتر از پرتاب خطا در وسط رندر صفحه.
 */
function toResult(raw: string | null): GameResult | null {
	return raw != null && (GAME_RESULTS as readonly string[]).includes(raw) ? (raw as GameResult) : null;
}

function toReason(raw: string | null): GameEndReason | null {
	return raw != null && (GAME_END_REASONS as readonly string[]).includes(raw) ? (raw as GameEndReason) : null;
}

/** ردیف D1 ← شیء دامنه (SQLite رشته/عدد برمی‌گرداند، دامنه نوع اتحادی می‌خواهد) */
function rowToGame(row: ChessGameRow | null): StoredGame | null {
	if (!row) return null;
	return {
		id: Number(row.id),
		chatId: Number(row.chat_id),
		userId: Number(row.user_id),
		mode: row.mode === 'local' ? 'local' : 'engine',
		level: Number(row.level),
		seed: Number(row.seed),
		game: {
			startFen: String(row.start_fen),
			fen: String(row.fen),
			moves: parseMoves(row.moves),
			result: toResult(row.result),
			reason: toReason(row.reason),
		},
	};
}

function parseMoves(raw: unknown): string[] {
	if (typeof raw !== 'string' || raw.length === 0) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		// ردیف خراب نباید کل فیچر را بخواباند؛ مثل بازی بدون حرکت رفتار می‌کنیم.
		return [];
	}
}

/** بازی فعال یک چت (یا null) */
export async function getActiveGame(db: D1Database, chatId: number): Promise<StoredGame | null> {
	const row = await db
		.prepare("SELECT * FROM chess_games WHERE chat_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
		.bind(chatId)
		.first<ChessGameRow>();
	return rowToGame(row);
}

export async function getGame(db: D1Database, id: number): Promise<StoredGame | null> {
	const row = await db.prepare('SELECT * FROM chess_games WHERE id = ?').bind(id).first<ChessGameRow>();
	return rowToGame(row);
}

/**
 * ذخیره‌ی وضعیت جدید. اگر `expectedFen` داده شود، فقط وقتی می‌نویسد که
 * ردیف هنوز همان وضعیت را داشته باشد.
 *
 * @returns آیا نوشته شد؟
 */
export async function saveGame(db: D1Database, id: number, game: GameRecord, expectedFen?: string): Promise<boolean> {
	const result = expectedFen
		? await db
				.prepare(
					`UPDATE chess_games
					 SET fen = ?, moves = ?, result = ?, reason = ?, updated_at = CURRENT_TIMESTAMP
					 WHERE id = ? AND fen = ?`,
				)
				.bind(game.fen, JSON.stringify(game.moves), game.result, game.reason, id, expectedFen)
				.run()
		: await db
				.prepare(
					`UPDATE chess_games
					 SET fen = ?, moves = ?, result = ?, reason = ?, updated_at = CURRENT_TIMESTAMP
					 WHERE id = ?`,
				)
				.bind(game.fen, JSON.stringify(game.moves), game.result, game.reason, id)
				.run();

	return Number(result.meta?.changes ?? 0) > 0;
}

/**
 * بستن بازی (پایان یا رها شدن).
 *
 * @param expectedFen اگر داده شود، فقط وقتی می‌نویسد که وضعیت هنوز همان باشد
 */
export async function closeGame(
	db: D1Database,
	id: number,
	game: GameRecord,
	status: 'finished' | 'abandoned' = 'finished',
	expectedFen?: string,
): Promise<boolean> {
	const result = expectedFen
		? await db
				.prepare(
					`UPDATE chess_games
					 SET status = ?, fen = ?, moves = ?, result = ?, reason = ?, updated_at = CURRENT_TIMESTAMP
					 WHERE id = ? AND fen = ?`,
				)
				.bind(status, game.fen, JSON.stringify(game.moves), game.result, game.reason, id, expectedFen)
				.run()
		: await db
				.prepare(
					`UPDATE chess_games
					 SET status = ?, fen = ?, moves = ?, result = ?, reason = ?, updated_at = CURRENT_TIMESTAMP
					 WHERE id = ?`,
				)
				.bind(status, game.fen, JSON.stringify(game.moves), game.result, game.reason, id)
				.run();

	return Number(result.meta?.changes ?? 0) > 0;
}

export interface ChessStats {
	played: number;
	wins: number;
	losses: number;
	draws: number;
}

/** آمار کاربر در حالت بازی با موتور (کاربر همیشه سفید است) */
export async function getChessStats(db: D1Database, userId: number): Promise<ChessStats> {
	const row = await db
		.prepare(
			`SELECT
			   COUNT(*) AS played,
			   SUM(CASE WHEN result = '1-0' THEN 1 ELSE 0 END) AS wins,
			   SUM(CASE WHEN result = '0-1' THEN 1 ELSE 0 END) AS losses,
			   SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws
			 FROM chess_games
			 WHERE user_id = ? AND mode = 'engine' AND status = 'finished'`,
		)
		.bind(userId)
		.first<{ played: number | null; wins: number | null; losses: number | null; draws: number | null }>();

	return {
		played: Number(row?.played ?? 0),
		wins: Number(row?.wins ?? 0),
		losses: Number(row?.losses ?? 0),
		draws: Number(row?.draws ?? 0),
	};
}
