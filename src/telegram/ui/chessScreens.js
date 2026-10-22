/**
 * صفحه‌های شطرنج: متن و کیبورد.
 *
 * این فایل «دنیای تلگرام» است (grammy + نمادهای یونیکد)، اما هیچ دسترسی به دیتابیس
 * یا API ندارد؛ ورودی‌اش همان `GameRecord` و `GameStatus` خالص است. به همین دلیل
 * بدون شبیه‌سازی تلگرام تست می‌شود.
 */

import { InlineKeyboard } from 'grammy';
import {
	CAPTURE_TARGET_CELL,
	EMPTY_CELL,
	ENGINE_LEVELS,
	MOVE_TARGET_CELL,
	pieceSymbol,
	renderBoardLines,
	squareName,
} from '../../core/chess/index.js';

/**
 * نمای ساختاری یک بازی — عمداً نه خودِ `GameRecord` تایپ‌شده‌ی هسته،
 * تا ردیف‌های D1 (که رشته برمی‌گردانند) بدون cast بپذیریم.
 * @typedef {{ startFen: string, fen: string, moves: string[], result: string|null, reason: string|null }} GameLike
 */

export const LEVEL_ICONS = { 1: '🙂', 2: '🤖', 3: '😈', 4: '🐉' };
export const EMPTY_BUTTON = '·';

const REASON_LABELS = {
	checkmate: 'مات',
	stalemate: 'پات',
	'insufficient-material': 'مهره‌ی کافی برای مات نیست',
	'fifty-move': 'قاعده‌ی ۵۰ حرکت',
	threefold: 'تکرار سه‌باره',
	resignation: 'استعفا',
	timeout: 'اتمام وقت',
	agreement: 'توافق دو طرف',
};

/** @param {string|null} reason */
export function reasonLabel(reason) {
	return reason ? (REASON_LABELS[reason] ?? 'پایان بازی') : 'پایان بازی';
}

/** @param {string|null} result @param {string} mode */
export function winnerLabel(result, mode) {
	if (result === '1/2-1/2') return 'مساوی';
	if (result === '1-0') return mode === 'engine' ? 'شما' : 'سفید';
	if (result === '0-1') return mode === 'engine' ? 'موتور' : 'سیاه';
	return '—';
}

/** @param {number} level */
export function levelLabel(level) {
	const config = ENGINE_LEVELS[level] ?? ENGINE_LEVELS[2];
	return `${LEVEL_ICONS[level] ?? '🤖'} ${config.label}`;
}

/**
 * خلاصه‌ی تاریخچه‌ی حرکات برای نمایش زیر تخته.
 * @param {string[]} moves
 * @param {number} [maxPlies]
 */
export function moveHistoryLine(moves, maxPlies = 10) {
	if (moves.length === 0) return 'هنوز حرکتی انجام نشده است.';
	const shown = moves.slice(-maxPlies);
	const startNumber = Math.floor((moves.length - shown.length) / 2) + 1;
	const parts = shown.map((san, index) => {
		const absolute = moves.length - shown.length + index;
		return absolute % 2 === 0 ? `${Math.floor(absolute / 2) + 1}. ${san}` : san;
	});
	return `آخرین حرکات: ${parts.join(' ')}${startNumber > 1 ? ' …' : ''}`;
}

/**
 * تخته به‌صورت متن `<pre>` — از دید سفید (همیشه).
 * @param {import('../../core/chess/types.js').Position} position
 * @param {number[]} [targets]
 * @param {number|null} [selected]
 */
export function boardText(position, targets = [], selected = null) {
	const lines = renderBoardLines(position, { perspective: 'w', targets, selected: selected ?? undefined });
	return `<pre>${lines.join('\n')}</pre>`;
}

/**
 * متن صفحه‌ی بازی.
 * @param {{ position: import('../../core/chess/types.js').Position, game: GameLike, status: { over: boolean, check: boolean }, mode: string, level: number, selected?: number|null, targets?: any[] }} input
 */
export function gameText({ position, game, status, mode, level, selected = null, targets = [] }) {
	const header =
		mode === 'engine'
			? `♟ <b>شطرنج</b> — ${levelLabel(level)}`
			: '♟ <b>شطرنج</b> — دو نفره';

	const moveNumber = Math.floor(game.moves.length / 2) + 1;
	const side = position.turn === 'w' ? 'سفید' : 'سیاه';
	const owner =
		mode === 'engine' ? (position.turn === 'w' ? '<b>شما</b>' : 'موتور') : `<b>${side}</b>`;

	// توجه: `targets` مجموعه‌ی حرکت‌هاست؛ برای تخته فقط «خانه‌ی مقصد» لازم است.
	const targetSquares = targets.map((move) => move.to);
	const lines = [
		`${header} · حرکت ${moveNumber}`,
		`نوبت ${owner} (${side})`,
		'',
		boardText(position, targetSquares, selected),
	];

	if (status.check) lines.push('⚠️ <b>کیش!</b>');
	lines.push('', `<i>${moveHistoryLine(game.moves)}</i>`);

	const selectedLabel =
		selected !== null && position.board[selected] !== 0
			? `${pieceSymbol(position.board[selected])} ${squareName(selected)}`
			: null;

	if (selected !== null && targets.length > 0) {
		lines.push('', `👆 انتخاب: <b>${selectedLabel}</b> — خانه‌ی مقصد را از کیبورد بزنید.`);
	} else if (selected !== null) {
		lines.push('', 'این مهره حرکت قانونی ندارد؛ مهره‌ی دیگری را انتخاب کنید.');
	} else {
		lines.push('', '<i>یک مهره را بزنید، بعد خانه‌ی مقصد.</i>');
	}

	return lines.join('\n');
}

/** متن پایان بازی */
export function gameOverText({ position, game, mode }) {
	const result = game.result ?? '1/2-1/2';
	const winner = winnerLabel(result, mode);
	const reason = reasonLabel(game.reason);
	const headline = result === '1/2-1/2' ? '🤝 <b>مساوی</b>' : `🏁 <b>پایان بازی</b> — برنده: ${winner}`;

	return [
		headline,
		`دلیل: ${reason}${reason === 'مات' ? '' : ''}`,
		`نتیجه‌ی رسمی: <code>${result}</code>`,
		'',
		boardText(position),
		'',
		`<i>${moveHistoryLine(game.moves, 16)}</i>`,
	]
		.filter(Boolean)
		.join('\n');
}

/**
 * کیبورد تخته: شبکه‌ی ۸×۸.
 * هر خانه یا «انتخاب مهره» است یا (اگر مقصد قانونی باشد) «اجرای حرکت».
 * چون `from` و `to` داخل callback_data هستند، هیچ حالت انتخابی‌ای در سرور ذخیره نمی‌شود.
 *
 * @param {{ position: import('../../core/chess/types.js').Position, selected?: number|null, targets?: import('../../core/chess/types.js').Move[] }} input
 */
export function boardKeyboard({ position, selected = null, targets = [] }) {
	const kb = new InlineKeyboard();
	const targetMap = new Map(targets.map((move) => [move.to, move]));

	for (let rank = 7; rank >= 0; rank--) {
		for (let file = 0; file < 8; file++) {
			const square = rank * 8 + file;
			const piece = position.board[square];
			const target = targetMap.get(square);

			if (target && selected !== null) {
				const isCapture = target.captured !== 0 || target.ep === true;
				kb.text(isCapture ? CAPTURE_TARGET_CELL : MOVE_TARGET_CELL, `cg:m:${selected}-${square}`);
			} else if (square === selected) {
				kb.text('◉', `cg:x`);
			} else {
				kb.text(piece !== 0 ? pieceSymbol(piece) : EMPTY_CELL, `cg:s:${square}`);
			}
			if (file === 7 && rank > 0) kb.row();
		}
	}

	kb.row().text('↩️ بازگشت', 'cg:u').text('🏳 استعفا', 'cg:r').text('📄 PGN', 'cg:p');
	kb.row().text('♟ بازی جدید', 'cg:n').text('🏠 منو', 'm:h');
	return kb;
}

/** کیبورد انتخاب مهره‌ی ترفیع */
export function promotionKeyboard(from, to) {
	return new InlineKeyboard()
		.text('♕ وزیر', `cg:pr:${from}-${to}-5`)
		.text('♖ رخ', `cg:pr:${from}-${to}-4`)
		.text('♗ فیل', `cg:pr:${from}-${to}-3`)
		.text('♘ اسب', `cg:pr:${from}-${to}-2`);
}

/** صفحه‌ی خانه‌ی شطرنج */
export function chessHomeText({ stats, activeGame }) {
	const lines = [
		'♟ <b>شطرنج</b>',
		'',
		'یک حالت بازی انتخاب کنید:',
		'• 🤖 <b>با موتور</b> — چهار سطح سختی',
		'• 👥 <b>دو نفره</b> — روی یک صفحه، مناسب گروه‌ها',
	];

	if (activeGame) {
		const moveNumber = Math.floor(activeGame.game.moves.length / 2) + 1;
		lines.push('', `▶️ یک بازی نیمه‌تمام دارید (حرکت ${moveNumber}).`);
	}

	if (stats && stats.played > 0) {
		lines.push(
			'',
			`🏆 برد: <b>${stats.wins}</b> • 🤝 مساوی: <b>${stats.draws}</b> • 💀 باخت: <b>${stats.losses}</b>`,
		);
	}

	return lines.join('\n');
}

/**
 * کیبورد خانه‌ی شطرنج
 * @param {{ activeGame?: any }} [options]
 */
export function chessHomeKeyboard({ activeGame } = {}) {
	const kb = new InlineKeyboard();
	if (activeGame) kb.text('▶️ ادامه‌ی بازی', 'cg:resume').row();
	kb.text(`${LEVEL_ICONS[1]} ${ENGINE_LEVELS[1].label}`, 'cg:l:1')
		.text(`${LEVEL_ICONS[2]} ${ENGINE_LEVELS[2].label}`, 'cg:l:2')
		.row()
		.text(`${LEVEL_ICONS[3]} ${ENGINE_LEVELS[3].label}`, 'cg:l:3')
		.text(`${LEVEL_ICONS[4]} ${ENGINE_LEVELS[4].label}`, 'cg:l:4')
		.row()
		.text('👥 دو نفره', 'cg:l:0')
		.row()
		.text('📊 آمار', 'cg:stats')
		.text('🏠 منو', 'm:h');
	return kb;
}

/** صفحه‌ی آمار */
export function chessStatsText(stats) {
	return [
		'📊 <b>آمار شطرنج شما</b>',
		'',
		`تعداد بازی: <b>${stats.played}</b>`,
		`برد: <b>${stats.wins}</b>`,
		`مساوی: <b>${stats.draws}</b>`,
		`باخت: <b>${stats.losses}</b>`,
	].join('\n');
}

/** @param {import('../../core/chess/types.js').GameEndReason|null} reason */
export function describeEnd(reason) {
	return reasonLabel(reason);
}
