const { DJL_SYNC_TASK_TABLE_NAME } = require('./djlSyncSchema');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseSummary(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeTaskRow(row) {
  return {
    id: Number(row.id || 0),
    taskType: String(row.task_type || '').trim(),
    status: String(row.status || '').trim(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : '',
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : '',
    triggerByStaffId: row.trigger_by_staff_id === null || row.trigger_by_staff_id === undefined
      ? null
      : Number(row.trigger_by_staff_id),
    triggerByName: String(row.trigger_by_name || '').trim(),
    summary: parseSummary(row.summary),
    errorMessage: String(row.error_message || '').trim(),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
}

async function listDjlSyncTasks(pool, options = {}) {
  const page = toPositiveInt(options.page, 1);
  const pageSize = Math.min(toPositiveInt(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const status = String(options.status || '').trim();
  const where = [];
  const values = [];

  if (status) {
    where.push('status = ?');
    values.push(status);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM \`${DJL_SYNC_TASK_TABLE_NAME}\` ${whereSql}`,
    values
  );
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `
      SELECT
        id,
        task_type,
        status,
        started_at,
        finished_at,
        trigger_by_staff_id,
        trigger_by_name,
        summary,
        error_message,
        created_at,
        updated_at
      FROM \`${DJL_SYNC_TASK_TABLE_NAME}\`
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
    [...values, pageSize, offset]
  );

  return {
    page,
    pageSize,
    total,
    totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
    items: rows.map(normalizeTaskRow),
  };
}

async function getLatestRunningDjlSyncTask(pool) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        task_type,
        status,
        started_at,
        finished_at,
        trigger_by_staff_id,
        trigger_by_name,
        summary,
        error_message,
        created_at,
        updated_at
      FROM \`${DJL_SYNC_TASK_TABLE_NAME}\`
      WHERE status IN ('pending', 'running')
      ORDER BY id DESC
      LIMIT 1
    `
  );

  return rows[0] ? normalizeTaskRow(rows[0]) : null;
}

module.exports = {
  listDjlSyncTasks,
  getLatestRunningDjlSyncTask,
};
