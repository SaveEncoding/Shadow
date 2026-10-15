// Domain service for async media jobs (video + subtitle muxing).
// Storage: D1 (media_jobs table) + R2 (objects). Heavy muxing happens out-of-band.

/**
 * @param {object} db - D1 database
 * @param {{ userId: number, videoKey: string, subtitleKey: string }} input
 * @returns {Promise<number>} new job id
 */
export async function createMediaJob(db, { userId, videoKey, subtitleKey }) {
  if (!db) throw new Error("D1 database is not available");
  const result = await db
    .prepare(
      "INSERT INTO media_jobs (user_id, video_key, subtitle_key, status) VALUES (?, ?, ?, 'queued')"
    )
    .bind(userId, videoKey, subtitleKey)
    .run();
  return result.meta?.last_row_id ?? null;
}

export async function getMediaJob(db, id) {
  if (!db) return null;
  const row = await db
    .prepare("SELECT * FROM media_jobs WHERE id = ?")
    .bind(id)
    .first();
  return row || null;
}

export async function listMediaJobs(db, userId, limit = 10) {
  if (!db) return [];
  const { results } = await db
    .prepare(
      "SELECT * FROM media_jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?"
    )
    .bind(userId, limit)
    .all();
  return results || [];
}

export async function updateMediaJob(db, id, patch = {}) {
  if (!db) return;
  const fields = [];
  const values = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.resultKey !== undefined) {
    fields.push("result_key = ?");
    values.push(patch.resultKey);
  }
  if (patch.error !== undefined) {
    fields.push("error = ?");
    values.push(patch.error);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);
  await db
    .prepare(`UPDATE media_jobs SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function getQueuedMediaJobs(db, limit = 5) {
  if (!db) return [];
  const { results } = await db
    .prepare(
      "SELECT * FROM media_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT ?"
    )
    .bind(limit)
    .all();
  return results || [];
}