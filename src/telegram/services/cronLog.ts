/**
 * فرستادن «پیام خبری» پایانِ کرون به گپ لاگ — با احترام به کلید خاموش/روشن.
 *
 * هر دو کرون گزارش‌دار (پاک‌سازی روزانه، همگام‌سازی ادمین‌ها) از همین‌جا رد
 * می‌شوند تا:
 *   ۱. منطق «آیا اعلان روشن است؟» یک‌جا باشد، نه کپی‌شده در دو فایل؛
 *   ۲. خطای خواندن تنظیمات، کار اصلی کرون را خراب نکند (پیش‌فرض: اعلان بفرست)؛
 *   ۳. متن خطا/لاگ هر دو مسیر یکسان بماند.
 */

import type { Env } from '../../types.js';
import type { CronNotifyKey } from '../../core/settings/cronNotify.js';
import { isCronNotifyEnabled } from '../db/cronNotify.js';
import { getErrorLogTarget } from '../db/settings.js';
import { sendMessage } from './telegramService.js';
import { errorInfo } from '../utils/errorInfo.js';

export type CronLogEnv = Pick<Env, 'TELEGRAM_TOKEN' | 'my_database'>;

/**
 * متن را به گپ لاگ می‌فرستد، مگر اینکه اعلان این کرون خاموش باشد.
 *
 * @param context پیشوند لاگ‌ها (مثل `cleanup`) تا منبع پیام در console معلوم باشد
 * @returns آیا پیامی فرستاده شد؟
 */
export async function notifyCronLog(env: CronLogEnv, key: CronNotifyKey, text: string, context: string): Promise<boolean> {
	// خطای خواندن تنظیمات نباید اعلان‌ها را برای همیشه قطع کند؛ پیش‌فرض «روشن» است
	// تا رفتار پیش از افزودن این کلید حفظ شود.
	let enabled = true;
	try {
		enabled = await isCronNotifyEnabled(env.my_database, key);
	} catch (err) {
		console.warn(`[${context}] could not read cron notification settings; sending anyway:`, err);
	}

	if (!enabled) {
		console.log(`[${context}] cron log notification is off; message skipped.`);
		return false;
	}

	let chatId: number | null = null;
	try {
		const target = await getErrorLogTarget(env.my_database);
		chatId = target.chatId;
		if (chatId === null) return false;

		await sendMessage(env, chatId, text, { threadId: target.threadId });
		return true;
	} catch (err) {
		const info = errorInfo(err);
		const reason = info.description || info.message || info.name || String(err) || 'unknown error';
		console.error(`[${context}] Failed to notify log chat ${chatId}: ${reason} (error_code=${info.errorCode ?? 'n/a'})`, info.stack);
		return false;
	}
}
