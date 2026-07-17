import { addChannel }
from "../db/channels";

import { sendMessage }
from "../services/telegramService";

import { reportErrorToAdmin }
from "../utils/error";

export async function handleChannelForward(
    message,
    env
) {

    try {
        const channel =
            message.forward_from_chat;

        await addChannel(
            env.my_database,
            message.from.id,
            channel
        );

        await sendMessage(
            env,
            message.chat.id,
            "✅ کانال ثبت شد."
        );
    } catch (err) {
        console.error("[handleChannelForward] Error:", err);
        await reportErrorToAdmin(
            env,
            "handleChannelForward",
            err,
            message.from?.id
        );
        throw err;
    }

}