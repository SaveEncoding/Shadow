import type { BotError, Context } from 'grammy';
import { reportError } from './Error.js';
import { executionCtxStorage } from '../bot.js';
import type { Env } from '../../types.js';

const DEFAULT_USER_MESSAGE = '⚠️ مشکلی پیش اومد، لطفاً چند لحظه دیگه دوباره تلاش کن.';

/**
 * خواندن فیلدهای اختیاریِ خطا بدون cast.
 * `botError.error` از نوع `unknown` است و کلاس‌های خودمان
 * (`UserFacingError`/`CriticalError`) فیلدهای اضافه دارند؛ با `in` تایپ‌سیستم
 * خودش باریک می‌کند و لازم نیست به `any` پناه ببریم.
 */
function reportToAdminFlag(error: unknown): boolean | undefined {
	if (typeof error !== 'object' || error === null || !('reportToAdmin' in error)) return undefined;
	const flag = error.reportToAdmin;
	return typeof flag === 'boolean' ? flag : undefined;
}

function userMessageOf(error: unknown): string | null {
	if (typeof error !== 'object' || error === null || !('userMessage' in error)) return null;
	const message = error.userMessage;
	return typeof message === 'string' && message.length > 0 ? message : null;
}

/**
 * Central grammy error handler — covers every feature registered on the bot
 * (commands, callbacks, message handlers, conversations, …).
 *
 * Wire once in createBot:
 *   bot.catch((err) => handleGrammyError(err, env));
 */
export async function handleGrammyError(botError: BotError<Context>, env: Env): Promise<void> {
	const ctx = botError.ctx;
	const error = botError.error;
	const userId = ctx?.from?.id ?? null;
	const updateType = ctx?.update ? (Object.keys(ctx.update).find((k) => k !== 'update_id') ?? 'unknown') : 'unknown';
	const context = `grammy:${updateType}`;

	console.error(`[${context}]`, error);

	// Reporting to the log chat and replying to the user are both outbound Telegram
	// API calls — neither needs to finish before we return control to grammY/the
	// webhook. Run them in the background via waitUntil, same as the D1 write in
	// bot.js's registration middleware, instead of making Telegram wait on them.
	const background = async () => {
		// UserFacingError sets reportToAdmin = false; CriticalError / plain Error report by default.
		const shouldReport = reportToAdminFlag(error) !== false;
		if (shouldReport) {
			try {
				await reportError(env, context, error, userId);
			} catch (reportErr) {
				console.error('Failed to report error to log chat:', reportErr);
			}
		}

		// Friendly reply to the user (private chat or the chat where the update happened).
		const userMsg = userMessageOf(error) ?? DEFAULT_USER_MESSAGE;
		if (ctx?.chat?.id) {
			try {
				if (ctx.callbackQuery) {
					await ctx.answerCallbackQuery({ text: userMsg.slice(0, 200), show_alert: true });
				} else {
					await ctx.reply(userMsg);
				}
			} catch (replyErr) {
				console.error('Failed to notify user of error:', replyErr);
			}
		}
	};

	const execCtx = executionCtxStorage.getStore();
	if (execCtx?.waitUntil) {
		execCtx.waitUntil(background());
	} else {
		// No ExecutionContext in scope (e.g. called outside a request) — fall back to awaiting.
		await background();
	}
}

/**
 * Optional wrapper for non-grammy async work (cron, one-off tasks).
 * Prefer handleGrammyError for bot updates.
 */
export async function runWithErrorReporting<T>(fn: () => Promise<T>, env: Env, context: string): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		console.error(`[${context}]`, error);
		if (reportToAdminFlag(error) !== false) {
			await reportError(env, context, error).catch((e) => console.error('Failed to report error:', e));
		}
		throw error;
	}
}
