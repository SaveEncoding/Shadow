import { InlineKeyboard } from "grammy";
import { Role, ASSIGNABLE_ROLES, roleLabel } from "../constants/roles.js";

export function adminPanelKeyboard(viewerRole) {
  const kb = new InlineKeyboard()
    .text("📈 آمار نقش‌ها", "stats")
    .text("📋 کاربران ویژه", "admin:list_privileged")
    .row()
    .text("⚙️ تنظیمات", "settings");

  if (viewerRole >= Role.FOUNDER) {
    kb.row().text("👥 مدیریت نقش‌ها", "admin:roles");
  }

  kb.row().text("🏠 منوی اصلی", "m:h");
  return kb;
}

export function rolePickerKeyboard(targetId) {
  const kb = new InlineKeyboard();
  for (const r of ASSIGNABLE_ROLES) {
    kb.text(roleLabel(r), `admin:setrole:${targetId}:${r}`).row();
  }
  return kb;
}

export function userRoleActionsKeyboard(targetId, currentRole) {
  const kb = new InlineKeyboard();
  for (const r of ASSIGNABLE_ROLES) {
    const mark = r === currentRole ? "✓ " : "";
    kb.text(`${mark}${roleLabel(r)}`, `admin:setrole:${targetId}:${r}`);
    if (r % 2 === 1) kb.row();
  }
  kb.row().text("« بازگشت", "admin:roles");
  return kb;
}
