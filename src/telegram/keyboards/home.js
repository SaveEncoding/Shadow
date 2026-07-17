export function homeInlineKeyboard() {

    return {
        inline_keyboard: [
            [
                {
                    text: "➕ افزودن کانال",
                    callback_data: "add_channel"
                }
            ],
            [
                {
                    text: "📋 کانال‌های من",
                    callback_data: "my_channels"
                }
            ],
            [
                {
                    text: "⚙ تنظیمات",
                    callback_data: "settings"
                }
            ]
        ]
    };

}