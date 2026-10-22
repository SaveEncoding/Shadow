/**
 * ساخت PGN از تاریخچه‌ی SAN.
 * عمداً «خواندن» PGN پیاده نشده؛ فعلاً فقط خروجی لازم داریم (آرشیو بازی + فایل قابل ارسال).
 */

import type { GameResult } from './types.js';

export interface PgnOptions {
	/** حرکات به ترتیب، به‌صورت SAN */
	moves: string[];
	result: GameResult | '*';
	white?: string;
	black?: string;
	event?: string;
	site?: string;
	/** تاریخ به شکل YYYY.MM.DD */
	date?: string;
	/** FEN شروع، اگر بازی از وضعیت غیراستاندارد شروع شده باشد */
	startFen?: string;
	/** خط‌های کامنت، مثلاً «سطح: سخت» */
	comments?: string[];
	/** حداکثر طول خط (استاندارد PGN: ۸۰ کاراکتر) */
	lineWidth?: number;
}

function escapeTagValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** بخش هدر PGN (هفت تگ اجباری + اختیاری‌ها) */
export function pgnHeaders(options: PgnOptions): string[] {
	const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
	const headers = [
		['Event', options.event ?? 'Shadow Chess'],
		['Site', options.site ?? 'Telegram'],
		['Date', date],
		['Round', '-'],
		['White', options.white ?? 'White'],
		['Black', options.black ?? 'Black'],
		['Result', options.result],
	];
	if (options.startFen) {
		headers.push(['SetUp', '1'], ['FEN', options.startFen]);
	}
	return headers.map(([key, value]) => `[${key} "${escapeTagValue(String(value))}"]`);
}

/**
 * بدنه‌ی حرکات: شماره‌گذاری PGN و شکستن خط در `lineWidth` کاراکتر.
 * شماره‌ی حرکت و حرکت سفید یک «اتم» جدا‌نشدنی‌اند تا شماره در انتهای خط جا نماند.
 */
export function pgnMoveText(moves: string[], result: GameResult | '*', lineWidth = 80): string {
	if (moves.length === 0) return result;

	const atoms: string[] = [];
	for (let i = 0; i < moves.length; i++) {
		// فقط حرکت سفید شماره می‌گیرد؛ «n...» تنها وقتی لازم است که نوبت سیاه شروع شود.
		atoms.push(i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${moves[i]}` : moves[i]);
	}
	atoms.push(result);

	const lines: string[] = [];
	let current = '';
	for (const atom of atoms) {
		if (current === '') current = atom;
		else if (current.length + 1 + atom.length <= lineWidth) current += ` ${atom}`;
		else {
			lines.push(current);
			current = atom;
		}
	}
	if (current) lines.push(current);
	return lines.join('\n');
}

export function buildPgn(options: PgnOptions): string {
	const parts = [...pgnHeaders(options)];
	if (options.comments?.length) {
		for (const comment of options.comments) parts.push(`{ ${comment.replace(/[{}]/g, '')} }`);
	}
	parts.push('', pgnMoveText(options.moves, options.result, options.lineWidth));
	return parts.join('\n') + '\n';
}
