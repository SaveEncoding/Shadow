import { InlineKeyboard } from "grammy";

export function homeInlineKeyboard() {

  const keyboard = new InlineKeyboard()
  .text('📊 پنل مدیریت', 'panel')
  .text('➕ افزودن کانال', 'add_channel')
  .row()
  .text('📋 کانال‌های من', 'my_channels')
  .text('⚙️ تنظیمات', 'settings')
  .row()
  .text('📈 آمار', 'stats')
  .text('❓ راهنما', 'help') 

return keyboard
}