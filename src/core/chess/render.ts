/**
 * رندر تخته به‌صورت متن، برای نمایش در `<pre>` تلگرام.
 *
 * چرا متن و نه تصویر؟
 *  - بدون فونت، بدون فایل، بدون WASM؛ روی هر کلاینتی و هر دستگاهی کار می‌کند.
 *  - کاربر با یک باکس متنی می‌تواند بازی را کپی/فوروارد کند.
 *  - در تست‌ها با snapshot قابل مقایسه است.
 * تخته عمداً با نمادهای لاتین/یونیکد رندر می‌شود تا در متن راست‌به‌چپ، ستون‌ها به‌هم نریزند.
 */

import type { Color, Position } from './types.js';

const WHITE_SYMBOLS: Record<number, string> = { 1: '♙', 2: '♘', 3: '♗', 4: '♖', 5: '♕', 6: '♔' };
const BLACK_SYMBOLS: Record<number, string> = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };

export const EMPTY_CELL = '·';
export const MOVE_TARGET_CELL = '•';
export const CAPTURE_TARGET_CELL = '×';
export const SELECTED_CELL = '◉';

/** نماد یک خانه؛ `undefined` اگر خالی باشد */
export function pieceSymbol(piece: number): string | undefined {
	if (piece === 0) return undefined;
	const table = piece > 0 ? WHITE_SYMBOLS : BLACK_SYMBOLS;
	return table[Math.abs(piece)];
}

export interface BoardRenderOptions {
	/** از دید کدام رنگ؟ پیش‌فرض سفید */
	perspective?: Color;
	/** خانه‌هایی که مقصد قانونی‌اند (با نشانگر نمایش داده می‌شوند) */
	targets?: number[];
	/** خانه‌ی انتخاب‌شده */
	selected?: number;
	/** نمایش مختصات a-h و 1-8 */
	coords?: boolean;
}

/** خطوط تخته، بدون تگ. برای تست بهتر است از این استفاده شود. */
export function renderBoardLines(pos: Position, options: BoardRenderOptions = {}): string[] {
	const perspective = options.perspective ?? 'w';
	const targets = new Set(options.targets ?? []);
	const files = perspective === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
	const ranks = perspective === 'w' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

	const lines: string[] = [];
	for (const rank of ranks) {
		let line = `${rank + 1} `;
		for (const file of files) {
			const sq = rank * 8 + file;
			const piece = pos.board[sq];
			let cell: string;
			if (sq === options.selected) {
				cell = SELECTED_CELL;
			} else if (piece !== 0) {
				cell = targets.has(sq) ? CAPTURE_TARGET_CELL : (pieceSymbol(piece) as string);
			} else {
				cell = targets.has(sq) ? MOVE_TARGET_CELL : EMPTY_CELL;
			}
			line += `${cell} `;
		}
		lines.push(line.trimEnd());
	}

	if (options.coords !== false) {
		lines.push(`  ${files.map((f) => 'abcdefgh'[f]).join(' ')}`);
	}
	return lines;
}

/** تخته‌ی آماده برای درج در `<pre>` */
export function renderBoardText(pos: Position, options: BoardRenderOptions = {}): string {
	return renderBoardLines(pos, options).join('\n');
}

/** توضیح نوبت به فارسی */
export function describeTurn(pos: Position, check: boolean, whiteLabel = 'شما'): string {
	const side = pos.turn === 'w' ? 'سفید' : 'سیاه';
	const owner = pos.turn === 'w' ? whiteLabel : whiteLabel === 'شما' ? 'حریف' : 'بازیکن دوم';
	return `نوبت ${side} (${owner})${check ? ' — کیش!' : ''}`;
}
