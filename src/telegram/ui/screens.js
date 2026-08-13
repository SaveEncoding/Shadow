import { InlineKeyboard } from "grammy";
import { Role, roleLabel } from "../constants/roles.js";

/** @param {number} [userRole] */
export function homeText(userRole = Role.NORMAL) {
  const roleLine =
    userRole >= Role.EXEC_ADMIN
      ? `\nسطح دسترسی شما: <b>${roleLabel(userRole)}</b>`
      : "";
  return (
    `🏠 <b>منوی اصلی</b>${roleLine}\n\n` +
    `یکی از گزینه‌ها را انتخاب کنید.\n` +
    `<i>پیمایش داخل همین پیام انجام می‌شود.</i>`
  );
}

/** @param {number} [userRole] */
export function homeKeyboard(userRole = Role.NORMAL) {
  const kb = new InlineKeyboard()
    .text("➕ ثبت کانال", "m:a")
    .text("📋 کانال‌های من", "m:l")
    .row()
    .text("📈 آمار", "m:st")
    .text("⚙️ تنظیمات", "m:se")
    .row()
    .text("ℹ️ راهنما", "m:hp")
    .text("📞 پشتیبانی", "m:sp");

  if (userRole >= Role.EXEC_ADMIN) {
    kb.row().text("🛡 پنل مدیریت", "m:ad");
  }
  return kb;
}

export function addChannelText() {
  return (
    `➕ <b>ثبت کانال جدید</b>\n\n` +
    `<b>مرحله ۱:</b> بات را به‌عنوان <b>ادمین</b> به کانال اضافه کنید ` +
    `(حداقل دسترسی ویرایش پیام برای پسوند خودکار).\n\n` +
    `<b>مرحله ۲:</b> یک پست از همان کانال را به همین چت <b>فوروارد</b> کنید.\n\n` +
    `بات خودش بررسی می‌کند:\n` +
    `• آیا شما ادمین/مالک کانال هستید؟\n` +
    `• آیا کانال قبلاً ثبت شده؟\n\n` +
    `<i>ثبت با لینک/یوزرنیم به‌زودی اضافه می‌شود؛ فعلاً فقط فوروارد.</i>`
  );
}

export function addChannelKeyboard() {
  return new InlineKeyboard().text("🏠 منوی اصلی", "m:h");
}

/**
 * @param {Array<object>} channels
 * @param {number} userId
 */
export function channelsListText(channels, userId) {
  if (!channels.length) {
    return (
      `📋 <b>کانال‌های من</b>\n\n` +
      `هنوز کانالی ثبت نکرده‌اید.\n` +
      `از «ثبت کانال» یک پست فوروارد کنید.`
    );
  }
  let t = `📋 <b>کانال‌های من</b> <i>(${channels.length})</i>\n\nیکی را انتخاب کنید:\n`;
  for (const ch of channels) {
    const un = ch.username ? `@${ch.username}` : "خصوصی";
    const badge =
      ch.owner_id === userId ? "👑" : ch.registered_by === userId ? "📌" : "🛡";
    const sfx = ch.official_suffix ? " · ✍️" : "";
    t += `${badge} <b>${escapeHtml(ch.title)}</b> (${un})${sfx}\n`;
  }
  t += `\n<i>✍️ = پسوند رسمی تنظیم شده</i>`;
  return t;
}

/** @param {Array<object>} channels */
export function channelsListKeyboard(channels) {
  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const label = truncate(ch.title || String(ch.channel_id), 28);
    kb.text(label, `m:c:${ch.channel_id}`).row();
  }
  kb.text("➕ ثبت کانال", "m:a").text("🏠 منوی اصلی", "m:h");
  return kb;
}

/**
 * @param {object} ch
 * @param {number} userId
 */
export function channelDetailText(ch, userId) {
  const un = ch.username ? `@${ch.username}` : "— (خصوصی)";
  const role =
    ch.owner_id === userId
      ? "مالک"
      : ch.registered_by === userId
        ? "ثبت‌کننده"
        : "ادمین";
  const sfx = ch.official_suffix
    ? escapeHtml(String(ch.official_suffix).slice(0, 120))
    : "<i>تنظیم نشده</i>";
  const marker = ch.suffix_skip_marker
    ? `<code>${escapeHtml(ch.suffix_skip_marker)}</code>`
    : "<i>تنظیم نشده</i>";

  return (
    `📺 <b>${escapeHtml(ch.title)}</b>\n\n` +
    `شناسه: <code>${ch.channel_id}</code>\n` +
    `یوزرنیم: ${un}\n` +
    `نقش شما: <b>${role}</b>\n\n` +
    `✍️ پسوند رسمی:\n${sfx}\n\n` +
    `⏭ مارکر رد خودکار:\n${marker}\n\n` +
    `<i>گزینه‌های خاکستری = هنوز پیاده‌سازی نشده‌اند.</i>`
  );
}

/** @param {number|string} channelId */
export function channelDetailKeyboard(channelId) {
  return new InlineKeyboard()
    .text("✍️ پسوند رسمی", `m:cs:${channelId}`)
    .text("⏭ مارکر رد", `m:sk:${channelId}`)
    .row()
    .text("✏️ ویرایش اطلاعات", "m:soon:edit")
    .text("⚙️ تنظیمات پیشرفته", "m:soon:adv")
    .row()
    .text("📊 آمار کانال", "m:soon:chstat")
    .text("🗑 حذف", "m:soon:del")
    .row()
    .text("« لیست کانال‌ها", "m:l")
    .text("🏠 منوی اصلی", "m:h");
}

export function channelSuffixHelpText(ch) {
  let current = ch.official_suffix
    ? escapeHtml(String(ch.official_suffix))
    : "<i>خالی</i>";
  if (ch.official_suffix && ch.official_suffix_entities) {
    try {
      const n = JSON.parse(ch.official_suffix_entities)?.length || 0;
      if (n > 0) current += `\n<i>(${n} فرمت ذخیره‌شده)</i>`;
    } catch { /* ignore */ }
  }
  return (
    `✍️ <b>پسوند رسمی</b> — ${escapeHtml(ch.title)}\n\n` +
    `وضعیت فعلی:\n${current}\n\n` +
    `با دکمه‌های زیر تنظیم کنید؛ بعد از «تنظیم پسوند» متن را در چت بفرستید.\n` +
    `<i>فرمت تلگرام (بولد، ایتالیک، اسپویلر، لینک و …) در پسوند ذخیره می‌شود.</i>\n\n` +
    `پس از ذخیره، روی پست‌های جدید/ادیت‌شدهٔ کانال به‌صورت خودکار اعمال می‌شود.`
  );
}

/** @param {number|string} channelId */
export function channelSuffixKeyboard(channelId) {
  return new InlineKeyboard()
    .text("✏️ تنظیم پسوند", `m:cs:set:${channelId}`)
    .text("🗑 پاک کردن", `m:cs:clr:${channelId}`)
    .row()
    .text("« بازگشت به کانال", `m:c:${channelId}`)
    .text("🏠 منوی اصلی", "m:h");
}

export function channelSkipHelpText(ch) {
  const current = ch.suffix_skip_marker
    ? `<code>${escapeHtml(ch.suffix_skip_marker)}</code>`
    : "<i>خالی (همه پست‌ها پسوند می‌گیرند)</i>";
  return (
    `⏭ <b>مارکر رد خودکار</b> — ${escapeHtml(ch.title)}\n\n` +
    `وضعیت: ${current}\n\n` +
    `اگر این عبارت در متن/کپشن پست باشد، پسوند خودکار اضافه <b>نمی‌شود</b>.\n\n` +
    `با دکمه «تنظیم مارکر» عبارت را در چت بفرستید (مثلاً <code>#nosuffix</code>).`
  );
}

/** @param {number|string} channelId */
export function channelSkipKeyboard(channelId) {
  return new InlineKeyboard()
    .text("✏️ تنظیم مارکر", `m:sk:set:${channelId}`)
    .text("🗑 پاک کردن", `m:sk:clr:${channelId}`)
    .row()
    .text("« بازگشت به کانال", `m:c:${channelId}`)
    .text("🏠 منوی اصلی", "m:h");
}

export function backToChannelKeyboard(channelId) {
  return new InlineKeyboard()
    .text("« بازگشت به کانال", `m:c:${channelId}`)
    .text("🏠 منوی اصلی", "m:h");
}

/** Waiting for the user to type the new suffix/marker. */
export function awaitInputText(kind, channelTitle) {
  const label = kind === "suffix" ? "پسوند رسمی" : "مارکر رد";
  return (
    `✏️ <b>در انتظار ${label}</b>\n` +
    `کانال: <b>${escapeHtml(channelTitle)}</b>\n\n` +
    `متن مورد نظر را در یک پیام بفرستید.\n` +
    (kind === "suffix"
      ? `<i>می‌توانید متن را بولد/اسپویلر/لینک کنید؛ فرمت ذخیره می‌شود.</i>\n`
      : "") +
    `<i>برای انصراف از دکمه زیر استفاده کنید (۵ دقیقه مهلت).</i>`
  );
}

/** @param {number|string} channelId @param {'suffix'|'skip'} kind */
export function awaitInputKeyboard(channelId, kind) {
  const cancel = kind === "suffix" ? `m:cs:x:${channelId}` : `m:sk:x:${channelId}`;
  const back = kind === "suffix" ? `m:cs:${channelId}` : `m:sk:${channelId}`;
  return new InlineKeyboard()
    .text("❌ انصراف", cancel)
    .row()
    .text("« بازگشت", back)
    .text("🏠 منوی اصلی", "m:h");
}

export function confirmClearText(kind, channelTitle) {
  const label = kind === "suffix" ? "پسوند رسمی" : "مارکر رد";
  return (
    `⚠️ <b>پاک کردن ${label}</b>\n` +
    `کانال: <b>${escapeHtml(channelTitle)}</b>\n\n` +
    `مطمئن هستید؟`
  );
}

/** @param {number|string} channelId @param {'suffix'|'skip'} kind */
export function confirmClearKeyboard(channelId, kind) {
  const yes = kind === "suffix" ? `m:cs:clr2:${channelId}` : `m:sk:clr2:${channelId}`;
  const no = kind === "suffix" ? `m:cs:${channelId}` : `m:sk:${channelId}`;
  return new InlineKeyboard()
    .text("✅ بله، پاک شود", yes)
    .text("خیر", no)
    .row()
    .text("🏠 منوی اصلی", "m:h");
}

/** @param {{ channelCount: number, roleStats?: object|null, userRole: number }} info */
export function statsText(info) {
  let t = `📈 <b>آمار</b>\n\n`;
  t += `• کانال‌های شما: <b>${info.channelCount}</b>\n`;
  if (info.roleStats && info.userRole >= Role.EXEC_ADMIN) {
    t += `\n<b>کاربران ربات (بر اساس نقش)</b>\n`;
    for (const [lvl, label] of Object.entries(
      // RoleLabel imported dynamically avoided — inline from stats object keys
      info.roleStats.labels || {}
    )) {
      t += `• ${label}: <b>${info.roleStats.counts[lvl] ?? 0}</b>\n`;
    }
    t += `\nجمع: <b>${info.roleStats.total}</b>`;
  } else {
    t += `\n<i>آمار نقش‌ها فقط برای ادمین‌های ربات نمایش داده می‌شود.</i>`;
  }
  return t;
}

export function statsKeyboard() {
  return new InlineKeyboard().text("🏠 منوی اصلی", "m:h");
}

export function settingsText() {
  return (
    `⚙️ <b>تنظیمات</b>\n\n` +
    `<b>در دسترس:</b>\n` +
    `• گپ لاگ خطا (برای ادمین‌ها):\n` +
    `  <code>/seterrorlog</code> در گروه مورد نظر\n` +
    `  <code>/geterrorlog</code>\n` +
    `• نقش شما: <code>/whoami</code>\n\n` +
    `<b>به‌زودی:</b>\n` +
    `• زبان · اعلان‌های شخصی · مدیریت حساب`
  );
}

export function settingsKeyboard() {
  return new InlineKeyboard()
    .text("🌐 زبان", "m:soon:lang")
    .text("🔔 اعلان‌ها", "m:soon:notif")
    .row()
    .text("🏠 منوی اصلی", "m:h");
}

export function helpText() {
  return (
    `ℹ️ <b>راهنما</b>\n\n` +
    `<b>ثبت کانال</b>\n` +
    `۱) بات را ادمین کانال کنید\n` +
    `۲) یک پست کانال را به بات فوروارد کنید\n\n` +
    `<b>پسوند رسمی</b>\n` +
    `از «کانال‌های من» → کانال → پسوند رسمی، یا دستور <code>/setsuffix</code>\n\n` +
    `<b>پنل مدیریت</b>\n` +
    `برای ادمین‌های ربات: مدیریت نقش‌ها و آمار کاربران\n\n` +
    `دستورات اختیاری: /start · /whoami · /setsuffix · /setsuffixskip`
  );
}

export function helpKeyboard() {
  return new InlineKeyboard()
    .text("📚 FAQ", "m:soon:faq")
    .text("📜 قوانین", "m:soon:rules")
    .row()
    .text("🏠 منوی اصلی", "m:h");
}

export function supportText() {
  return (
    `📞 <b>پشتیبانی</b>\n\n` +
    `برای گزارش مشکل یا پیشنهاد، به سازنده پیام دهید یا از گپ لاگ خطا (اگر تنظیم شده) استفاده کنید.\n\n` +
    `<i>سیستم تیکت به‌زودی.</i>`
  );
}

export function supportKeyboard() {
  return new InlineKeyboard().text("🏠 منوی اصلی", "m:h");
}

export function adminHubText(userRole) {
  return (
    `🛡 <b>پنل مدیریت ربات</b>\n\n` +
    `سطح شما: <b>${roleLabel(userRole)}</b>\n\n` +
    `مدیریت نقش کاربران، آمار و تنظیمات سراسری ربات.`
  );
}

/** Re-export shape used by admin panel keyboard with home back to m:h */
export function adminHubKeyboard(userRole) {
  const kb = new InlineKeyboard()
    .text("📈 آمار نقش‌ها", "m:st")
    .text("📋 کاربران ویژه", "admin:list_privileged")
    .row();
  if (userRole >= Role.FOUNDER) {
    kb.text("👥 مدیریت نقش‌ها", "admin:roles").row();
  }
  kb.text("⚙️ تنظیمات", "m:se").row();
  kb.text("🏠 منوی اصلی", "m:h");
  return kb;
}

export function soonText(featureKey) {
  const names = {
    edit: "ویرایش اطلاعات کانال",
    adv: "تنظیمات پیشرفته / ضد اسپم",
    chstat: "آمار تفصیلی کانال",
    del: "حذف کانال از سیستم",
    lang: "تغییر زبان",
    notif: "اعلان‌های شخصی",
    faq: "سوالات متداول",
    rules: "قوانین استفاده",
  };
  const name = names[featureKey] || "این قابلیت";
  return (
    `🚧 <b>به‌زودی</b>\n\n` +
    `${escapeHtml(name)} هنوز در این نسخه فعال نشده است.\n` +
    `از منوی اصلی به بخش‌های آماده سر بزنید.`
  );
}

export function soonKeyboard() {
  return new InlineKeyboard().text("🏠 منوی اصلی", "m:h");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(s, n) {
  const t = String(s);
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}
