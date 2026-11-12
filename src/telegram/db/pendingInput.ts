/**
 * وضعیت کوتاه‌عمر «منتظر متن کاربر» برای جریان‌های دکمه‌ای منو.
 *
 * چرا D1 و نه `Map` در حافظه؟ چون ایزوله‌ی Worker تضمینی نیست: دکمه در یک
 * ایزوله پردازش می‌شود و پیام بعدی کاربر ممکن است به ایزوله‌ی دیگری برسد. در آن
 * حالت جریان «پسوند را بفرست» بی‌صدا شکسته می‌شد و کاربر هر بار مجبور بود از
 * اول شروع کند. ردیف در D1 برای همه‌ی ایزوله‌ها یکسان است.
 *
 * هزینه: یک کوئری روی هر پیام خصوصی (فقط تا وقتی چیزی در انتظار است، یک SELECT
 * با کلید اصلی). ردیف‌ها به ازای هر کاربر یکی هستند و با انقضا پاک می‌شوند.
 */

export type PendingInputType = 'suffix' | 'skip';

export interface PendingInput {
	type: PendingInputType;
	channelId: number;
	promptChatId: number | null;
	promptMessageId: number | null;
	expiresAt: number;
}

/** مدت اعتبار پیش‌فرض: ۵ دقیقه (همان مقدار قبلی در حافظه) */
export const PENDING_INPUT_TTL_SECONDS = 5 * 60;

export async function setPendingInput(
	db: D1Database,
	userId: number,
	input: {
		type: PendingInputType;
		channelId: number;
		promptChatId?: number | null;
		promptMessageId?: number | null;
		expiresAt: number;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO ui_pending_inputs (user_id, type, channel_id, prompt_chat_id, prompt_message_id, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET
			   type = excluded.type,
			   channel_id = excluded.channel_id,
			   prompt_chat_id = excluded.prompt_chat_id,
			   prompt_message_id = excluded.prompt_message_id,
			   expires_at = excluded.expires_at`,
		)
		.bind(userId, input.type, input.channelId, input.promptChatId ?? null, input.promptMessageId ?? null, input.expiresAt)
		.run();
}

export async function getPendingInput(db: D1Database, userId: number, now: number): Promise<PendingInput | null> {
	const row = await db.prepare('SELECT * FROM ui_pending_inputs WHERE user_id = ? AND expires_at > ?').bind(userId, now).first<{
		type: string;
		channel_id: number;
		prompt_chat_id: number | null;
		prompt_message_id: number | null;
		expires_at: number;
	}>();
	if (!row) return null;
	return {
		type: row.type === 'skip' ? 'skip' : 'suffix',
		channelId: Number(row.channel_id),
		promptChatId: row.prompt_chat_id === null ? null : Number(row.prompt_chat_id),
		promptMessageId: row.prompt_message_id === null ? null : Number(row.prompt_message_id),
		expiresAt: Number(row.expires_at),
	};
}

export async function clearPendingInput(db: D1Database, userId: number): Promise<void> {
	await db.prepare('DELETE FROM ui_pending_inputs WHERE user_id = ?').bind(userId).run();
}

/** حذف ردیف‌های منقضی (ساعتی یک‌بار از کرون صدا زده می‌شود) */
export async function prunePendingInputs(db: D1Database, now: number): Promise<void> {
	await db.prepare('DELETE FROM ui_pending_inputs WHERE expires_at <= ?').bind(now).run();
}
