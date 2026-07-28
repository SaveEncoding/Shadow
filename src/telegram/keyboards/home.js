import { InlineKeyboard } from "grammy";

export function homeInlineKeyboard() {

const keyboard = new InlineKeyboard()
  .text('⏪ اول', 'nav:0')
  .text('◀️ قبلی', `nav:${1}`)
  .text('▶️ بعدی', `nav:${2}`)
  .text('⏩ آخر', `nav:${3}`)
  .row()
  .text('📥 دانلود', `dl:${4}`)
  .text('🔍 جستجوی تصویر', `rs:${5}`)
  .text('⭐ علاقه‌مندی', `fav:${6}`)
  .row()
  .text(`7`, 'status');
return keyboard

}