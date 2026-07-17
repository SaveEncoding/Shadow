import { sendMessage }
from "../services/telegramService";

export async function addChannelCommand(
    message,
    env
) {

    await sendMessage(

        env,

        message.chat.id,

        "یک پیام از کانال خود فوروارد کنید."

    );

}