/**
 * An error to be displayed to the user (e.g., invalid input)
 * and does not need to be reported to the admin.
 *
 * Usage example:
 *   throw new UserFacingError("Invalid link format", "❌ The entered link is not valid.");
 */
export class UserFacingError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.name = "UserFacingError";
    this.userMessage = userMessage;
    this.reportToAdmin = false;
  }
}

/**
 *A critical error that must be reported to the admin
 * (e.g., database outage or an unexpected error in an external service).
 *
 * This class is optional; standard errors (regular Errors or those thrown by libraries)
 * are also reported by default unless `reportToAdmin` is set to `false`.
 */
export class CriticalError extends Error {
  constructor(message) {
    super(message);
    this.name = "CriticalError";
    this.reportToAdmin = true;
  }
}