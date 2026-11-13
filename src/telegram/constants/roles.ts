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

export const RoleLabel: Record<number, string> = {
	[Role.NORMAL]: 'کاربر عادی',
	[Role.VIP]: 'کاربر ویژه',
	[Role.EXEC_ADMIN]: 'ادمین اجرایی',
	[Role.DEVELOPER]: 'توسعه‌دهنده',
	[Role.FOUNDER]: 'بنیان‌گذار',
};

/**
 * Roles that a non-founder admin is allowed to assign via the panel.
 * FOUNDER can never be assigned through setRole API.
 */
export const ASSIGNABLE_ROLES: readonly number[] = [Role.NORMAL, Role.VIP, Role.EXEC_ADMIN, Role.DEVELOPER];

/** آیا عدد، یک سطح نقش معتبر است؟ (رشته و null معتبر نیستند) */
export function isValidRole(role: unknown): role is number {
	return typeof role === 'number' && Number.isInteger(role) && role >= Role.NORMAL && role <= Role.FOUNDER;
}

export function roleLabel(role: number): string {
	return RoleLabel[role] ?? `سطح ${role}`;
}
