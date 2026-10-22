/**
 * انواع پایه‌ی شطرنج (Core خالص، بدون هیچ وابستگی به تلگرام/Cloudflare).
 *
 * نمایش تخته: `Int8Array(64)` با اندیس 0 = a1 و 63 = h8.
 *   index = rank * 8 + file
 * مهره‌ها با علامت کدگذاری می‌شوند:
 *   سفید  =  1..6  (P N B R Q K)
 *   سیاه  = -1..-6
 *   0     = خانه‌ی خالی
 * این کار باعث می‌شود `piece > 0` به معنی «سفید» باشد، بدون شاخه‌ی اضافه.
 */

export type Color = 'w' | 'b';

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** نوع مهره بدون رنگ (1..6) */
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6;

/** شماره‌ی خانه 0..63 */
export type Square = number;

/** کد مهره‌ی علامت‌دار؛ مثلاً -4 یعنی رخ سیاه */
export type PieceCode = number;

/** حقوق قلعه‌روی، به‌صورت بیت‌ماسک */
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

export const CASTLE_ALL = CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ;

/**
 * یک حرکت. برای undo نیاز به اطلاعات اضافه نیست چون از روی `move` بازسازی می‌شود.
 */
export interface Move {
	from: Square;
	to: Square;
	/** کد مهره‌ی حرکت‌دهنده، با علامت */
	piece: PieceCode;
	/** کد مهره‌ی گرفته‌شده (0 اگر نگرفته باشد) */
	captured: PieceCode;
	/** نوع مهره‌ی ترفیع (1..6)، فقط برای پیاده */
	promo?: number;
	/** 'k' = قلعه‌ی کوچک، 'q' = قلعه‌ی بزرگ */
	castle?: 'k' | 'q';
	/** آیا این حرکت، گرفتن با en-passant است؟ */
	ep?: boolean;
}

/** وضعیت کامل بازی */
export interface Position {
	board: Int8Array;
	turn: Color;
	/** بیت‌ماسک CASTLE_* */
	castling: number;
	/** خانه‌ی هدف en-passant، یا -1 */
	ep: Square;
	/** نیم‌حرکت‌های بدون برداشتن مهره/حرکت پیاده (برای قاعده‌ی ۵۰ حرکت) */
	halfmove: number;
	/** شماره‌ی حرکت کامل (هر جفت سفید/سیاه یک واحد) */
	fullmove: number;
}

/** اطلاعات لازم برای بازگرداندن وضعیت به قبل از یک حرکت */
export interface Undo {
	move: Move;
	castling: number;
	ep: Square;
	halfmove: number;
	fullmove: number;
	turn: Color;
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export type GameEndReason =
	| 'checkmate'
	| 'stalemate'
	| 'insufficient-material'
	| 'fifty-move'
	| 'threefold'
	| 'resignation'
	| 'timeout'
	| 'agreement';

export interface GameStatus {
	/** آیا بازی تمام شده است؟ */
	over: boolean;
	/** نتیجه، اگر تمام شده باشد */
	result: GameResult | null;
	reason: GameEndReason | null;
	winner: Color | null;
	/** آیا نوبت‌دار در کیش است؟ */
	check: boolean;
}
