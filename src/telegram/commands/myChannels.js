import { getChannels }
from "../db/channels";

import { sendMessage }
from "../services/telegramService";

export async function myChannelsCommand(
    message,
    env
) {

    const channels =
        await getChannels(
            env.my_database,
            message.from.id
        );

    if (!channels.length) {

        return sendMessage(

            env,

            message.chat.id,

            "هیچ کانالی ثبت نشده است."

        );

    }

    let text = "📋 کانال‌های شما:\n\n";

    for (const channel of channels) {

        text +=
            `• ${channel.title}\n`;

        if (channel.username) {

            text +=
                `@${channel.username}\n`;

        }

        text += "\n";

    }

    await sendMessage(
        env,
        message.chat.id,
        text
    );

}