/**
 * Resolve founder telegram id from the Worker env secret.
 * There is no code-level fallback on purpose — the founder identity
 * lives only in the `FOUNDER_TELEGRAM_ID` secret/env var per deployment.
 * @param {object|null|undefined} env
 * @returns {number|null}
 */
export function resolveFounderId(env) {
  if (env?.FOUNDER_TELEGRAM_ID != null && env.FOUNDER_TELEGRAM_ID !== "") {
    const n = Number(env.FOUNDER_TELEGRAM_ID);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
