import type { Api, Bot, Context } from 'grammy';

/** grammY نوع Message را از ریشه export نمی‌کند؛ از Context مشتق می‌شود. */
type Message = NonNullable<Context['message']>;
/** پیامی که به آن ریپلای شده هم همان شکل Message را دارد */
type ReplyMessage = NonNullable<Message['reply_to_message']>;

/**
 * ارسال یک رسانه‌ی مشخص. هر نوع رسانه متد API خودش را دارد و امضاهایشان یکی
 * نیست (استیکر و ویدیو‌نوت کپشن ندارند)؛ بنابراین خودِ ارسال‌کننده در همان
 * شاخه‌ی تشخیص نوع ساخته می‌شود تا نه جدول dispatch لازم باشد و نه cast.
 */
interface MediaInfo {
	caption: string | undefined;
	send: (api: Api, chatId: number, extra?: SendExtra) => Promise<unknown>;
}

interface SendExtra {
	caption?: string;
	reply_parameters?: { message_id: number };
}

export async function echo(bot: Bot): Promise<void> {
	// Regex commands for echo
	const ECHO_REGEX = /^ش(?:\s+([\s\S]+))?$/i;

	// Data type detection
	function getMediaInfo(message: Message | ReplyMessage | undefined): MediaInfo | null {
		if (!message) return null;

		if (message.photo && message.photo.length > 0) {
			const largest = message.photo[message.photo.length - 1]!; // Telegram offers several different photo qualities, and we choose the highest one.
			return { caption: message.caption, send: (api, chatId, extra) => api.sendPhoto(chatId, largest.file_id, extra) };
		}
		if (message.animation) {
			const fileId = message.animation.file_id;
			return { caption: message.caption, send: (api, chatId, extra) => api.sendAnimation(chatId, fileId, extra) };
		}
		if (message.video) {
			const fileId = message.video.file_id;
			return { caption: message.caption, send: (api, chatId, extra) => api.sendVideo(chatId, fileId, extra) };
		}
		if (message.document) {
			const fileId = message.document.file_id;
			return { caption: message.caption, send: (api, chatId, extra) => api.sendDocument(chatId, fileId, extra) };
		}
		if (message.voice) {
			const fileId = message.voice.file_id;
			return { caption: message.caption, send: (api, chatId, extra) => api.sendVoice(chatId, fileId, extra) };
		}
		if (message.audio) {
			const fileId = message.audio.file_id;
			return { caption: message.caption, send: (api, chatId, extra) => api.sendAudio(chatId, fileId, extra) };
		}
		// ویدیو‌نوت و استیکر کپشن ندارند، پس فقط reply_parameters را فوروارد می‌کنیم.
		if (message.video_note) {
			const fileId = message.video_note.file_id;
			return {
				caption: undefined,
				send: (api, chatId, extra) => api.sendVideoNote(chatId, fileId, { reply_parameters: extra?.reply_parameters }),
			};
		}
		if (message.sticker) {
			const fileId = message.sticker.file_id;
			return {
				caption: undefined,
				send: (api, chatId, extra) => api.sendSticker(chatId, fileId, { reply_parameters: extra?.reply_parameters }),
			};
		}
		return null;
	}

	// Deleting the message requires permission, and the admin may not grant it.
	async function safeDelete(ctx: Context) {
		try {
			await ctx.deleteMessage();
		} catch (err) {
			console.error('نتونستم پیام رو پاک کنم (احتمالاً بات ادمین نیست):', err instanceof Error ? err.message : err);
		}
	}

	// Echo's main body
	bot.on('message', async (ctx) => {
		const msg = ctx.message;
		const repliedTo = msg.reply_to_message;

		// Text-only messages
		if (msg.text) {
			const match = msg.text.match(ECHO_REGEX);
			if (!match) return;

			const extraText = match[1];

			// There is text following the echo.
			if (extraText) {
				await safeDelete(ctx);
				await ctx.reply(extraText, {
					reply_parameters: repliedTo ? { message_id: repliedTo.message_id } : undefined,
				});
				return;
			}

			// There is no text after the echo.
			if (repliedTo) {
				const mediaInfo = getMediaInfo(repliedTo);
				if (mediaInfo) {
					await safeDelete(ctx);
					try {
						await mediaInfo.send(ctx.api, ctx.chat.id, mediaInfo.caption ? { caption: mediaInfo.caption } : undefined);
					} catch (err) {
						console.error('خطا در ارسال رسانه:', err instanceof Error ? err.message : err);
					}
				}
			}
			return;
		}

		// Echo is a media outlet.
		if (msg.caption) {
			const match = msg.caption.match(ECHO_REGEX);
			if (!match) return;

			const newCaption = match[1]; // Text following "Echo" in the caption (optional)
			const mediaInfo = getMediaInfo(msg);
			if (!mediaInfo) return;

			await safeDelete(ctx);
			try {
				const replyParameters = repliedTo ? { message_id: repliedTo.message_id } : undefined;
				await mediaInfo.send(
					ctx.api,
					ctx.chat.id,
					newCaption ? { caption: newCaption, reply_parameters: replyParameters } : { reply_parameters: replyParameters },
				);
			} catch (err) {
				console.error('خطا در ارسال رسانه:', err instanceof Error ? err.message : err);
			}
		}
	});
}
