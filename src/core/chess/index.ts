/**
 * نقطه‌ی ورود عمومی هسته‌ی شطرنج.
 *
 * قاعده‌ی وابستگی: این پوشه **هیچ‌چیز** از تلگرام، Cloudflare یا D1 نمی‌شناسد.
 * هر کدی در `features/` یا `db/` که شطرنج لازم دارد، از همین‌جا import می‌کند.
 */

export * from './types.js';
export {
	FILES,
	colorSign,
	fileOf,
	findKing,
	isInCheck,
	isSquareAttacked,
	onBoard,
	opposite,
	parseSquare,
	pieceColor,
	pieceType,
	rankOf,
	squareAt,
	squareName,
} from './board.js';
export { FenError, START_FEN, clonePosition, emptyPosition, parseFen, positionKey, startPosition, toFen } from './fen.js';
export { applyMove, capturedSquareFor, moveToUci, undoMove } from './make-move.js';
export { hasLegalMoves, legalMoves, legalMovesFrom, pseudoMoves } from './movegen.js';
export { legalSans, moveFromSan, moveToSan } from './san.js';
export { getStatus, isInsufficientMaterial, type StatusOptions } from './status.js';
export {
	CAPTURE_TARGET_CELL,
	EMPTY_CELL,
	MOVE_TARGET_CELL,
	SELECTED_CELL,
	describeTurn,
	pieceSymbol,
	renderBoardLines,
	renderBoardText,
	type BoardRenderOptions,
} from './render.js';
export { buildPgn, pgnHeaders, pgnMoveText, type PgnOptions } from './pgn.js';
export { evaluate, evaluateForSideToMove, PIECE_VALUE } from './eval.js';
export {
	IllegalMoveError,
	applyUserMove,
	currentStatus,
	finishGame,
	gameToPgn,
	legalTargetsFrom,
	newGame,
	positionOf,
	replay,
	takeBack,
	type GameRecord,
	type IllegalMoveCode,
	type MoveOutcome,
	type PgnBuildOptions,
	type ReplayResult,
} from './game.js';
export {
	ENGINE_LEVELS,
	MATE_SCORE,
	chooseMove,
	makeRandom,
	search,
	type LevelConfig,
	type ScoredMove,
	type SearchOptions,
	type SearchResult,
} from './engine.js';
