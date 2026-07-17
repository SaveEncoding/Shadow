export async function echo(bot) {

    
    // الگوی تشخیص "اکو" در ابتدای متن یا کپشن
    const ECHO_REGEX = /^ش(?:\s+([\s\S]+))?$/i;
     
    // نگاشت نوع رسانه به متد ارسال و آی‌دی فایل
    function getMediaInfo(message) {
      if (!message) return null;
     
      if (message.photo && message.photo.length > 0) {
        const largest = message.photo[message.photo.length - 1];
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
        return { method: "sendVideoNote", fileId: message.video_note.file_id, caption: null }; // ویدیو-مسیج کپشن نداره
      }
      if (message.sticker) {
        return { method: "sendSticker", fileId: message.sticker.file_id, caption: null }; // استیکر کپشن نداره
      }
      return null;
    }
     
    // حذف امن پیام کاربر
    async function safeDelete(ctx) {
      try {
        await ctx.deleteMessage();
      } catch (err) {
        console.error("نتونستم پیام رو پاک کنم (احتمالاً بات ادمین نیست):", err.message);
      }
    }
     
    bot.on("message", async (ctx) => {
      const msg = ctx.message;
      const repliedTo = msg.reply_to_message;
     
      // حالت ۱: پیام صرفاً متنیه (بدون رسانه)
      if (msg.text) {
        const match = msg.text.match(ECHO_REGEX);
        if (!match) return; // اصلاً "اکو" نبوده، ولش کن
     
        const extraText = match[1]; // متن بعد از "اکو" (ممکنه نباشه)
     
        // حالت ۱-الف: "اکو متن" → همون متن رو بگو
        if (extraText) {
          await safeDelete(ctx);
          await ctx.reply(extraText, {
            reply_parameters: repliedTo ? { message_id: repliedTo.message_id } : undefined,
          });
          return;
        }
     
        // حالت ۱-ب: فقط "اکو" و ریپلای روی یه رسانه‌ست → همون رسانه رو دوباره بفرست
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
     
      // حالت ۲: خود پیام یه رسانه‌ست با کپشن "اکو ..."
      if (msg.caption) {
        const match = msg.caption.match(ECHO_REGEX);
        if (!match) return;
     
        const newCaption = match[1]; // متن بعد از "اکو" در کپشن (اختیاری)
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
     
    bot.catch((err) => {
      console.error("خطای کلی بات:", err);
    });
     
    
    
    
}