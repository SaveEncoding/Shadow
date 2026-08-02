export async function addChannel(db, userId, channel) {
  return db
    .prepare(`
      INSERT INTO channels (user_id, channel_id, title, username)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET
        title = excluded.title,
        username = excluded.username,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(userId, channel.id, channel.title, channel.username ?? null)
    .run();
}

export async function getChannels(db, userId) {
  const result = await db
    .prepare(`
      SELECT *
      FROM channels
      WHERE user_id = ?
      ORDER BY id DESC
    `)
    .bind(userId)
    .all();

  return result.results;
}

export async function deleteChannel(db, userId, channelId) {
  return db
    .prepare(`
      DELETE FROM channels
      WHERE user_id = ?
        AND channel_id = ?
    `)
    .bind(userId, channelId)
    .run();
}
