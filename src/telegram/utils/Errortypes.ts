/**
 * Error shown to the user (e.g. invalid input).
 * Not reported to the error-log group.
 *
 *   throw new UserFacingError("bad input", "❌ فرمت لینک معتبر نیست.");
 */
export class UserFacingError extends Error {
	/** پیام امنی که به کاربر تلگرام نشان داده می‌شود */
	readonly userMessage: string;
	readonly reportToAdmin = false;

	/** @param message پیام داخلی/لاگ */
	constructor(message: string, userMessage: string) {
		super(message);
		this.name = 'UserFacingError';
		this.userMessage = userMessage;
	}
}

/**
 * Critical failure that must reach the error-log group
 * (DB outage, unexpected upstream error, …).
 * Plain `Error` is also reported by default; this class makes intent explicit.
 */
export class CriticalError extends Error {
	readonly reportToAdmin = true;

	constructor(message: string) {
		super(message);
		this.name = 'CriticalError';
	}
}
