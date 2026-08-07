/**
 * Bootstrap admin list (legacy). Prefer FOUNDER_TELEGRAM_ID secret/env.
 * Kept so existing deploys without the new secret still recognize the founder.
 */
export const ADMINS = [6585308690];

/**
 * Resolve founder telegram id: env secret first, then ADMINS[0].
 * @param {object|null|undefined} env
 * @returns {number|null}
 */
export function resolveFounderId(env) {
  if (env?.FOUNDER_TELEGRAM_ID != null && env.FOUNDER_TELEGRAM_ID !== "") {
    const n = Number(env.FOUNDER_TELEGRAM_ID);
    if (Number.isFinite(n)) return n;
  }
  if (ADMINS.length > 0) return ADMINS[0];
  return null;
}

/** @deprecated use resolveFounderId + role checks */
export function isBootstrapAdmin(userId) {
  return ADMINS.includes(Number(userId));
}
