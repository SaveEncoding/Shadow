/**
 * عملیات جدول‌های `channels` و `channel_admins`.
 *
 * ثبت کانال، یا اگر قبلاً کس دیگری ثبتش کرده، اضافه‌کردن کاربر جاری به فهرست
 * ادمین‌های همان کانال (بدون تکرار عنوان/شناسه).
 *
 * اگر هیچ چیز واقعاً عوض نشود (کاربر از قبل در فهرست ادمین‌هاست و عنوان/یوزرنیم
 * هم همان است)، هیچ نوشتنی در دیتابیس انجام نمی‌شود.
 */

import type { ChannelAdminRow, ChannelRow } from './rows.js';

export interface RegisterChannelInput {
	id: number;
	title: string;
	username: string | null;
}

export interface RegisterChannelResult {
	isNewChannel: boolean;
	ownerAssigned: boolean;
}

/**
 * @param userId شناسه‌ی تلگرامی کاربری که همین حالا فوروارد می‌کند
 * @param options `isOwner` یعنی این کاربر سازنده‌ی کانال است
 */
export async function registerChannel(
	db: D1Database,
	userId: number,
	channel: RegisterChannelInput,
	{ isOwner = false }: { isOwner?: boolean } = {},
): Promise<RegisterChannelResult> {
	const existing = await db.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channel.id).first<ChannelRow>();

	if (!existing) {
		await db
			.prepare(
				`
        INSERT INTO channels (channel_id, title, username, registered_by, owner_id)
        VALUES (?, ?, ?, ?, ?)
      `,
			)
			.bind(channel.id, channel.title, channel.username ?? null, userId, isOwner ? userId : null)
			.run();

		await db.prepare('INSERT OR IGNORE INTO channel_admins (channel_id, user_id) VALUES (?, ?)').bind(channel.id, userId).run();

		return { isNewChannel: true, ownerAssigned: isOwner };
	}

	const needsInfoUpdate = existing.title !== channel.title || existing.username !== (channel.username ?? null);
	const needsOwnerUpdate = isOwner && existing.owner_id == null;

	// فقط اگر چیزی عوض شده باشد UPDATE می‌زنیم؛ وگرنه نه به جدول `channels` نوشته
	// می‌شود و نه پیام بی‌موردی ساخته می‌شود.
	if (needsInfoUpdate || needsOwnerUpdate) {
		await db
			.prepare(
				`
        UPDATE channels
        SET title = ?,
            username = ?,
            owner_id = COALESCE(owner_id, ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE channel_id = ?
      `,
			)
			.bind(channel.title, channel.username ?? null, isOwner ? userId : null, channel.id)
			.run();
	}

	// INSERT OR IGNORE در سطح دیتابیس تضمین می‌کند اگر کاربر از قبل در فهرست
	// ادمین‌های این کانال باشد، نوشتنی روی دیسک رخ ندهد.
	await db.prepare('INSERT OR IGNORE INTO channel_admins (channel_id, user_id) VALUES (?, ?)').bind(channel.id, userId).run();

	return { isNewChannel: false, ownerAssigned: needsOwnerUpdate };
}

/** همه‌ی کانال‌هایی که کاربر به آن‌ها دسترسی ادمین دارد (خودش ثبت کرده یا بعداً اضافه شده) */
export async function getChannels(db: D1Database, userId: number): Promise<ChannelRow[]> {
	const result = await db
		.prepare(
			`
      SELECT c.*
      FROM channels c
      JOIN channel_admins ca ON ca.channel_id = c.channel_id
      WHERE ca.user_id = ?
      ORDER BY c.id DESC
    `,
		)
		.bind(userId)
		.all<ChannelRow>();

	return result.results;
}

/** گرفتن دسترسی یک کاربر از یک کانال (خود کانال و بقیه‌ی ادمین‌ها دست‌نخورده می‌مانند) */
export async function removeChannelAdmin(db: D1Database, channelId: number, userId: number) {
	return db.prepare('DELETE FROM channel_admins WHERE channel_id = ? AND user_id = ?').bind(channelId, userId).run();
}

/**
 * یک دسته‌ی محدود از کانال‌ها، مرتب بر اساس قدیمی‌ترین همگام‌سازی (آن‌هایی که
 * هرگز همگام نشده‌اند اول می‌آیند). عمداً محدود است تا هر اجرای کرون زمان
 * محدود و قابل‌پیش‌بینی داشته باشد، حتی با تعداد دلخواهی کانال؛ پوشش کامل در
 * چند اجرای پشت‌سرهم (round-robin) به دست می‌آید.
 */
export async function getChannelsNeedingAdminSync(db: D1Database, limit = 200): Promise<ChannelRow[]> {
	const result = await db
		.prepare(
			`
      SELECT *
      FROM channels
      ORDER BY admins_synced_at IS NOT NULL, admins_synced_at ASC
      LIMIT ?
    `,
		)
		.bind(limit)
		.all<ChannelRow>();

	return result.results;
}

/**
 * فهرست ادمین‌های ثبت‌شده‌ی کانال را با آخرین فهرست واقعیِ گرفته‌شده از تلگرام
 * (`getChatAdministrators`) همگام می‌کند: ادمین‌های تازه اضافه و ادمین‌های حذف‌شده
 * پاک می‌شوند. فقط کاربرانی که قبلاً بات را استارت کرده‌اند (و در جدول `users`
 * هستند) قابل اتصال‌اند؛ وگرنه محدودیت دیتابیس مانع می‌شود.
 * اگر چیزی عوض نشده باشد، هیچ `INSERT`/`DELETE` ای اجرا نمی‌شود.
 */
export async function syncChannelAdmins(
	db: D1Database,
	channelId: number,
	currentAdminUserIds: readonly number[],
): Promise<{ added: number; removed: number }> {
	if (currentAdminUserIds.length === 0) {
		await db.prepare('UPDATE channels SET admins_synced_at = CURRENT_TIMESTAMP WHERE channel_id = ?').bind(channelId).run();
		return { added: 0, removed: 0 };
	}

	const placeholders = currentAdminUserIds.map(() => '?').join(', ');
	const { results: knownUserRows } = await db
		.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`)
		.bind(...currentAdminUserIds)
		.all<{ id: number }>();
	const knownAdminIds = new Set(knownUserRows.map((row) => row.id));

	const { results: existingRows } = await db
		.prepare('SELECT user_id FROM channel_admins WHERE channel_id = ?')
		.bind(channelId)
		.all<Pick<ChannelAdminRow, 'user_id'>>();
	const existingIds = new Set(existingRows.map((row) => row.user_id));
	const currentIdSet = new Set(currentAdminUserIds);

	const toAdd = [...knownAdminIds].filter((id) => !existingIds.has(id));
	const toRemove = [...existingIds].filter((id) => !currentIdSet.has(id));

	const statements = [db.prepare('UPDATE channels SET admins_synced_at = CURRENT_TIMESTAMP WHERE channel_id = ?').bind(channelId)];
	for (const userId of toAdd) {
		statements.push(db.prepare('INSERT OR IGNORE INTO channel_admins (channel_id, user_id) VALUES (?, ?)').bind(channelId, userId));
	}
	for (const userId of toRemove) {
		statements.push(db.prepare('DELETE FROM channel_admins WHERE channel_id = ? AND user_id = ?').bind(channelId, userId));
	}

	await db.batch(statements);

	return { added: toAdd.length, removed: toRemove.length };
}

/** @param channelId شناسه‌ی تلگرامی کانال */
export async function getChannelByTelegramId(db: D1Database, channelId: number): Promise<ChannelRow | null> {
	return db.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>();
}

export async function isUserChannelAdmin(db: D1Database, channelId: number, userId: number): Promise<boolean> {
	const row = await db.prepare('SELECT 1 AS ok FROM channel_admins WHERE channel_id = ? AND user_id = ?').bind(channelId, userId).first();
	return !!row;
}

/**
 * پسوند رسمی + فهرست MessageEntity آن (آفست‌ها نسبت به متن پسوند).
 *
 * `entities` عمداً `Record<string, unknown>[]` است: این‌جا فقط یک ستون JSON از
 * دیتابیس خوانده می‌شود و شکل دقیقش را لایه‌ی متن (`sanitizeEntities`)
 * اعتبارسنجی می‌کند. ادعای نوع دقیق‌تر در این لایه، دروغِ تایپی می‌شد.
 */
export async function getOfficialSuffix(
	db: D1Database,
	channelId: number,
): Promise<{ text: string; entities: Array<Record<string, unknown>> } | null> {
	const row = await db
		.prepare('SELECT official_suffix, official_suffix_entities FROM channels WHERE channel_id = ?')
		.bind(channelId)
		.first<Pick<ChannelRow, 'official_suffix' | 'official_suffix_entities'>>();
	if (!row || row.official_suffix == null || row.official_suffix === '') {
		return null;
	}
	let entities: Array<Record<string, unknown>> = [];
	if (row.official_suffix_entities) {
		try {
			const parsed: unknown = JSON.parse(String(row.official_suffix_entities));
			if (Array.isArray(parsed)) entities = parsed;
		} catch {
			entities = [];
		}
	}
	return { text: String(row.official_suffix), entities };
}

/** @param suffix `null`/خالی، پسوند و entityها را پاک می‌کند */
export async function setOfficialSuffix(
	db: D1Database,
	channelId: number,
	suffix: string | null,
	entities: readonly unknown[] | null = null,
) {
	const value = suffix == null || String(suffix).trim() === '' ? null : String(suffix);
	let entitiesJson: string | null = null;
	if (value != null && Array.isArray(entities) && entities.length > 0) {
		entitiesJson = JSON.stringify(entities);
	}
	return db
		.prepare(
			`UPDATE channels
       SET official_suffix = ?,
           official_suffix_entities = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE channel_id = ?`,
		)
		.bind(value, entitiesJson, channelId)
		.run();
}

export async function getSuffixSkipMarker(db: D1Database, channelId: number): Promise<string | null> {
	const row = await db
		.prepare('SELECT suffix_skip_marker FROM channels WHERE channel_id = ?')
		.bind(channelId)
		.first<Pick<ChannelRow, 'suffix_skip_marker'>>();
	if (!row || row.suffix_skip_marker == null || row.suffix_skip_marker === '') {
		return null;
	}
	return String(row.suffix_skip_marker);
}

export async function setSuffixSkipMarker(db: D1Database, channelId: number, marker: string | null) {
	const value = marker == null || String(marker).trim() === '' ? null : String(marker);
	return db
		.prepare(
			`UPDATE channels
       SET suffix_skip_marker = ?, updated_at = CURRENT_TIMESTAMP
       WHERE channel_id = ?`,
		)
		.bind(value, channelId)
		.run();
}
