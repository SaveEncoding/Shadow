export async function addUser(
    db,
    user
) {

    return db.prepare(`
        INSERT OR IGNORE INTO users
        (
            user_id,
            first_name,
            username
        )
        VALUES (?, ?, ?)
    `)
    .bind(
        user.id,
        user.first_name,
        user.username
    )
    .run();

}