/**
 * ثبت یه کانال، یا اگه قبلاً توسط یکی دیگه ثبت شده، اضافه کردن کاربر جاری به
 * لیست ادمین‌های همون کانال (بدون تکرار عنوان/کانال).
 *
 * اگه هیچ‌چیزی واقعاً تغییر نکنه (کاربر از قبل توی لیست ادمین‌ها بوده و عنوان/
 * username هم فرقی نکرده)، هیچ نوشتنی روی دیتابیس انجام نمی‌شه.
 *
 * @param {D1Database} db
 * @param {number} userId - آیدی تلگرام کاربری که الان داره فوروارد می‌کنه
 * @param {{id: number, title: string, username: string|null}} channel
 * @param {{isOwner?: boolean}} options - آیا همین کاربر creator کانال هست؟
 * @returns {Promise<{isNewChannel: boolean, ownerAssigned: boolean}>}
 */
export async function registerChannel(db, userId, channel, { isOwner = false } = {}) {
  const existing = await db
    .prepare("SELECT * FROM channels WHERE channel_id = ?")
    .bind(channel.id)
    .first();

  if (!existing) {
    await db
      .prepare(`
        INSERT INTO channels (channel_id, title, username, registered_by, owner_id)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(channel.id, channel.title, channel.username ?? null, userId, isOwner ? userId : null)
      .run();

    await db
      .prepare("INSERT OR IGNORE INTO channel_admins (channel_id, user_id) VALUES (?, ?)")
      .bind(channel.id, userId)
      .run();

    return { isNewChannel: true, ownerAssigned: isOwner };
  }

  const needsInfoUpdate = existing.title !== channel.title || existing.username !== (channel.username ?? null);
  const needsOwnerUpdate = isOwner && existing.owner_id == null;

  // فقط وقتی واقعاً چیزی فرق کرده UPDATE بزن؛ در غیر این صورت هیچ نوشتنی
  // انجام نشه (نه توی خود جدول channels، نه یه پیغام غیرلازم).
  if (needsInfoUpdate || needsOwnerUpdate) {
    await db
      .prepare(`
        UPDATE channels
        SET title = ?,
            username = ?,
            owner_id = COALESCE(owner_id, ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE channel_id = ?
      `)
      .bind(channel.title, channel.username ?? null, isOwner ? userId : null, channel.id)
      .run();
  }

  // INSERT OR IGNORE خودش، در سطح دیتابیس، تضمین می‌کنه اگه این کاربر از قبل
  // توی لیست ادمین‌های این کانال باشه، هیچ نوشتنی روی دیسک انجام نشه.
  await db
    .prepare("INSERT OR IGNORE INTO channel_admins (channel_id, user_id) VALUES (?, ?)")
    .bind(channel.id, userId)
    .run();

  return { isNewChannel: false, ownerAssigned: needsOwnerUpdate };
}

/** همه‌ی کانال‌هایی که کاربر بهشون به‌عنوان ادمین دسترسی داره (چه ثبت‌کننده باشه، چه بعداً اضافه شده باشه). */
export async function getChannels(db, userId) {
  const result = await db
    .prepare(`
      SELECT c.*
      FROM channels c
      JOIN channel_admins ca ON ca.channel_id = c.channel_id
      WHERE ca.user_id = ?
      ORDER BY c.id DESC
    `)
    .bind(userId)
    .all();

  return result.results;
}

/** برداشتن دسترسی یه کاربر به یه کانال (خود کانال و بقیه‌ی ادمین‌هاش دست‌نخورده می‌مونن). */
export async function removeChannelAdmin(db, channelId, userId) {
  return db
    .prepare("DELETE FROM channel_admins WHERE channel_id = ? AND user_id = ?")
    .bind(channelId, userId)
    .run();
}
