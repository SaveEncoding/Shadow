/**
 * لایه‌ی داده‌ی فیچر «کپی و زمان‌بندی پست».
 *
 * تنها جایی که SQL نوشته می‌شود. همه‌ی زمان‌ها ثانیه‌ی یونیکس (INTEGER) هستند
 * تا مقایسه‌ها در SQL ساده و بدون وابستگی به فرمت متن باشد.
 */

import type { EditSession, ItemKind, PostItem, QueuePost, QueueStatus, SourceRule } from '../../core/schedule/types.js';

interface PostRow {
	id: number;
	source_channel_id: number;
	source_title: string | null;
	source_username: string | null;
	target_channel_id: number;
	media_group_id: string | null;
	status: string;
	publish_at: number;
	finalize_at: number | null;
	created_at: number;
	updated_at: number;
	published_at: number | null;
	published_message_id: number | null;
	attempts: number;
	last_error: string | null;
	created_by: number | null;
	preview_chat_id: number | null;
	preview_message_id: number | null;
	edited: number;
}

interface ItemRow {
	queue_id: number;
	source_message_id: number;
	kind: string;
	file_id: string | null;
	text: string | null;
	entities: string | null;
	extra: string | null;
}

interface RuleRow {
	id: number;
	source_channel_id: number;
	source_title: string | null;
	source_username: string | null;
	target_channel_id: number;
	delay_minutes: number;
	enabled: number;
	notify_chat_id: number | null;
	added_by: number;
	created_at: number;
	/** از JOIN با post_poll_sources (اگر منبع عمومی باشد) */
	poll_username?: string | null;
	/** از JOIN با post_x_sources (اگر منبع X باشد) */
	x_handle?: string | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function rowToItem(row: ItemRow): PostItem {
	return {
		sourceMessageId: Number(row.source_message_id),
		kind: row.kind as ItemKind,
		fileId: row.file_id ?? null,
		text: row.text ?? null,
		entities: parseJson<unknown[] | null>(row.entities, null),
		extra: parseJson<Record<string, unknown> | null>(row.extra, null),
	};
}

function rowToPost(row: PostRow, items: PostItem[]): QueuePost {
	return {
		id: Number(row.id),
		sourceChannelId: Number(row.source_channel_id),
		sourceTitle: row.source_title ?? null,
		sourceUsername: row.source_username ?? null,
		targetChannelId: Number(row.target_channel_id),
		mediaGroupId: row.media_group_id ?? null,
		status: row.status as QueueStatus,
		publishAt: Number(row.publish_at),
		finalizeAt: row.finalize_at === null ? null : Number(row.finalize_at),
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
		publishedAt: row.published_at === null ? null : Number(row.published_at),
		publishedMessageId: row.published_message_id === null ? null : Number(row.published_message_id),
		attempts: Number(row.attempts ?? 0),
		lastError: row.last_error ?? null,
		createdBy: row.created_by === null ? null : Number(row.created_by),
		previewChatId: row.preview_chat_id === null ? null : Number(row.preview_chat_id),
		previewMessageId: row.preview_message_id === null ? null : Number(row.preview_message_id),
		edited: Number(row.edited) === 1,
		items,
	};
}

function rowToRule(row: RuleRow): SourceRule {
	return {
		id: Number(row.id),
		sourceChannelId: Number(row.source_channel_id),
		sourceTitle: row.source_title ?? null,
		sourceUsername: row.source_username ?? null,
		targetChannelId: Number(row.target_channel_id),
		delayMinutes: Number(row.delay_minutes),
		enabled: Number(row.enabled) === 1,
		notifyChatId: row.notify_chat_id === null ? null : Number(row.notify_chat_id),
		pollUsername: row.poll_username ?? null,
		xHandle: row.x_handle ?? null,
		addedBy: Number(row.added_by),
		createdAt: Number(row.created_at),
	};
}

// ─────────────────────────── قوانین (مبدأ → مقصد) ───────────────────────────

export async function saveSourceRule(
	db: D1Database,
	input: {
		sourceChannelId: number;
		sourceTitle: string | null;
		sourceUsername: string | null;
		targetChannelId: number;
		delayMinutes: number;
		addedBy: number;
		notifyChatId: number | null;
		/** اگر پر باشد، این منبع از پیش‌نمایش وب خوانده می‌شود (بات عضو کانال نیست) */
		pollUsername?: string | null;
		/** اگر پر باشد، منبع یک حساب X است */
		xHandle?: string | null;
		now: number;
	},
): Promise<number> {
	// NOTE: `meta.last_row_id` را عمداً نمی‌خوانیم.
	// در مسیر `ON CONFLICT DO UPDATE` مقدار `last_insert_rowid` تغییر نمی‌کند و
	// شناسه‌ی آخرین INSERT این اتصال را برمی‌گرداند — یعنی می‌توانست ردیف‌های
	// poll/X را به قانون دیگری بچسباند. شناسه همیشه از خودِ جدول خوانده می‌شود.
	const row = await db
		.prepare(
			`INSERT INTO post_sources
			   (source_channel_id, source_title, source_username, target_channel_id, delay_minutes, enabled, notify_chat_id, added_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
			 ON CONFLICT(source_channel_id) DO UPDATE SET
			   source_title = excluded.source_title,
			   source_username = excluded.source_username,
			   target_channel_id = excluded.target_channel_id,
			   delay_minutes = excluded.delay_minutes,
			   enabled = 1,
			   notify_chat_id = excluded.notify_chat_id,
			   added_by = excluded.added_by,
			   updated_at = excluded.updated_at
			 RETURNING id`,
		)
		.bind(
			input.sourceChannelId,
			input.sourceTitle,
			input.sourceUsername,
			input.targetChannelId,
			input.delayMinutes,
			input.notifyChatId,
			input.addedBy,
			input.now,
			input.now,
		)
		.first<{ id: number }>();

	// RETURNING هر دو مسیر (INSERT و UPDATE) را پوشش می‌دهد؛ SELECT فقط تور ایمنی است.
	const ruleId = Number(row?.id ?? 0) || (await findRuleIdBySourceChannel(db, input.sourceChannelId)) || 0;

	if (input.pollUsername) {
		await upsertPollSource(db, { ruleId, username: input.pollUsername, now: input.now });
	} else if (ruleId) {
		await db.prepare('DELETE FROM post_poll_sources WHERE rule_id = ?').bind(ruleId).run();
	}

	if (input.xHandle) {
		await upsertXSource(db, { ruleId, handle: input.xHandle, now: input.now });
	} else if (ruleId) {
		await db.prepare('DELETE FROM post_x_sources WHERE rule_id = ?').bind(ruleId).run();
	}

	return ruleId;
}

async function findRuleIdBySourceChannel(db: D1Database, sourceChannelId: number): Promise<number | null> {
	const row = await db.prepare('SELECT id FROM post_sources WHERE source_channel_id = ?').bind(sourceChannelId).first<{ id: number }>();
	return row ? Number(row.id) : null;
}

export async function getSourceRule(db: D1Database, sourceChannelId: number): Promise<SourceRule | null> {
	const row = await db
		.prepare(
			`SELECT s.*, p.username AS poll_username, x.handle AS x_handle FROM post_sources s
			 LEFT JOIN post_poll_sources p ON p.rule_id = s.id
			 LEFT JOIN post_x_sources x ON x.rule_id = s.id
			 WHERE s.source_channel_id = ?`,
		)
		.bind(sourceChannelId)
		.first<RuleRow>();
	return row ? rowToRule(row) : null;
}

export async function listRulesForTarget(db: D1Database, targetChannelId: number): Promise<SourceRule[]> {
	const { results } = await db
		.prepare(
			`SELECT s.*, p.username AS poll_username, x.handle AS x_handle FROM post_sources s
			 LEFT JOIN post_poll_sources p ON p.rule_id = s.id
			 LEFT JOIN post_x_sources x ON x.rule_id = s.id
			 WHERE s.target_channel_id = ? ORDER BY s.id DESC`,
		)
		.bind(targetChannelId)
		.all<RuleRow>();
	return (results ?? []).map(rowToRule);
}

export async function listRulesForUser(db: D1Database, userId: number): Promise<SourceRule[]> {
	const { results } = await db
		.prepare(
			`SELECT s.*, p.username AS poll_username, x.handle AS x_handle FROM post_sources s
			 LEFT JOIN post_poll_sources p ON p.rule_id = s.id
			 LEFT JOIN post_x_sources x ON x.rule_id = s.id
			 WHERE s.added_by = ? ORDER BY s.id DESC`,
		)
		.bind(userId)
		.all<RuleRow>();
	return (results ?? []).map(rowToRule);
}

export async function setRuleEnabled(db: D1Database, sourceChannelId: number, enabled: boolean, now: number): Promise<void> {
	await db
		.prepare('UPDATE post_sources SET enabled = ?, updated_at = ? WHERE source_channel_id = ?')
		.bind(enabled ? 1 : 0, now, sourceChannelId)
		.run();
}

export async function setRuleDelay(db: D1Database, sourceChannelId: number, delayMinutes: number, now: number): Promise<void> {
	await db
		.prepare('UPDATE post_sources SET delay_minutes = ?, updated_at = ? WHERE source_channel_id = ?')
		.bind(delayMinutes, now, sourceChannelId)
		.run();
}

export async function deleteSourceRule(db: D1Database, sourceChannelId: number): Promise<void> {
	const ruleId = await findRuleIdBySourceChannel(db, sourceChannelId);
	if (ruleId) {
		await db.prepare('DELETE FROM post_poll_sources WHERE rule_id = ?').bind(ruleId).run();
		await db.prepare('DELETE FROM post_x_sources WHERE rule_id = ?').bind(ruleId).run();
	}
	await db.prepare('DELETE FROM post_sources WHERE source_channel_id = ?').bind(sourceChannelId).run();
}

// ─────────────────── منابع عمومی (بدون عضویت بات) ───────────────────

export interface PollSourceRow {
	ruleId: number;
	username: string;
	cursorMessageId: number;
	lastPolledAt: number | null;
	lastError: string | null;
	failures: number;
}

export async function upsertPollSource(
	db: D1Database,
	input: { ruleId: number; username: string; now: number; cursorMessageId?: number },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO post_poll_sources (rule_id, username, cursor_message_id, last_polled_at, failures)
			 VALUES (?, ?, ?, ?, 0)
			 ON CONFLICT(rule_id) DO UPDATE SET
			   username = excluded.username,
			   cursor_message_id = excluded.cursor_message_id`,
		)
		.bind(input.ruleId, input.username.replace(/^@/, '').toLowerCase(), input.cursorMessageId ?? 0, input.now)
		.run();
}

export async function getPollSource(db: D1Database, ruleId: number): Promise<PollSourceRow | null> {
	const row = await db.prepare('SELECT * FROM post_poll_sources WHERE rule_id = ?').bind(ruleId).first<{
		rule_id: number;
		username: string;
		cursor_message_id: number;
		last_polled_at: number | null;
		last_error: string | null;
		failures: number;
	}>();
	if (!row) return null;
	return {
		ruleId: Number(row.rule_id),
		username: String(row.username),
		cursorMessageId: Number(row.cursor_message_id ?? 0),
		lastPolledAt: row.last_polled_at === null ? null : Number(row.last_polled_at),
		lastError: row.last_error ?? null,
		failures: Number(row.failures ?? 0),
	};
}

/** منابع عمومیِ فعالِ یک کانال مقصد (برای کرون) */
/**
 * بخش مشترک دو فهرست «منبع فعال»: همان `WHERE`، همان ترتیب bind ها.
 * کوئری‌ها فرق دارند (جدول و ستون‌ها)، ولی این شرط و سقف یکی است؛ اگر روزی
 * تعریف «فعال» عوض شود، فقط این‌جا عوض می‌شود.
 */
function activeSourceClause(options: { targetChannelId?: number; limit?: number }): { where: string; binds: number[] } {
	const limit = options.limit ?? 20;
	if (options.targetChannelId === undefined) {
		return { where: 'WHERE s.enabled = 1', binds: [limit] };
	}
	return { where: 'WHERE s.enabled = 1 AND s.target_channel_id = ?', binds: [options.targetChannelId, limit] };
}

export async function listActivePollSources(
	db: D1Database,
	options: { targetChannelId?: number; limit?: number } = {},
): Promise<Array<PollSourceRow & { rule: SourceRule }>> {
	const { where, binds } = activeSourceClause(options);
	const { results } = await db
		.prepare(
			`SELECT s.*, p.username AS poll_username, p.cursor_message_id, p.last_polled_at, p.last_error, p.failures
			 FROM post_poll_sources p
			 JOIN post_sources s ON s.id = p.rule_id
			 ${where}
			 ORDER BY COALESCE(p.last_polled_at, 0) ASC
			 LIMIT ?`,
		)
		.bind(...binds)
		.all<RuleRow & { cursor_message_id: number; last_polled_at: number | null; last_error: string | null; failures: number }>();

	return (results ?? []).map((row) => ({
		ruleId: Number(row.id),
		username: String(row.poll_username ?? ''),
		cursorMessageId: Number(row.cursor_message_id ?? 0),
		lastPolledAt: row.last_polled_at === null ? null : Number(row.last_polled_at),
		lastError: row.last_error ?? null,
		failures: Number(row.failures ?? 0),
		rule: rowToRule(row),
	}));
}

/** ثبت نتیجه‌ی یک بار خواندن: کِرسر جلو می‌رود، خطا/موفقیت ثبت می‌شود */
export async function recordPollResult(
	db: D1Database,
	input: { ruleId: number; cursorMessageId?: number; now: number; error?: string | null },
): Promise<void> {
	if (input.error) {
		await db
			.prepare(
				`UPDATE post_poll_sources
				 SET last_polled_at = ?, last_error = ?, failures = failures + 1
				 WHERE rule_id = ?`,
			)
			.bind(input.now, input.error.slice(0, 300), input.ruleId)
			.run();
		return;
	}

	await db
		.prepare(
			`UPDATE post_poll_sources
			 SET cursor_message_id = MAX(cursor_message_id, ?), last_polled_at = ?, last_error = NULL, failures = 0
			 WHERE rule_id = ?`,
		)
		.bind(input.cursorMessageId ?? 0, input.now, input.ruleId)
		.run();
}

// ─────────────────── منابع X (توییتر) ───────────────────

export interface XSourceRow {
	ruleId: number;
	handle: string;
	/** شناسه‌ی عددی کاربر در X (کش) */
	userId: string | null;
	/** شناسه‌ی آخرین توییت خوانده‌شده */
	cursorId: string | null;
	lastPolledAt: number | null;
	lastError: string | null;
	failures: number;
}

export async function upsertXSource(
	db: D1Database,
	input: { ruleId: number; handle: string; now: number; cursorId?: string | null },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO post_x_sources (rule_id, handle, cursor_id, last_polled_at, failures)
			 VALUES (?, ?, ?, ?, 0)
			 ON CONFLICT(rule_id) DO UPDATE SET
			   handle = excluded.handle,
			   cursor_id = COALESCE(excluded.cursor_id, post_x_sources.cursor_id)`,
		)
		.bind(input.ruleId, input.handle.replace(/^@/, '').toLowerCase(), input.cursorId ?? null, input.now)
		.run();
}

function rowToXSource(row: {
	rule_id: number;
	handle: string;
	user_id: string | null;
	cursor_id: string | null;
	last_polled_at: number | null;
	last_error: string | null;
	failures: number;
}): XSourceRow {
	return {
		ruleId: Number(row.rule_id),
		handle: String(row.handle),
		userId: row.user_id ?? null,
		cursorId: row.cursor_id ?? null,
		lastPolledAt: row.last_polled_at === null ? null : Number(row.last_polled_at),
		lastError: row.last_error ?? null,
		failures: Number(row.failures ?? 0),
	};
}

export async function getXSource(db: D1Database, ruleId: number): Promise<XSourceRow | null> {
	const row = await db.prepare('SELECT * FROM post_x_sources WHERE rule_id = ?').bind(ruleId).first<{
		rule_id: number;
		handle: string;
		user_id: string | null;
		cursor_id: string | null;
		last_polled_at: number | null;
		last_error: string | null;
		failures: number;
	}>();
	return row ? rowToXSource(row) : null;
}

/** منابع X فعال (برای کرون) */
export async function listActiveXSources(
	db: D1Database,
	options: { targetChannelId?: number; limit?: number } = {},
): Promise<Array<XSourceRow & { rule: SourceRule }>> {
	const { where, binds } = activeSourceClause(options);
	const { results } = await db
		.prepare(
			`SELECT s.*, p.username AS poll_username, x.handle AS x_handle, x.handle,
			        x.rule_id, x.user_id, x.cursor_id, x.last_polled_at, x.last_error, x.failures
			 FROM post_x_sources x
			 JOIN post_sources s ON s.id = x.rule_id
			 LEFT JOIN post_poll_sources p ON p.rule_id = s.id
			 ${where}
			 ORDER BY COALESCE(x.last_polled_at, 0) ASC
			 LIMIT ?`,
		)
		.bind(...binds)
		.all<
			RuleRow & {
				handle: string;
				user_id: string | null;
				cursor_id: string | null;
				last_polled_at: number | null;
				last_error: string | null;
				failures: number;
			}
		>();

	return (results ?? []).map((row) => ({
		...rowToXSource({
			rule_id: Number(row.id),
			handle: String(row.handle),
			user_id: row.user_id ?? null,
			cursor_id: row.cursor_id ?? null,
			last_polled_at: row.last_polled_at,
			last_error: row.last_error,
			failures: row.failures,
		}),
		rule: rowToRule(row),
	}));
}

/** ثبت نتیجه‌ی خواندن X: کِرسر/شناسه‌ی کاربر جلو می‌رود، خطا ثبت می‌شود */
export async function recordXPollResult(
	db: D1Database,
	input: { ruleId: number; now: number; cursorId?: string | null; userId?: string | null; error?: string | null },
): Promise<void> {
	if (input.error) {
		await db
			.prepare(
				`UPDATE post_x_sources
				 SET last_polled_at = ?, last_error = ?, failures = failures + 1
				 WHERE rule_id = ?`,
			)
			.bind(input.now, input.error.slice(0, 400), input.ruleId)
			.run();
		return;
	}

	await db
		.prepare(
			`UPDATE post_x_sources
			 SET cursor_id = COALESCE(?, cursor_id),
			     user_id = COALESCE(?, user_id),
			     last_polled_at = ?,
			     last_error = NULL,
			     failures = 0
			 WHERE rule_id = ?`,
		)
		.bind(input.cursorId ?? null, input.userId ?? null, input.now, input.ruleId)
		.run();
}

// ─────────────────────────── صف پست‌ها ───────────────────────────

/**
 * ثبت دیده‌شدن یک پیام مبدأ.
 * خروجی false یعنی این پیام قبلاً پردازش شده است (retry وبهوک یا آلبوم تکراری)
 * و هیچ ردیفی نباید ساخته شود.
 */
export async function markMessageSeen(db: D1Database, sourceChannelId: number, sourceMessageId: number, now: number): Promise<boolean> {
	const result = await db
		.prepare('INSERT OR IGNORE INTO post_seen (source_channel_id, source_message_id, created_at) VALUES (?, ?, ?)')
		.bind(sourceChannelId, sourceMessageId, now)
		.run();
	return Number(result.meta?.changes ?? 0) > 0;
}

/** ایجاد یک پست جدید در حالت جمع‌آوری */
export async function createQueuedPost(
	db: D1Database,
	input: {
		sourceChannelId: number;
		/** عنوان/یوزرنیم مبدأ برای نمایش؛ اختیاری */
		sourceTitle?: string | null;
		sourceUsername?: string | null;
		targetChannelId: number;
		mediaGroupId: string | null;
		createdBy: number | null;
		now: number;
	},
): Promise<number> {
	const result = await db
		.prepare(
			`INSERT INTO post_queue
			   (source_channel_id, source_title, source_username, target_channel_id, media_group_id, status, publish_at, finalize_at, created_at, updated_at, created_by)
			 VALUES (?, ?, ?, ?, ?, 'collecting', 0, ?, ?, ?, ?)`,
		)
		.bind(
			input.sourceChannelId,
			input.sourceTitle ?? null,
			input.sourceUsername ?? null,
			input.targetChannelId,
			input.mediaGroupId,
			input.now,
			input.now,
			input.now,
			input.createdBy,
		)
		.run();
	return Number(result.meta?.last_row_id ?? 0);
}

/** پست در حال جمع‌آوری برای همین آلبوم (اگر وجود دارد) */
export async function findCollectingPost(db: D1Database, sourceChannelId: number, mediaGroupId: string): Promise<number | null> {
	const row = await db
		.prepare(
			`SELECT id FROM post_queue
			 WHERE source_channel_id = ? AND media_group_id = ? AND status = 'collecting'
			 ORDER BY id DESC LIMIT 1`,
		)
		.bind(sourceChannelId, mediaGroupId)
		.first<{ id: number }>();
	return row ? Number(row.id) : null;
}

/**
 * افزودن یک آیتم؛ false یعنی تکراری بود.
 * `finalizeAt` پایان مهلت جمع‌آوری آلبوم است؛ کرون بعد از آن پست را نهایی می‌کند.
 */
export async function appendItem(
	db: D1Database,
	queueId: number,
	item: PostItem,
	now: number,
	finalizeAt: number = now,
	/** فراداده‌ی اضافه که با extra آیتم ادغام می‌شود (مثلاً URL منبع وب) */
	extraPatch: Record<string, unknown> | null = null,
): Promise<boolean> {
	const extra = extraPatch ? { ...(item.extra ?? {}), ...extraPatch } : item.extra;
	// دو statement، ولی **یک** رفت‌وبرگشت: `batch` در D1 اتمیک و تک‌درخواستی است.
	// ترتیب مهم است: اگر INSERT تکراری بود (changes = 0) هم UPDATE باید اجرا شود،
	// چون مهلت جمع‌آوری آلبوم با هر آیتم تازه تمدید می‌شود.
	const [insert] = await db.batch([
		db
			.prepare(
				`INSERT OR IGNORE INTO post_queue_items (queue_id, source_message_id, kind, file_id, text, entities, extra)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				queueId,
				item.sourceMessageId,
				item.kind,
				item.fileId,
				item.text,
				item.entities ? JSON.stringify(item.entities) : null,
				extra ? JSON.stringify(extra) : null,
			),
		db.prepare('UPDATE post_queue SET updated_at = ?, finalize_at = ? WHERE id = ?').bind(now, finalizeAt, queueId),
	]);
	return Number(insert!.meta?.changes ?? 0) > 0;
}

/**
 * پایان جمع‌آوری و تعیین زمان انتشار.
 * پست خالی (بدون آیتم) حذف می‌شود تا صف زامبی نداشته باشیم.
 */
export async function finalizePost(db: D1Database, queueId: number, publishAt: number, now: number): Promise<boolean> {
	// مسیر عادی یک statement است: وجود آیتم‌ها با EXISTS داخل همان UPDATE بررسی
	// می‌شود (قبلاً یک COUNT و بعد یک UPDATE بود). فقط در حالت «پست بدون آیتم»
	// یک DELETE دوم لازم است تا صف زامبی نداشته باشیم.
	const result = await db
		.prepare(
			`UPDATE post_queue
			 SET status = 'scheduled', publish_at = ?, finalize_at = NULL, updated_at = ?
			 WHERE id = ? AND status = 'collecting'
			   AND EXISTS (SELECT 1 FROM post_queue_items WHERE queue_id = ?)`,
		)
		.bind(publishAt, now, queueId, queueId)
		.run();
	if (Number(result.meta?.changes ?? 0) > 0) return true;

	// یا آیتمی ندارد (باید پاک شود) یا دیگر collecting نیست (تیک دیگری زودتر بست)
	await db
		.prepare('DELETE FROM post_queue WHERE id = ? AND status = ? AND NOT EXISTS (SELECT 1 FROM post_queue_items WHERE queue_id = ?)')
		.bind(queueId, 'collecting', queueId)
		.run();
	return false;
}

/** پست‌های آماده (وقت انتشار رسیده یا آلبوم تمام‌شده) */
export async function listReadyPosts(db: D1Database, now: number, limit: number): Promise<number[]> {
	// چرا دو SELECT و نه یک `OR`؟ چون در `OR`، SQLite هر دو شاخه را جمع می‌کند و
	// برای `ORDER BY publish_at` یک TEMP B-TREE روی **همه‌ی** ردیف‌های سررسیده
	// می‌سازد (یعنی `LIMIT` زودتر تمام نمی‌شود) و شاخه‌ی `collecting` فقط با
	// پیشوند `status = ?` جلو می‌رود. با دو کوئری، هر شاخه روی ایندکس خودش مرتب
	// است و بعد از `LIMIT` تمام می‌شود؛ ادغامشان در حافظه روی حداکثر ۲×limit ردیف
	// انجام می‌شود. `batch` یعنی این دو در **یک** رفت‌وبرگشت به D1 می‌روند.
	const [scheduled, collecting] = await db.batch<{ id: number; publish_at: number }>([
		db
			.prepare(
				`SELECT id, publish_at FROM post_queue
				 WHERE status = 'scheduled' AND publish_at <= ?
				 ORDER BY publish_at ASC
				 LIMIT ?`,
			)
			.bind(now, limit),
		db
			.prepare(
				`SELECT id, publish_at FROM post_queue
				 WHERE status = 'collecting' AND finalize_at IS NOT NULL AND finalize_at <= ?
				 ORDER BY publish_at ASC
				 LIMIT ?`,
			)
			.bind(now, limit),
	]);

	// یک ردیف یا `scheduled` است یا `collecting`، پس ادغام تکراری ندارد.
	const ready = [...(scheduled?.results ?? []), ...(collecting?.results ?? [])];
	ready.sort((a, b) => Number(a.publish_at) - Number(b.publish_at));
	return ready.slice(0, limit).map((row) => Number(row.id));
}

/**
 * چند پست با هم، در دو کوئری ثابت (نه دو کوئری برای هر پست).
 * ترتیب ورودی حفظ می‌شود تا صفحه‌ی صف همان ترتیب `publish_at` را ببیند.
 */
export async function getPostsByIds(db: D1Database, ids: number[]): Promise<QueuePost[]> {
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => '?').join(', ');
	const { results } = await db
		.prepare(`SELECT * FROM post_queue WHERE id IN (${placeholders})`)
		.bind(...ids)
		.all<PostRow>();
	return buildPosts(db, results ?? [], ids);
}

/**
 * ساختن `QueuePost` از ردیف‌هایی که از قبل خوانده شده‌اند؛ فقط آیتم‌ها یک کوئری
 * جدا می‌خواهند. این‌طور `listPendingPosts` لازم نیست ردیف‌ها را دوباره بخواند.
 */
async function buildPosts(db: D1Database, rows: PostRow[], order: number[]): Promise<QueuePost[]> {
	if (rows.length === 0) return [];

	const items = await db
		.prepare(`SELECT * FROM post_queue_items WHERE queue_id IN (${order.map(() => '?').join(', ')}) ORDER BY source_message_id ASC`)
		.bind(...order)
		.all<ItemRow>();

	const itemsByPost = new Map<number, PostItem[]>();
	for (const row of items.results ?? []) {
		const key = Number(row.queue_id);
		const list = itemsByPost.get(key);
		if (list) list.push(rowToItem(row));
		else itemsByPost.set(key, [rowToItem(row)]);
	}

	const byId = new Map<number, QueuePost>();
	for (const row of rows) byId.set(Number(row.id), rowToPost(row, itemsByPost.get(Number(row.id)) ?? []));

	return order.map((id) => byId.get(id)).filter((post): post is QueuePost => Boolean(post));
}

/** قوانین چند منبع با هم (برای محاسبه‌ی تأخیر آلبوم‌ها در یک کوئری) */
export async function getRulesForSources(db: D1Database, sourceChannelIds: number[]): Promise<SourceRule[]> {
	if (sourceChannelIds.length === 0) return [];
	const placeholders = sourceChannelIds.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT s.*, p.username AS poll_username, x.handle AS x_handle FROM post_sources s
			 LEFT JOIN post_poll_sources p ON p.rule_id = s.id
			 LEFT JOIN post_x_sources x ON x.rule_id = s.id
			 WHERE s.source_channel_id IN (${placeholders})`,
		)
		.bind(...sourceChannelIds)
		.all<RuleRow>();
	return (results ?? []).map(rowToRule);
}

/** از میان شناسه‌های کاندید، کدام‌ها هنوز در حال جمع‌آوری‌اند؟ (یک کوئری) */
export async function listCollectingAmong(db: D1Database, ids: number[]): Promise<number[]> {
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => '?').join(', ');
	const { results } = await db
		.prepare(`SELECT id FROM post_queue WHERE id IN (${placeholders}) AND status = 'collecting'`)
		.bind(...ids)
		.all<{ id: number }>();
	return (results ?? []).map((r) => Number(r.id));
}

export async function getPost(db: D1Database, id: number): Promise<QueuePost | null> {
	const row = await db.prepare('SELECT * FROM post_queue WHERE id = ?').bind(id).first<PostRow>();
	if (!row) return null;
	const { results } = await db
		.prepare('SELECT * FROM post_queue_items WHERE queue_id = ? ORDER BY source_message_id ASC')
		.bind(id)
		.all<ItemRow>();
	return rowToPost(row, (results ?? []).map(rowToItem));
}

/**
 * گرفتن قفل انتشار. اگر false برگردد، یک اجرای دیگر (یا کلیک دیگر) زودتر آن را
 * برداشته است — پس نباید دوباره ارسال شود. این تنها محافظ در برابر پست تکراری است.
 */
/**
 * قفل انتشار: تنها یک فراخواننده برنده می‌شود.
 *
 * هر دو حالت در یک `UPDATE` اتمیک هستند (`scheduled` و آلبومی که هنوز
 * `collecting` است)؛ قبلاً دو UPDATE پشت‌سرهم بود که هم یک رفت‌وبرگشت
 * اضافه داشت و هم برنده‌شدن را به ترتیب اجرا گره می‌زد.
 */
export async function claimForPublish(db: D1Database, id: number, now: number): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE post_queue SET status = 'publishing', updated_at = ?
			 WHERE id = ? AND status IN ('scheduled', 'collecting')`,
		)
		.bind(now, id)
		.run();
	return Number(result.meta?.changes ?? 0) > 0;
}

export async function markPublished(db: D1Database, id: number, messageId: number | null, now: number): Promise<void> {
	await db
		.prepare(
			`UPDATE post_queue
			 SET status = 'published', published_at = ?, published_message_id = ?, last_error = NULL, updated_at = ?
			 WHERE id = ?`,
		)
		.bind(now, messageId, now, id)
		.run();
}

/** ثبت خطا؛ اگر تلاش‌ها تمام شده باشد، پست failed می‌شود */
export async function markFailed(
	db: D1Database,
	id: number,
	error: string,
	now: number,
	retryAt: number | null,
	attempts: number,
): Promise<void> {
	if (retryAt === null) {
		await db
			.prepare(`UPDATE post_queue SET status = 'failed', last_error = ?, attempts = ?, updated_at = ? WHERE id = ?`)
			.bind(error, attempts, now, id)
			.run();
		return;
	}

	await db
		.prepare(
			`UPDATE post_queue
			 SET status = 'scheduled', last_error = ?, attempts = ?, publish_at = ?, updated_at = ?
			 WHERE id = ?`,
		)
		.bind(error, attempts, retryAt, now, id)
		.run();
}

export async function cancelPost(db: D1Database, id: number, now: number): Promise<void> {
	await db
		.prepare(
			`UPDATE post_queue SET status = 'canceled', updated_at = ?
			 WHERE id = ? AND status IN ('collecting', 'scheduled', 'failed')`,
		)
		.bind(now, id)
		.run();
}

export async function reschedulePost(db: D1Database, id: number, publishAt: number, now: number): Promise<void> {
	await db
		.prepare(
			`UPDATE post_queue SET publish_at = ?, status = 'scheduled', finalize_at = NULL, updated_at = ?
			 WHERE id = ? AND status IN ('collecting', 'scheduled', 'failed')`,
		)
		.bind(publishAt, now, id)
		.run();
}

export async function setPreviewMessage(db: D1Database, id: number, chatId: number, messageId: number): Promise<void> {
	await db.prepare('UPDATE post_queue SET preview_chat_id = ?, preview_message_id = ? WHERE id = ?').bind(chatId, messageId, id).run();
}

/** به‌روزرسانی متن/کپشن یک آیتم (ویرایش ادمین) */
export async function updateItemContent(
	db: D1Database,
	queueId: number,
	sourceMessageId: number,
	content: { text: string | null; entities: unknown[] | null },
	now: number,
): Promise<void> {
	await db
		.prepare(`UPDATE post_queue_items SET text = ?, entities = ? WHERE queue_id = ? AND source_message_id = ?`)
		.bind(content.text, content.entities ? JSON.stringify(content.entities) : null, queueId, sourceMessageId)
		.run();
	await db.prepare('UPDATE post_queue SET edited = 1, updated_at = ? WHERE id = ?').bind(now, queueId).run();
}

/** آیتمی که در حال حاضر در صف است و به این پیام مبدأ اشاره می‌کند (برای ویرایش پست مبدأ) */
export async function findItemBySourceMessage(
	db: D1Database,
	sourceChannelId: number,
	sourceMessageId: number,
): Promise<{ post: QueuePost; item: PostItem } | null> {
	const row = await db
		.prepare(
			`SELECT q.* FROM post_queue q
			 JOIN post_queue_items i ON i.queue_id = q.id
			 WHERE q.source_channel_id = ? AND i.source_message_id = ?
			 ORDER BY q.id DESC LIMIT 1`,
		)
		.bind(sourceChannelId, sourceMessageId)
		.first<PostRow>();
	if (!row) return null;
	const post = await getPost(db, Number(row.id));
	if (!post) return null;
	const item = post.items.find((i) => i.sourceMessageId === sourceMessageId);
	return item ? { post, item } : null;
}

/** پست‌های در انتظار یک کانال مقصد (برای صفحه‌ی مدیریت) */
export async function listPendingPosts(db: D1Database, targetChannelId: number, limit = 10): Promise<QueuePost[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM post_queue
			 WHERE target_channel_id = ? AND status IN ('collecting', 'scheduled', 'publishing')
			 ORDER BY publish_at ASC, id ASC LIMIT ?`,
		)
		.bind(targetChannelId, limit)
		.all<PostRow>();
	// قبلاً برای هر ردیف دو کوئری (پست + آیتم‌ها) زده می‌شد؛ حالا همیشه دو کوئری.
	const rows = results ?? [];
	return buildPosts(
		db,
		rows,
		rows.map((row) => Number(row.id)),
	);
}

export async function countPendingPosts(db: D1Database, targetChannelId: number): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM post_queue
			 WHERE target_channel_id = ? AND status IN ('collecting', 'scheduled', 'publishing')`,
		)
		.bind(targetChannelId)
		.first<{ n: number }>();
	return Number(row?.n ?? 0);
}

/** پست‌های گیرکرده در حالت publishing (مثلاً Worker وسط ارسال مرده) */
export async function listStuckPosts(db: D1Database, now: number, thresholdSeconds: number): Promise<number[]> {
	const { results } = await db
		.prepare(`SELECT id FROM post_queue WHERE status = 'publishing' AND updated_at <= ? LIMIT 20`)
		.bind(now - thresholdSeconds)
		.all<{ id: number }>();
	return (results ?? []).map((r) => Number(r.id));
}

/** پاک‌سازی رکوردهای قدیمی dedupe (جلوگیری از رشد بی‌نهایت) */
export async function pruneSeen(db: D1Database, olderThan: number): Promise<void> {
	await db.prepare('DELETE FROM post_seen WHERE created_at < ?').bind(olderThan).run();
}

// ─────────────────────────── جلسه‌های ویرایش ───────────────────────────

export async function startEditSession(
	db: D1Database,
	input: {
		postId: number;
		userId: number;
		chatId: number;
		messageId: number;
		field: 'text' | 'caption';
		targetMessageId: number;
		expiresAt: number;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO post_edit_sessions
			   (post_id, user_id, chat_id, message_id, field, target_message_id, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET
			   post_id = excluded.post_id,
			   chat_id = excluded.chat_id,
			   message_id = excluded.message_id,
			   field = excluded.field,
			   target_message_id = excluded.target_message_id,
			   expires_at = excluded.expires_at`,
		)
		.bind(input.postId, input.userId, input.chatId, input.messageId, input.field, input.targetMessageId, input.expiresAt)
		.run();
}

export async function findEditSession(db: D1Database, userId: number, now: number): Promise<EditSession | null> {
	const row = await db.prepare('SELECT * FROM post_edit_sessions WHERE user_id = ? AND expires_at > ?').bind(userId, now).first<{
		id: number;
		post_id: number;
		user_id: number;
		chat_id: number;
		message_id: number;
		field: string;
		target_message_id: number;
		expires_at: number;
	}>();
	if (!row) return null;
	return {
		id: Number(row.id),
		postId: Number(row.post_id),
		userId: Number(row.user_id),
		chatId: Number(row.chat_id),
		messageId: Number(row.message_id),
		field: row.field === 'caption' ? 'caption' : 'text',
		targetMessageId: Number(row.target_message_id),
		expiresAt: Number(row.expires_at),
	};
}

/** جلسه‌ی «منتظر فوروارد/یوزرنیم» (همان شکلی که `findCaptureSession` برمی‌گرداند) */
export interface CaptureSession {
	targetChannelId: number;
	mode: 'manual' | 'source' | 'public' | 'x';
	delayMinutes: number;
	expiresAt: number;
}

/**
 * هر دو جلسه‌ی «منتظر ورودی» در **یک** کوئری.
 *
 * هر پیام خصوصی از دو هندلر رد می‌شود: اول «ویرایش متن»، بعد «فوروارد/دستور».
 * هر کدام جدا سراغ جدول خودش می‌رفت، یعنی هر پیام دو کوئری. این تابع هر دو را با
 * یک `UNION ALL` می‌آورد و `postScheduler` نتیجه را برای هر دو هندلر استفاده
 * می‌کند (بدون کش سراسری؛ کش به همان update گره می‌خورد).
 */
export async function findUserSessions(
	db: D1Database,
	userId: number,
	now: number,
): Promise<{ edit: EditSession | null; capture: CaptureSession | null }> {
	const { results } = await db
		.prepare(
			`SELECT 'edit' AS kind, id, post_id, user_id, chat_id, message_id, field, target_message_id, NULL AS target_channel_id, NULL AS mode, NULL AS delay_minutes, expires_at
			   FROM post_edit_sessions WHERE user_id = ? AND expires_at > ?
			 UNION ALL
			 SELECT 'capture' AS kind, NULL, NULL, user_id, NULL, NULL, NULL, NULL, target_channel_id, mode, delay_minutes, expires_at
			   FROM post_capture_sessions WHERE user_id = ? AND expires_at > ?`,
		)
		.bind(userId, now, userId, now)
		.all<{
			kind: string;
			id: number | null;
			post_id: number | null;
			chat_id: number | null;
			message_id: number | null;
			field: string | null;
			target_message_id: number | null;
			target_channel_id: number | null;
			mode: string | null;
			delay_minutes: number | null;
			expires_at: number;
		}>();

	let edit: EditSession | null = null;
	let capture: CaptureSession | null = null;

	for (const row of results ?? []) {
		if (row.kind === 'edit' && !edit) {
			edit = {
				id: Number(row.id),
				postId: Number(row.post_id),
				userId: Number(userId),
				chatId: Number(row.chat_id),
				messageId: Number(row.message_id),
				field: row.field === 'caption' ? 'caption' : 'text',
				targetMessageId: Number(row.target_message_id),
				expiresAt: Number(row.expires_at),
			};
			continue;
		}
		if (row.kind === 'capture' && !capture) {
			capture = {
				targetChannelId: Number(row.target_channel_id),
				mode: row.mode === 'source' ? 'source' : row.mode === 'public' ? 'public' : row.mode === 'x' ? 'x' : 'manual',
				delayMinutes: Number(row.delay_minutes ?? 30),
				expiresAt: Number(row.expires_at),
			};
		}
	}

	return { edit, capture };
}

export async function clearEditSession(db: D1Database, userId: number): Promise<void> {
	await db.prepare('DELETE FROM post_edit_sessions WHERE user_id = ?').bind(userId).run();
}

export async function pruneEditSessions(db: D1Database, now: number): Promise<void> {
	await db.prepare('DELETE FROM post_edit_sessions WHERE expires_at <= ?').bind(now).run();
}

// ─────────────────────────── حالت «کپی دستی» ───────────────────────────

export async function startCaptureSession(
	db: D1Database,
	input: { userId: number; targetChannelId: number; mode: 'manual' | 'source' | 'public' | 'x'; delayMinutes: number; expiresAt: number },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO post_capture_sessions (user_id, target_channel_id, mode, delay_minutes, expires_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET
			   target_channel_id = excluded.target_channel_id,
			   mode = excluded.mode,
			   delay_minutes = excluded.delay_minutes,
			   expires_at = excluded.expires_at`,
		)
		.bind(input.userId, input.targetChannelId, input.mode, input.delayMinutes, input.expiresAt)
		.run();
}

export async function findCaptureSession(db: D1Database, userId: number, now: number): Promise<CaptureSession | null> {
	const row = await db
		.prepare('SELECT * FROM post_capture_sessions WHERE user_id = ? AND expires_at > ?')
		.bind(userId, now)
		.first<{ target_channel_id: number; mode: string; delay_minutes: number; expires_at: number }>();
	if (!row) return null;
	return {
		targetChannelId: Number(row.target_channel_id),
		mode: row.mode === 'source' ? 'source' : row.mode === 'public' ? 'public' : row.mode === 'x' ? 'x' : 'manual',
		delayMinutes: Number(row.delay_minutes ?? 30),
		expiresAt: Number(row.expires_at),
	};
}

export async function clearCaptureSession(db: D1Database, userId: number): Promise<void> {
	await db.prepare('DELETE FROM post_capture_sessions WHERE user_id = ?').bind(userId).run();
}

/** آخرین پست منتشرشده‌ی یک کانال (برای نمایش «آخرین انتشار») */
export async function getLastPublished(db: D1Database, targetChannelId: number): Promise<QueuePost | null> {
	const row = await db
		.prepare(
			`SELECT id FROM post_queue WHERE target_channel_id = ? AND status = 'published'
			 ORDER BY published_at DESC LIMIT 1`,
		)
		.bind(targetChannelId)
		.first<{ id: number }>();
	return row ? getPost(db, Number(row.id)) : null;
}
