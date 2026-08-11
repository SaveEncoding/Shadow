/**
 * In-place menu rendering: prefer editing the callback message so the chat
 * stays clean. Falls back to reply only when there is nothing to edit.
 */

/**
 * @param {import("grammy").Context} ctx
 * @param {string} text
 * @param {import("grammy").InlineKeyboard | object | null} [keyboard]
 */
export async function renderScreen(ctx, text, keyboard = null) {
  const opts = {
    parse_mode: "HTML",
    reply_markup: keyboard ?? undefined,
    link_preview_options: { is_disabled: true },
  };

  if (ctx.callbackQuery) {
    try {
      await ctx.answerCallbackQuery();
    } catch {
      /* already answered */
    }
  }

  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return { edited: true };
    } catch (err) {
      const desc = String(err?.description || err?.message || "");
      // Identical content — treat as success (no spam).
      if (desc.includes("message is not modified")) {
        return { edited: true, unchanged: true };
      }
      // Fall through to reply for rare cases (e.g. message too old).
      console.warn("[renderScreen] edit failed, falling back to reply:", desc);
    }
  }

  await ctx.reply(text, opts);
  return { edited: false };
}

/**
 * Toast-only answer for dead/soon buttons without changing the screen.
 * @param {import("grammy").Context} ctx
 * @param {string} text
 */
export async function toast(ctx, text) {
  try {
    await ctx.answerCallbackQuery({ text, show_alert: false });
  } catch {
    /* ignore */
  }
}

export async function toastAlert(ctx, text) {
  try {
    await ctx.answerCallbackQuery({ text, show_alert: true });
  } catch {
    /* ignore */
  }
}
