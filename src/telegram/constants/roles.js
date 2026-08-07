/**
 * Hierarchical bot roles (higher number = more privilege).
 * Stored as INTEGER on users.role.
 */
export const Role = {
  NORMAL: 0,
  VIP: 1,
  EXEC_ADMIN: 2,
  DEVELOPER: 3,
  FOUNDER: 4,
};

/** @type {Record<number, string>} */
export const RoleLabel = {
  [Role.NORMAL]: "کاربر عادی",
  [Role.VIP]: "کاربر ویژه",
  [Role.EXEC_ADMIN]: "ادمین اجرایی",
  [Role.DEVELOPER]: "توسعه‌دهنده",
  [Role.FOUNDER]: "بنیان‌گذار",
};

/**
 * Roles that a non-founder admin is allowed to assign via the panel.
 * FOUNDER can never be assigned through setRole API.
 */
export const ASSIGNABLE_ROLES = [
  Role.NORMAL,
  Role.VIP,
  Role.EXEC_ADMIN,
  Role.DEVELOPER,
];

export function isValidRole(role) {
  return Number.isInteger(role) && role >= Role.NORMAL && role <= Role.FOUNDER;
}

export function roleLabel(role) {
  return RoleLabel[role] ?? `سطح ${role}`;
}
