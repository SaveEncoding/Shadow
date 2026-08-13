/**
 * Short-lived in-memory "waiting for user text" state (per isolate).
 * Used so glass-button flows can collect the next private message without /commands.
 */

const pendingByUser = new Map();
const TTL_MS = 5 * 60 * 1000;

/**
 * @param {number} userId
 * @param {{ type: 'suffix'|'skip', channelId: number, promptChatId?: number, promptMessageId?: number }} payload
 */
export function setPendingInput(userId, payload) {
  pendingByUser.set(Number(userId), { ...payload, at: Date.now() });
}

/** @param {number} userId */
export function getPendingInput(userId) {
  const key = Number(userId);
  const p = pendingByUser.get(key);
  if (!p) return null;
  if (Date.now() - p.at > TTL_MS) {
    pendingByUser.delete(key);
    return null;
  }
  return p;
}

/** @param {number} userId */
export function clearPendingInput(userId) {
  pendingByUser.delete(Number(userId));
}
