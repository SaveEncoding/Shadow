/**
 * In-place menu rendering: prefer editing the callback message so the chat
 * stays clean. Falls back to reply only when there is nothing to edit.
 */

import type { Context, InlineKeyboard } from 'grammy';

/** همان گزینه‌هایی که هر دو مسیر edit/reply نیاز دارند */
function screenOptions(keyboard: InlineKeyboard | null) {
	return {
		parse_mode: 'HTML' as const,
		reply_markup: keyboard ?? undefined,
		link_preview_options: { is_disabled: true },
	};
}

export async function renderScreen(
	ctx: Context,
	text: string,
	keyboard: InlineKeyboard | null = null,
): Promise<{ edited: boolean; unchanged?: boolean }> {
	const opts = screenOptions(keyboard);

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
			const desc = String(err?.description || err?.message || '');
			// Identical content — treat as success (no spam).
			if (desc.includes('message is not modified')) {
				return { edited: true, unchanged: true };
			}
			// Fall through to reply for rare cases (e.g. message too old).
			console.warn('[renderScreen] edit failed, falling back to reply:', desc);
		}
	}

	await ctx.reply(text, opts);
	return { edited: false };
}

/** Toast-only answer for dead/soon buttons without changing the screen. */
export async function toast(ctx: Context, text: string): Promise<void> {
	try {
		await ctx.answerCallbackQuery({ text, show_alert: false });
	} catch {
		/* ignore */
	}
}

export async function toastAlert(ctx: Context, text: string): Promise<void> {
	try {
		await ctx.answerCallbackQuery({ text, show_alert: true });
	} catch {
		/* ignore */
	}
}
