import { withErrorHandling } from "../utils/Errorhandler";

export async function echo(bot) {

  // Regex commands for echo
  const ECHO_REGEX = /^ش(?:\s+([\s\S]+))?$/i;
     
  // Data type detection
  function getMediaInfo(message) {
    if (!message) return null;
     
    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1]; // Telegram offers several different photo qualities, and we choose the highest one.
      return { method: "sendPhoto", fileId: largest.file_id, caption: message.caption };
    }
    if (message.animation) {
      return { method: "sendAnimation", fileId: message.animation.file_id, caption: message.caption };
    }
    if (message.video) {
      return { method: "sendVideo", fileId: message.video.file_id, caption: message.caption };
    }
    if (message.document) {
      return { method: "sendDocument", fileId: message.document.file_id, caption: message.caption };
    }
    if (message.voice) {
      return { method: "sendVoice", fileId: message.voice.file_id, caption: message.caption };
    }
    if (message.audio) {
      return { method: "sendAudio", fileId: message.audio.file_id, caption: message.caption };
    }
    if (message.video_note) {
      return { method: "sendVideoNote", fileId: message.video_note.file_id, caption: null }; 
    }
    if (message.sticker) {
      return { method: "sendSticker", fileId: message.sticker.file_id, caption: null }; 
    }
    return null;
  }
    
  // Deleting the message requires permission, and the admin may not grant it.
  async function safeDelete(ctx) {
    try {
      await ctx.deleteMessage();
    } catch (err) {
      console.error("نتونستم پیام رو پاک کنم (احتمالاً بات ادمین نیست):", err.message);
    }
  }
    
  // Echo's main body
  bot.on("message", async (ctx) => {
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
            await ctx.api[mediaInfo.method](
              ctx.chat.id,
              mediaInfo.fileId,
              mediaInfo.caption ? { caption: mediaInfo.caption } : undefined
            );
          } catch (err) {
            console.error("خطا در ارسال رسانه:", err.message);
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
        await ctx.api[mediaInfo.method](
          ctx.chat.id,
          mediaInfo.fileId,
          newCaption
            ? {
                caption: newCaption,
                reply_parameters: repliedTo ? { message_id: repliedTo.message_id } : undefined,
              }
            : {
                reply_parameters: repliedTo ? { message_id: repliedTo.message_id } : undefined,
              }
        );
      } catch (err) {
        console.error("خطا در ارسال رسانه:", err.message);
      }
    }
  });
     
}

export default withErrorHandling(echo, "echo");