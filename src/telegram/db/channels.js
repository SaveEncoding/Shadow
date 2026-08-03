/**
 * Registering a channel, or—if it has already been registered by someone else—adding the current user to
 * the list of admins for that channel (without duplicating the title/channel).
 *
 * If nothing actually changes (i.e., the user is already in the admin list and the title/
 * username remains the same), no write operation is performed on the database.
 *
 * @param {D1Database} db
 * @param {number} userId - The Telegram ID of the user who is currently forwarding.
 * @param {{id: number, title: string, username: string|null}} channel
 * @param {{isOwner?: boolean}} options - Is this user the creator of the channel?
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

  // Only perform an UPDATE if something has actually changed; otherwise, do not write anything
  // (neither to the `channels` table itself nor an unnecessary message).
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

  // INSERT OR IGNORE guarantees at the database level that if this user is already
  // in this channel's list of admins, no write operation to the disk will occur.
  await db
    .prepare("INSERT OR IGNORE INTO channel_admins (channel_id, user_id) VALUES (?, ?)")
    .bind(channel.id, userId)
    .run();

  return { isNewChannel: false, ownerAssigned: needsOwnerUpdate };
}

/**
  *  All channels to which the user has admin access (whether they were the one who registered them or were added later).
  */
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

/** Revoking a user's access to a channel (the channel itself and its other admins remain unaffected). */
export async function removeChannelAdmin(db, channelId, userId) {
  return db
    .prepare("DELETE FROM channel_admins WHERE channel_id = ? AND user_id = ?")
    .bind(channelId, userId)
    .run();
}

/**
 * It returns a limited batch of channels, ordered by the oldest sync (with channels that have never been synced coming first).
 * It is designed to ensure that each cron execution takes a limited, predictable amount of time, even with an arbitrarily large number of channels;
 * full coverage is achieved across multiple executions in a round-robin fashion.
 */
export async function getChannelsNeedingAdminSync(db, limit = 200) {
  const result = await db
    .prepare(`
      SELECT *
      FROM channels
      ORDER BY admins_synced_at IS NOT NULL, admins_synced_at ASC
      LIMIT ?
    `)
    .bind(limit)
    .all();

  return result.results;
}

/**
 * It synchronizes the list of registered channel admins with the latest actual list retrieved from Telegram
 * (via the `getChatAdministrators` output): new admins are added, and
 * admins who have been removed are deleted. Only users who have previously started the bot
 * (and exist in the `users` table) can be linked; otherwise, database constraints prevent it.
 * If nothing has actually changed, no `INSERT` or `DELETE` operations are executed.
 *
 * @returns {Promise<{added: number, removed: number}>}
 */
export async function syncChannelAdmins(db, channelId, currentAdminUserIds) {
  if (currentAdminUserIds.length === 0) {
    await db
      .prepare("UPDATE channels SET admins_synced_at = CURRENT_TIMESTAMP WHERE channel_id = ?")
      .bind(channelId)
      .run();
    return { added: 0, removed: 0 };
  }

  const placeholders = currentAdminUserIds.map(() => "?").join(", ");
  const { results: knownUserRows } = await db
    .prepare(`SELECT id FROM users WHERE id IN (${placeholders})`)
    .bind(...currentAdminUserIds)
    .all();
  const knownAdminIds = new Set(knownUserRows.map((row) => row.id));

  const { results: existingRows } = await db
    .prepare("SELECT user_id FROM channel_admins WHERE channel_id = ?")
    .bind(channelId)
    .all();
  const existingIds = new Set(existingRows.map((row) => row.user_id));
  const currentIdSet = new Set(currentAdminUserIds);

  const toAdd = [...knownAdminIds].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !currentIdSet.has(id));

  const statements = [
    db.prepare("UPDATE channels SET admins_synced_at = CURRENT_TIMESTAMP WHERE channel_id = ?").bind(channelId),
  ];
  for (const userId of toAdd) {
    statements.push(
      db.prepare("INSERT OR IGNORE INTO channel_admins (channel_id, user_id) VALUES (?, ?)").bind(channelId, userId)
    );
  }
  for (const userId of toRemove) {
    statements.push(
      db.prepare("DELETE FROM channel_admins WHERE channel_id = ? AND user_id = ?").bind(channelId, userId)
    );
  }

  await db.batch(statements);

  return { added: toAdd.length, removed: toRemove.length };
}
