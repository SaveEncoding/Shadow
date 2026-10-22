import { describe, it, expect } from 'vitest';
import {
	boardKeyboard,
	boardText,
	chessHomeKeyboard,
	chessHomeText,
	chessStatsText,
	gameOverText,
	gameText,
	levelLabel,
	moveHistoryLine,
	promotionKeyboard,
	reasonLabel,
	winnerLabel,
} from '../src/telegram/ui/chessScreens.js';
import { newGame, positionOf, currentStatus, applyUserMove } from '../src/core/chess/game.js';
import { parseSquare } from '../src/core/chess/board.js';
import { legalMoves } from '../src/core/chess/movegen.js';

function gameAfter(moves) {
	let game = newGame();
	for (const [from, to] of moves) {
		game = applyUserMove(game, parseSquare(from), parseSquare(to)).game;
	}
	return game;
}

const callbacks = (kb) => kb.inline_keyboard.flat().map((b) => b.callback_data);
const labels = (kb) => kb.inline_keyboard.flat().map((b) => b.text);

describe('home screen', () => {
	it('lists both modes and shows stats when present', () => {
		const text = chessHomeText({ stats: { played: 5, wins: 3, draws: 1, losses: 1 }, activeGame: null });
		expect(text).toContain('با موتور');
		expect(text).toContain('دو نفره');
		expect(text).toContain('برد: <b>3</b>');
	});

	it('offers to resume an unfinished game', () => {
		const activeGame = { game: { moves: ['e4', 'e5'] } };
		const text = chessHomeText({ stats: null, activeGame });
		expect(text).toContain('نیمه‌تمام');
		expect(callbacks(chessHomeKeyboard({ activeGame }))).toContain('cg:resume');
	});

	it('always offers four engine levels and a local mode', () => {
		const kb = chessHomeKeyboard({});
		const data = callbacks(kb);
		for (const level of ['1', '2', '3', '4']) expect(data).toContain(`cg:l:${level}`);
		expect(data).toContain('cg:l:0');
		expect(data).toContain('cg:stats');
		expect(data).toContain('m:h');
	});
});

describe('board keyboard', () => {
	it('renders an 8x8 grid plus two control rows', () => {
		const position = positionOf(newGame());
		const kb = boardKeyboard({ position });
		expect(kb.inline_keyboard).toHaveLength(10);
		expect(kb.inline_keyboard.slice(0, 8).every((row) => row.length === 8)).toBe(true);
	});

	it('keeps every callback_data under the 64-byte Telegram limit', () => {
		const position = positionOf(newGame());
		for (const data of callbacks(boardKeyboard({ position }))) {
			expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
		}
	});

	it('shows piece symbols and lets the user select any square', () => {
		const position = positionOf(newGame());
		const kb = boardKeyboard({ position });
		const cells = kb.inline_keyboard.slice(0, 8).flat();
		// رتبه‌ی هشتم، اولین ردیف است: رخ سیاه
		expect(cells[0].text).toBe('♜');
		expect(cells[0].callback_data).toBe(`cg:s:${parseSquare('a8')}`);
	});

	it('turns legal targets into move buttons carrying from and to', () => {
		const game = newGame();
		const position = positionOf(game);
		const targets = legalMoves(position).filter((m) => m.from === parseSquare('e2'));
		const kb = boardKeyboard({ position, selected: parseSquare('e2'), targets });
		const data = callbacks(kb);
		expect(data).toContain('cg:m:12-20'); // e2 → e3
		expect(data).toContain('cg:m:12-28'); // e2 → e4
		expect(labels(kb)).toContain('•');
	});

	it('uses a distinct marker for capture targets', () => {
		const game = gameAfter([
			['e2', 'e4'],
			['d7', 'd5'],
		]);
		const position = positionOf(game);
		const targets = legalMoves(position).filter((m) => m.from === parseSquare('e4'));
		const kb = boardKeyboard({ position, selected: parseSquare('e4'), targets });
		expect(labels(kb)).toContain('×');
	});
});

describe('game screen', () => {
	it('shows level, turn, board and history', () => {
		const game = gameAfter([
			['e2', 'e4'],
			['e7', 'e5'],
		]);
		const text = gameText({
			position: positionOf(game),
			game,
			status: currentStatus(game),
			mode: 'engine',
			level: 3,
		});
		expect(text).toContain('😈');
		expect(text).toContain('نوبت <b>شما</b> (سفید)');
		expect(text).toContain('<pre>');
		expect(text).toContain('1. e4 e5');
		expect(text).toContain('8 ♜ ♞ ♝ ♛ ♚ ♝ ♞ ♜');
	});

	it('shows the local mode and the side to move', () => {
		const game = gameAfter([['e2', 'e4']]);
		const text = gameText({
			position: positionOf(game),
			game,
			status: currentStatus(game),
			mode: 'local',
			level: 0,
		});
		expect(text).toContain('دو نفره');
		expect(text).toContain('نوبت <b>سیاه</b>');
	});

	it('warns about check and about a piece without legal moves', () => {
		const game = newGame('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');
		const status = currentStatus(game);
		expect(
			gameText({ position: positionOf(game), game, status, mode: 'local', level: 0 }),
		).toContain('کیش!');

		const noMoves = newGame('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
		expect(
			gameText({
				position: positionOf(noMoves),
				game: noMoves,
				status: { over: false, check: false },
				mode: 'local',
				level: 0,
				selected: 4,
				targets: [],
			}),
		).toContain('حرکت قانونی ندارد');
	});

	it('renders a mate result with the winner', () => {
		const game = gameAfter([
			['f2', 'f3'],
			['e7', 'e5'],
			['g2', 'g4'],
			['d8', 'h4'],
		]);
		const text = gameOverText({ position: positionOf(game), game, mode: 'engine' });
		expect(text).toContain('پایان بازی');
		expect(text).toContain('برنده: موتور');
		expect(text).toContain('مات');
		expect(text).toContain('0-1');
	});

	it('renders a draw headline', () => {
		const game = { ...newGame(), result: '1/2-1/2', reason: 'stalemate' };
		const text = gameOverText({ position: positionOf(game), game, mode: 'local' });
		expect(text).toContain('مساوی');
		expect(text).toContain('پات');
	});

	it('highlights legal targets inside the text board (regression)', () => {
		const game = newGame(); // e2 has two legal moves
		const position = positionOf(game);
		const targets = legalMoves(position).filter((m) => m.from === parseSquare('e2'));
		const text = gameText({
			position,
			game,
			status: currentStatus(game),
			mode: 'engine',
			level: 2,
			selected: parseSquare('e2'),
			targets,
		});
		const rank3 = text.split('\n').find((line) => line.startsWith('3 '));
		const rank4 = text.split('\n').find((line) => line.startsWith('4 '));
		expect(rank3).toContain('•'); // e3
		expect(rank4).toContain('•'); // e4
		expect(text).toContain('انتخاب: <b>♙ e2</b>');
	});

	it('wraps the board in a pre block with equal-width lines', () => {
		const position = positionOf(newGame());
		const lines = boardText(position).replace('<pre>', '').replace('</pre>', '').split('\n');
		expect(lines).toHaveLength(9);
		expect(new Set(lines.map((l) => [...l].length)).size).toBe(1);
	});
});

describe('labels and helpers', () => {
	it('maps reasons to Persian', () => {
		expect(reasonLabel('checkmate')).toBe('مات');
		expect(reasonLabel('threefold')).toContain('سه‌باره');
		expect(reasonLabel('something-new')).toBe('پایان بازی');
	});

	it('maps the winner depending on the mode', () => {
		expect(winnerLabel('1-0', 'engine')).toBe('شما');
		expect(winnerLabel('0-1', 'engine')).toBe('موتور');
		expect(winnerLabel('1-0', 'local')).toBe('سفید');
		expect(winnerLabel('1/2-1/2', 'local')).toBe('مساوی');
	});

	it('labels the four engine levels', () => {
		expect(levelLabel(1)).toContain('آسان');
		expect(levelLabel(4)).toContain('استاد');
	});

	it('summarizes move history with numbering', () => {
		expect(moveHistoryLine([])).toContain('هنوز حرکتی');
		expect(moveHistoryLine(['e4', 'e5', 'Nf3'])).toBe('آخرین حرکات: 1. e4 e5 2. Nf3');
	});

	it('builds a promotion keyboard with all four pieces', () => {
		const kb = promotionKeyboard(52, 60);
		expect(kb.inline_keyboard[0]).toHaveLength(4);
		expect(callbacks(kb)).toEqual(['cg:pr:52-60-5', 'cg:pr:52-60-4', 'cg:pr:52-60-3', 'cg:pr:52-60-2']);
	});

	it('renders a stats screen', () => {
		expect(chessStatsText({ played: 2, wins: 1, draws: 0, losses: 1 })).toContain('تعداد بازی: <b>2</b>');
	});
});
