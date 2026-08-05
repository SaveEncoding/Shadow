/**
 * Error shown to the user (e.g. invalid input).
 * Not reported to the error-log group.
 *
 *   throw new UserFacingError("bad input", "❌ فرمت لینک معتبر نیست.");
 */
export class UserFacingError extends Error {
  /**
   * @param {string} message - Internal / log message
   * @param {string} userMessage - Safe text shown to the Telegram user
   */
  constructor(message, userMessage) {
    super(message);
    this.name = "UserFacingError";
    this.userMessage = userMessage;
    this.reportToAdmin = false;
  }
}

/**
 * Critical failure that must reach the error-log group
 * (DB outage, unexpected upstream error, …).
 * Plain `Error` is also reported by default; this class makes intent explicit.
 */
export class CriticalError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "CriticalError";
    this.reportToAdmin = true;
  }
}
