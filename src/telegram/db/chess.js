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

/** @typedef {import('../../core/chess/index.js').GameRecord} GameRecord */
/** @typedef {import('../../core/chess/types.js').GameResult} GameResult */
/** @typedef {import('../../core/chess/types.js').GameEndReason} GameEndReason */
/** @typedef {{ id: number, chatId: number, userId: number, mode: 'engine'|'local', level: number, seed: number, game: GameRecord }} StoredGame */

/**
 * @param {D1Database} db
 * @param {{ chatId: number, userId: number, mode?: 'engine'|'local', level?: number, seed?: number, startFen?: string }} options
 * @returns {Promise<StoredGame>}
 */
export async function startGame(db, { chatId, userId, mode = 'engine', level = 2, seed = 0, startFen = START_FEN }) {
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
		game: /** @type {GameRecord} */ ({ startFen, fen: startFen, moves: [], result: null, reason: null }),
	};
}

/**
 * ردیف D1 ← شیء دامنه.
 * تنها جای مجاز برای cast: مرز دیتابیس (SQLite رشته برمی‌گرداند، دامنه نوع اتحادی می‌خواهد).
 * @param {any} row
 * @returns {StoredGame|null}
 */
function rowToGame(row) {
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
			result: /** @type {GameResult|null} */ (row.result ? String(row.result) : null),
			reason: /** @type {GameEndReason|null} */ (row.reason ? String(row.reason) : null),
		},
	};
}

/** @param {unknown} raw */
function parseMoves(raw) {
	if (typeof raw !== 'string' || raw.length === 0) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		// ردیف خراب نباید کل فیچر را بخواباند؛ مثل بازی بدون حرکت رفتار می‌کنیم.
		return [];
	}
}

/**
 * بازی فعال یک چت (یا null).
 * @param {D1Database} db
 * @param {number} chatId
 */
export async function getActiveGame(db, chatId) {
	const row = await db
		.prepare("SELECT * FROM chess_games WHERE chat_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
		.bind(chatId)
		.first();
	return rowToGame(row);
}

/**
 * @param {D1Database} db
 * @param {number} id
 */
export async function getGame(db, id) {
	const row = await db.prepare('SELECT * FROM chess_games WHERE id = ?').bind(id).first();
	return rowToGame(row);
}

/**
 * ذخیره‌ی وضعیت جدید. اگر `expectedFen` داده شود، فقط وقتی می‌نویسد که
 * ردیف هنوز همان وضعیت را داشته باشد.
 *
 * @param {D1Database} db
 * @param {number} id
 * @param {GameRecord} game
 * @param {string} [expectedFen]
 * @returns {Promise<boolean>} آیا نوشته شد؟
 */
export async function saveGame(db, id, game, expectedFen) {
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
 * @param {D1Database} db
 * @param {number} id
 * @param {GameRecord} game
 * @param {'finished'|'abandoned'} [status]
 * @param {string} [expectedFen] اگر داده شود، فقط وقتی می‌نویسد که وضعیت هنوز همان باشد
 * @returns {Promise<boolean>}
 */
export async function closeGame(db, id, game, status = 'finished', expectedFen) {
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

/**
 * آمار کاربر در حالت بازی با موتور (کاربر همیشه سفید است).
 * @param {D1Database} db
 * @param {number} userId
 * @returns {Promise<{ played: number, wins: number, losses: number, draws: number }>}
 */
export async function getChessStats(db, userId) {
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
		.first();

	return {
		played: Number(row?.played ?? 0),
		wins: Number(row?.wins ?? 0),
		losses: Number(row?.losses ?? 0),
		draws: Number(row?.draws ?? 0),
	};
}
