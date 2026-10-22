/**
 * فیچر شطرنج (تلگرام).
 *
 * الگوی callback_data:
 *   cg:h                     → خانه‌ی شطرنج
 *   cg:l:<level>             → شروع بازی جدید (0 = دو نفره، 1..4 = سطح موتور)
 *   cg:resume                → ادامه‌ی بازی فعال
 *   cg:s:<sq>                → انتخاب مهره
 *   cg:m:<from>-<to>         → اجرای حرکت
 *   cg:pr:<from>-<to>-<type> → اجرای حرکت با ترفیع
 *   cg:u                     → بازگشت (undo)
 *   cg:r                     → استعفا
 *   cg:p                     → دریافت PGN
 *   cg:stats                 → آمار
 *   cg:x                     → لغو انتخاب
 *
 * نکته‌ی معماری: هیچ حالت «انتخاب مهره» در سرور ذخیره نمی‌شود؛ `from` و `to`
 * داخل callback_data هستند. پس دو کاربر هم‌زمان (یا دو isolate) با هم تداخل ندارند.
 */

import { InlineKeyboard, InputFile } from 'grammy';
import {
	ENGINE_LEVELS,
	IllegalMoveError,
	applyUserMove,
	chooseMove,
	currentStatus,
	finishGame,
	gameToPgn,
	legalMoves,
	positionOf,
	takeBack,
} from '../../core/chess/index.js';
import { closeGame, getActiveGame, getChessStats, saveGame, startGame } from '../db/chess.js';
import { renderScreen, toast, toastAlert } from '../ui/render.js';
import {
	boardKeyboard,
	chessHomeKeyboard,
	chessHomeText,
	chessStatsText,
	gameOverText,
	gameText,
	promotionKeyboard,
} from '../ui/chessScreens.js';

/** @typedef {import('../../core/chess/index.js').GameRecord} GameRecord */
/** @typedef {import('../db/chess.js').StoredGame} StoredGame */

/**
 * شناسه‌ی چت و کاربر برای callback و command.
 * @param {import('grammy').Context} ctx
 */
export function chessContext(ctx) {
	const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat ?? null;
	const user = ctx.from ?? null;
	return {
		chatId: chat?.id ?? user?.id ?? null,
		userId: user?.id ?? null,
		chatType: chat?.type ?? null,
		userName: user?.first_name || user?.username || 'بازیکن',
	};
}

/** آیا امکان بازی در این چت هست؟ (شطرنج در کانال بی‌معناست) */
export function isPlayableChatType(type) {
	return type === 'private' || type === 'group' || type === 'supergroup';
}

/**
 * یک بازی فعال را می‌گیرد و بررسی می‌کند مال همین چت است.
 * @param {D1Database} db
 * @param {number} chatId
 */
export async function loadActiveGame(db, chatId) {
	return (await getActiveGame(db, chatId)) ?? null;
}

/**
 * نوبت موتور را (اگر نوبتش است) بازی می‌کند.
 * انتخاب حرکت **قطعی** است: همان بازی + همان شماره‌ی حرکت = همان پاسخ موتور.
 * @param {{ mode: string, level: number, seed: number, game: GameRecord }} row
 */
export function playEngineTurn(row) {
	if (row.mode !== 'engine') return row;
	if (row.game.result) return row;

	const position = positionOf(row.game);
	if (position.turn !== 'b') return row;

	const { move } = chooseMove(position, row.level, (row.seed + row.game.moves.length * 7919) >>> 0);
	if (!move) return row;

	const outcome = applyUserMove(row.game, move.from, move.to, move.promo);
	return { ...row, game: outcome.game };
}

/**
 * ساخت متن/کیبورد صفحه برای یک ردیف بازی.
 * @param {StoredGame} row
 * @param {{ selected?: number|null, targets?: any[] }} [options]
 */
export function screenFor(row, { selected = null, targets = [] } = {}) {
	const position = positionOf(row.game);
	const status = currentStatus(row.game);

	if (status.over || row.game.result) {
		return {
			text: gameOverText({ position, game: row.game, mode: row.mode }),
			keyboard: new InlineKeyboard()
				.text('♟ بازی جدید', 'cg:n')
				.text('📄 PGN', 'cg:p')
				.row()
				.text('🏠 منو', 'm:h'),
			position,
			status,
		};
	}

	return {
		text: gameText({
			position,
			game: row.game,
			status,
			mode: row.mode,
			level: row.level,
			selected,
			targets,
		}),
		keyboard: boardKeyboard({ position, selected, targets }),
		position,
		status,
	};
}

/**
 * شروع بازی جدید.
 * @param {D1Database} db
 * @param {{ chatId: number, userId: number, level: number }} options
 */
export async function createGame(db, { chatId, userId, level }) {
	/** @type {'engine'|'local'} */
	const mode = level === 0 ? 'local' : 'engine';
	const seed = Math.abs((chatId ^ (userId * 2654435761)) % 1_000_000);
	return startGame(db, { chatId, userId, mode, level, seed });
}

/**
 * اجرای حرکت و پاسخ موتور، با ذخیره‌ی اتمیک.
 * @returns {Promise<{ ok: boolean, row?: any, san?: string, status?: any, code?: string, message?: string }>}
 */
export async function commitMove(db, row, from, to, promo) {
	let outcome;
	try {
		outcome = applyUserMove(row.game, from, to, promo);
	} catch (err) {
		if (err instanceof IllegalMoveError) {
			return { ok: false, code: err.code, message: err.message };
		}
		throw err;
	}

	const afterUser = { ...row, game: outcome.game };
	const finalRow = outcome.status.over ? afterUser : playEngineTurn(afterUser);

	// اگر بازی تمام شد، ردیف باید از «فعال» خارج شود تا بازی بعدی روی آن سوار نشود.
	const saved = outcome.status.over
		? await closeGame(db, row.id, finalRow.game, 'finished', row.game.fen)
		: await saveGame(db, row.id, finalRow.game, row.game.fen);
	if (!saved) {
		// کسی دیگر زودتر این وضعیت را نوشته است (دو کلیک سریع)
		return { ok: false, code: 'stale', message: 'این حرکت ثبت نشد؛ صفحه به‌روز شد.' };
	}

	return { ok: true, row: finalRow, san: outcome.san, status: currentStatus(finalRow.game) };
}

/** پیام فارسی برای خطاهای حرکت */
export function illegalMoveMessage(code) {
	switch (code) {
		case 'no-piece':
			return 'مهره‌ای از نوبت شما در این خانه نیست.';
		case 'promotion-required':
			return 'مهره‌ی ترفیع را انتخاب کنید.';
		case 'game-over':
			return 'این بازی تمام شده است.';
		case 'stale':
			return 'این حرکت ثبت نشد؛ صفحه به‌روز شد.';
		default:
			return 'این حرکت مجاز نیست.';
	}
}

/**
 * ثبت فیچر روی بات.
 * @param {import('grammy').Bot} bot
 * @param {{ my_database: D1Database }} env
 */
export function chessFeature(bot, env) {
	const db = env.my_database;

	/** @param {import('grammy').Context} ctx */
	const openHome = async (ctx) => {
		const { chatId, userId, chatType } = chessContext(ctx);
		if (!isPlayableChatType(chatType)) {
			return renderScreen(ctx, '♟ شطرنج فقط در چت خصوصی یا گروه قابل بازی است.');
		}
		const [stats, activeGame] = await Promise.all([
			userId ? getChessStats(db, userId) : Promise.resolve(null),
			chatId ? loadActiveGame(db, chatId) : Promise.resolve(null),
		]);
		return renderScreen(ctx, chessHomeText({ stats, activeGame }), chessHomeKeyboard({ activeGame }));
	};

	bot.command('chess', openHome);
	bot.command('sh', openHome);
	bot.callbackQuery('cg:h', openHome);

	bot.callbackQuery('cg:stats', async (ctx) => {
		const { userId } = chessContext(ctx);
		const stats = userId ? await getChessStats(db, userId) : null;
		if (!stats) return toast(ctx, 'آماری موجود نیست.');
		return renderScreen(
			ctx,
			chessStatsText(stats),
			new InlineKeyboard().text('🔙 بازگشت', 'cg:h'),
		);
	});

	bot.callbackQuery('cg:n', openHome);

	bot.callbackQuery(/^cg:l:(\d)$/, async (ctx) => {
		const { chatId, userId, chatType } = chessContext(ctx);
		if (!chatId || !userId) return toast(ctx, 'شناسه‌ی کاربر پیدا نشد.');
		if (!isPlayableChatType(chatType)) return toast(ctx, 'در این چت نمی‌شود بازی کرد.');

		const level = Number(ctx.match[1]);
		if (level !== 0 && !ENGINE_LEVELS[level]) return toast(ctx, 'سطح نامعتبر است.');

		const row = await createGame(db, { chatId, userId, level });
		const screen = screenFor(row);
		return renderScreen(ctx, screen.text, screen.keyboard);
	});

	bot.callbackQuery('cg:resume', async (ctx) => {
		const { chatId } = chessContext(ctx);
		const row = chatId ? await loadActiveGame(db, chatId) : null;
		if (!row) return toast(ctx, 'بازی فعالی ندارید.');
		const screen = screenFor(row);
		return renderScreen(ctx, screen.text, screen.keyboard);
	});

	bot.callbackQuery('cg:x', async (ctx) => {
		const { chatId } = chessContext(ctx);
		const row = chatId ? await loadActiveGame(db, chatId) : null;
		if (!row) return toast(ctx, 'بازی فعالی ندارید.');
		const screen = screenFor(row);
		return renderScreen(ctx, screen.text, screen.keyboard);
	});

	bot.callbackQuery(/^cg:s:(\d{1,2})$/, async (ctx) => {
		const { chatId } = chessContext(ctx);
		const row = chatId ? await loadActiveGame(db, chatId) : null;
		if (!row) return toast(ctx, 'بازی فعالی ندارید؛ یک بازی جدید شروع کنید.');

		const square = Number(ctx.match[1]);
		const position = positionOf(row.game);
		const piece = position.board[square];
		const mine = piece !== 0 && (piece > 0) === (position.turn === 'w');

		if (!mine) return toast(ctx, 'این مهره از نوبت شما نیست.');

		const targets = legalMoves(position).filter((m) => m.from === square);
		if (targets.length === 0) return toast(ctx, 'این مهره حرکت قانونی ندارد.');

		const screen = screenFor(row, { selected: square, targets });
		return renderScreen(ctx, screen.text, screen.keyboard);
	});

	/**
	 * @param {import('grammy').Context} ctx
	 * @param {number} from
	 * @param {number} to
	 * @param {number|undefined} promo
	 */
	const executeMove = async (ctx, from, to, promo) => {
		const { chatId } = chessContext(ctx);
		const row = chatId ? await loadActiveGame(db, chatId) : null;
		if (!row) return toast(ctx, 'بازی فعالی ندارید.');

		const result = await commitMove(db, row, from, to, promo);
		if (!result.ok) {
			// code همیشه برای شکست پر است؛ برای TS صریح می‌نویسیم
			if (result.code === 'promotion-required') {
				return renderScreen(ctx, '♻️ <b>ترفیع</b>\n\nمهره‌ای که پیاده به آن تبدیل می‌شود را انتخاب کنید.', promotionKeyboard(from, to));
			}
			return toast(ctx, illegalMoveMessage(result.code));
		}

		const screen = screenFor(result.row);
		return renderScreen(ctx, screen.text, screen.keyboard);
	};

	bot.callbackQuery(/^cg:m:(\d{1,2})-(\d{1,2})$/, async (ctx) => {
		await executeMove(ctx, Number(ctx.match[1]), Number(ctx.match[2]), undefined);
	});

	bot.callbackQuery(/^cg:pr:(\d{1,2})-(\d{1,2})-(\d)$/, async (ctx) => {
		await executeMove(ctx, Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3]));
	});

	bot.callbackQuery('cg:u', async (ctx) => {
		const { chatId } = chessContext(ctx);
		const row = chatId ? await loadActiveGame(db, chatId) : null;
		if (!row) return toast(ctx, 'بازی فعالی ندارید.');
		if (row.game.moves.length === 0) return toast(ctx, 'هنوز حرکتی انجام نشده است.');

		// در حالت موتور، بازگشت باید هر دو نیم‌حرکت (حرکت شما و پاسخ موتور) را برگرداند.
		const plies = row.mode === 'engine' && row.game.moves.length >= 2 ? 2 : 1;
		const rewound = takeBack(row.game, plies);
		const saved = await saveGame(db, row.id, rewound, row.game.fen);
		if (!saved) return toast(ctx, 'بازگشت ثبت نشد؛ صفحه به‌روز شد.');

		const screen = screenFor({ ...row, game: rewound });
		return renderScreen(ctx, screen.text, screen.keyboard);
	});

	bot.callbackQuery('cg:r', async (ctx) => {
		const { chatId } = chessContext(ctx);
		const row = chatId ? await loadActiveGame(db, chatId) : null;
		if (!row) return toast(ctx, 'بازی فعالی ندارید.');
		if (row.game.result) return toast(ctx, 'این بازی تمام شده است.');

		const position = positionOf(row.game);
		// در حالت دو نفره، «استعفا» به معنی تسلیم بازیکنی است که نوبتش است.
		/** @type {'0-1'|'1-0'} */
		const result = position.turn === 'w' ? '0-1' : '1-0';
		const finished = finishGame(row.game, result, 'resignation');
		await closeGame(db, row.id, finished, 'finished');

		const screen = screenFor({ ...row, game: finished });
		return renderScreen(ctx, screen.text, screen.keyboard);
	});

	bot.callbackQuery('cg:p', async (ctx) => {
		const { chatId, userName } = chessContext(ctx);
		const row = chatId ? await loadActiveGame(db, chatId) : null;
		if (!row) return toast(ctx, 'بازی فعالی ندارید.');

		const pgn = gameToPgn(row.game, {
			white: row.mode === 'engine' ? userName : 'سفید',
			black: row.mode === 'engine' ? `Shadow (${ENGINE_LEVELS[row.level]?.label ?? 'موتور'})` : 'سیاه',
			level: row.level || undefined,
		});

		if (pgn.length <= 3_500) {
			await ctx.reply(`<pre>${escapeHtml(pgn)}</pre>`, {
				parse_mode: 'HTML',
				reply_markup: new InlineKeyboard().text('🔙 بازگشت به بازی', 'cg:resume'),
			});
			return toast(ctx, 'PGN ارسال شد.');
		}

		// grammY در Workers می‌تواند Uint8Array را مستقیم به multipart تبدیل کند.
		await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(pgn), 'shadow-chess.pgn'), {
			caption: '📄 PGN این بازی',
		});
		return toast(ctx, 'PGN ارسال شد.');
	});

	// گزارش خطای غیرمنتظره به کاربر، بدون شکستن حلقه‌ی بات
	bot.callbackQuery(/^cg:/, async (ctx) => {
		try {
			await toastAlert(ctx, 'این گزینه در دسترس نیست.');
		} catch {
			/* ignore */
		}
	});
}

function escapeHtml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
