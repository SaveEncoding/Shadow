import { Api, type RawApi } from 'grammy';
import type { Env } from '../../types.js';
import type { MessageEntityLike } from '../utils/messageSuffix.js';

/**
 * grammY این دو نوع را از ریشه export نمی‌کند، ولی خودِ امضای متدهای `Api`
 * دقیقاً همان چیزی است که می‌خواهیم؛ پس بی‌واسطه از آن استخراج می‌شوند تا
 * هر ارتقای grammY خودش این تایپ‌ها را به‌روز کند.
 */
type SendArgs = Parameters<RawApi['sendMessage']>[0];
type ReplyMarkup = NonNullable<SendArgs['reply_markup']>;
type EditMessageTextArgs = Parameters<RawApi['editMessageText']>[0];
type MessageEntityList = NonNullable<EditMessageTextArgs['entities']>;
type InlineMarkup = NonNullable<EditMessageTextArgs['reply_markup']>;

/**
 * فهرست entity ای که از دیتابیس/تلگرام می‌آید و در `sanitizeEntities` اعتبارسنجی
 * شده است. نوع اتحادی grammY برای هر `type` یک literal جدا دارد و پویایی این
 * فهرست در زمان کامپایل قابل اثبات نیست؛ تبدیل فقط همین‌جا، در مرز خروجی به
 * API، انجام می‌شود.
 */
function asTelegramEntities(entities: readonly MessageEntityLike[]): MessageEntityList {
	return entities as MessageEntityList;
}

/**
 * Both helpers below go through grammy's Api client instead of a hand-rolled
 * fetch, so every outbound Telegram call in the project shares the same
 * request/error handling, retry, and typing behavior grammy provides.
 */

/**
 * Escapes the characters Telegram's HTML parse_mode treats as markup
 * (&, <, >) so arbitrary/dynamic text can never be misread as (broken)
 * HTML and blow up with "can't parse entities" (this is exactly what
 * happened when a literal "<" ended up in the cleanup cron's summary text).
 *
 * sendMessage/editMessage apply this to their `text` argument automatically.
 * Because of that, do NOT hand-write formatting tags (<b>, <code>, ...) in
 * text passed to these two helpers — they'll be escaped and shown as literal
 * text, not rendered. These two are meant for plain-text reports/notices
 * (cron summaries, status edits). If a handler genuinely needs rich HTML
 * formatting, use ctx.reply()/ctx.editMessageText() directly the way the
 * feature/command handlers already do, and escape only the dynamic pieces
 * you interpolate (with this same escapeHtml) while keeping your own tags.
 */
// پیاده‌سازی در `core/text` است تا همه‌ی لایه‌ها (بات، UI، خطاها) از یک نسخه
// استفاده کنند؛ این import/re-export API فعلی این ماژول را حفظ می‌کند.
// (توجه: `export { x } from '...'` در این ماژول نام محلی نمی‌سازد و
// sendMessage/editMessage پایین‌تر به همین binding محلی نیاز دارند.)
import { escapeHtml } from '../../core/text/escape.js';

export { escapeHtml };

/** حداقل چیزی که این ماژول از env لازم دارد */
type TelegramEnv = Pick<Env, 'TELEGRAM_TOKEN'>;

export interface SendMessageOptions {
	/**
	 * message_thread_id یک تاپیک انجمن. هر جا مقصد ممکن است topic-split باشد
	 * این را بدهید، وگرنه تلگرام پیام را بی‌صدا به «General» می‌اندازد.
	 */
	threadId?: number | null;
	replyMarkup?: ReplyMarkup | null;
}

export async function sendMessage(
	env: TelegramEnv,
	chatId: number | string,
	text: string,
	{ threadId = null, replyMarkup = null }: SendMessageOptions = {},
) {
	if (!env.TELEGRAM_TOKEN) {
		throw new Error('TELEGRAM_TOKEN is not set');
	}

	if (!chatId) {
		throw new Error('chatId is required');
	}

	const api = new Api(env.TELEGRAM_TOKEN);

	return api.sendMessage(chatId, escapeHtml(text), {
		parse_mode: 'HTML',
		message_thread_id: threadId ?? undefined,
		reply_markup: replyMarkup ?? undefined,
	});
}

/**
 * Edits the text of a message the bot already sent (e.g. flipping a
 * "در حال پردازش..." status message to its final result). Mirrors
 * sendMessage's shape and, like it, HTML-escapes `text` automatically.
 */
export async function editMessage(
	env: TelegramEnv,
	chatId: number | string,
	messageId: number,
	text: string,
	replyMarkup: InlineMarkup | null = null,
) {
	if (!env.TELEGRAM_TOKEN) {
		throw new Error('TELEGRAM_TOKEN is not set');
	}

	if (!chatId) {
		throw new Error('chatId is required');
	}

	if (!messageId) {
		throw new Error('messageId is required');
	}

	const api = new Api(env.TELEGRAM_TOKEN);

	return api.editMessageText(chatId, messageId, escapeHtml(text), {
		parse_mode: 'HTML',
		reply_markup: replyMarkup ?? undefined,
	});
}

export async function answerCallbackQuery(env: TelegramEnv, callbackQueryId: string, text = '', showAlert = false) {
	if (!env.TELEGRAM_TOKEN) {
		throw new Error('TELEGRAM_TOKEN is not set');
	}

	const api = new Api(env.TELEGRAM_TOKEN);

	return api.answerCallbackQuery(callbackQueryId, {
		text,
		show_alert: showAlert,
	});
}

/**
 * Edit a channel (or chat) text message while preserving MessageEntity formatting.
 * Do NOT pass parse_mode together with entities.
 */
export async function editMessageTextWithEntities(
	env: TelegramEnv,
	chatId: number | string,
	messageId: number,
	text: string,
	entities: readonly MessageEntityLike[] = [],
) {
	if (!env.TELEGRAM_TOKEN) {
		throw new Error('TELEGRAM_TOKEN is not set');
	}
	const api = new Api(env.TELEGRAM_TOKEN);
	return api.editMessageText(chatId, messageId, text, {
		entities: entities?.length ? asTelegramEntities(entities) : undefined,
	});
}

/** Edit caption of a media message while preserving caption_entities. */
export async function editMessageCaptionWithEntities(
	env: TelegramEnv,
	chatId: number | string,
	messageId: number,
	caption: string,
	captionEntities: readonly MessageEntityLike[] = [],
) {
	if (!env.TELEGRAM_TOKEN) {
		throw new Error('TELEGRAM_TOKEN is not set');
	}
	const api = new Api(env.TELEGRAM_TOKEN);
	return api.editMessageCaption(chatId, messageId, {
		caption,
		caption_entities: captionEntities?.length ? asTelegramEntities(captionEntities) : undefined,
	});
}
