import { startCommand }
from "../commands/start";

import { addChannelCommand }
from "../commands/addChannel";

import { myChannelsCommand }
from "../commands/myChannels";

import { handleChannelForward }
from "./channel";

import { sendMessage }
from "../services/telegramService";

import { reportErrorToAdmin }
from "../utils/error";

export async function handleMessage(
    message,
    env
) {

    const text =
        (message.text || "").trim();

    try {
        if (
            message.forward_from_chat?.type ===
            "channel"
        ) {
            return handleChannelForward(
                message,
                env
            );
        }

        if (text.toLowerCase().startsWith("/start")) {
            return startCommand(
                message,
                env
            );
        }

        switch (text) {

            case "➕ افزودن کانال":
                return addChannelCommand(
                    message,
                    env
                );

            case "📋 کانال های من":
                return myChannelsCommand(
                    message,
                    env
                );

            default:
                return sendMessage(
                    env,
                    message.chat.id,
                    "برای استفاده از ربات، /start را بفرستید یا از دکمه‌های صفحه اصلی استفاده کنید."
                );

        }
    } catch (err) {
        console.error("[handleMessage] Error:", err);
        await reportErrorToAdmin(
            env,
            "handleMessage",
            err,
            message.from?.id
        );
        throw err;
    }

}