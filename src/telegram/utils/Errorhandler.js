import { reportError } from "./Error.js";

const DEFAULT_USER_MESSAGE =
  "⚠️ مشکلی پیش اومد، لطفاً چند لحظه دیگه دوباره تلاش کن.";

/**
 * Central grammy error handler — covers every feature registered on the bot
 * (commands, callbacks, message handlers, conversations, …).
 *
 * Wire once in createBot:
 *   bot.catch((err) => handleGrammyError(err, env));
 *
 * @param {import("grammy").BotError} botError
 * @param {object} env
 */
export async function handleGrammyError(botError, env) {
  const ctx = botError.ctx;
  // grammY types BotError#error as `unknown`; our own UserFacingError/CriticalError
  // classes attach reportToAdmin/userMessage, which TS can't know about statically.
  const error = /** @type {any} */ (botError.error);
  const userId = ctx?.from?.id ?? null;
  const updateType = ctx?.update
    ? Object.keys(ctx.update).find((k) => k !== "update_id") ?? "unknown"
    : "unknown";
  const context = `grammy:${updateType}`;

  console.error(`[${context}]`, error);

  // UserFacingError sets reportToAdmin = false; CriticalError / plain Error report by default.
  const shouldReport = error?.reportToAdmin !== false;
  if (shouldReport) {
    try {
      await reportError(env, context, error, userId);
    } catch (reportErr) {
      console.error("Failed to report error to log chat:", reportErr);
    }
  }

  // Friendly reply to the user (private chat or the chat where the update happened).
  const userMsg = error?.userMessage || DEFAULT_USER_MESSAGE;
  if (ctx?.chat?.id) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: userMsg.slice(0, 200), show_alert: true });
      } else {
        await ctx.reply(userMsg);
      }
    } catch (replyErr) {
      console.error("Failed to notify user of error:", replyErr);
    }
  }
}

/**
 * Optional wrapper for non-grammy async work (cron, one-off tasks).
 * Prefer handleGrammyError for bot updates.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} env
 * @param {string} context
 * @returns {Promise<T|undefined>}
 */
export async function runWithErrorReporting(fn, env, context) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[${context}]`, error);
    if (error?.reportToAdmin !== false) {
      await reportError(env, context, error).catch((e) =>
        console.error("Failed to report error:", e)
      );
    }
    throw error;
  }
}
