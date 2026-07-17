export async function addChannel(
    db,
    userId,
    channel
) {

    return db.prepare(`
        INSERT OR IGNORE INTO channels
        (
            user_id,
            channel_id,
            title,
            username
        )
        VALUES (?, ?, ?, ?)
    `)
    .bind(
        userId,
        channel.id,
        channel.title,
        channel.username
    )
    .run();

}

export async function getChannels(
    db,
    userId
) {

    const result = await db.prepare(`
        SELECT *
        FROM channels
        WHERE user_id = ?
        ORDER BY id DESC
    `)
    .bind(userId)
    .all();

    return result.results;

}

export async function deleteChannel(
    db,
    userId,
    channelId
) {

    return db.prepare(`
        DELETE FROM channels
        WHERE user_id = ?
        AND channel_id = ?
    `)
    .bind(
        userId,
        channelId
    )
    .run();

}