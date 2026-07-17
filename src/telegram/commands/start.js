// import { addUser }
// from "../db/users";

// import { sendMessage }
// from "../services/telegramService";

// import { homeInlineKeyboard }
// from "../keyboards/home";

import { reportErrorToAdmin }
from "../utils/error";

import { createBot } from "../bot";

export async function startCommand(env) {
    try {
        const bot = createBot(env);
        bot.command("start", async (ctx) => {
            await ctx.reply("👋 <b>بات Shadow</b> فعال شد.\n\nمدیریت کانال‌های تلگرام", {
            parse_mode: "HTML"
            });
        });

    
    //     if (!env?.my_database) {
    //         const missingErr = new Error("D1 binding 'my_database' is missing");
    //         console.error("[startCommand] Missing my_database binding");
    //         await reportErrorToAdmin(
    //             env,
    //             "startCommand",
    //             missingErr,
    //             message.from?.id
    //         );
    //         await sendMessage(
    //             env,
    //             message.chat.id,
    //             "خطای سرور: دیتابیس در دسترس نیست. لطفاً بعداً تلاش کنید."
    //         );
    //         return;
    //     }

    //     await addUser(
    //         env.my_database,
    //         message.from
    //     );

    //     await sendMessage(
    //         env,
    //         message.chat.id,
    //         "به ربات خوش آمدید.",
    //         homeInlineKeyboard()
    //     );
    } catch (err) {
        console.error("[startCommand] Error:", err);
        await reportErrorToAdmin(
            env,
            "startCommand",
            err,
            message.from?.id
        );
        throw err;
    }

}