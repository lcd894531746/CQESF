const fs = require('fs/promises');
const path = require('path');
const { capturesDir } = require('./config');
const { DETAILS_TABLE_NAME } = require('./ershouSchema');

const DETAILS_INSERT_COLUMNS = [
  'capture_date', 'house_code', 'route', 'title', 'price', 'unit_price',
  'area', 'bed_room_num', 'hall_num', 'orientation', 'floor_state',
  'property_type', 'build_year', 'house_use', 'building_type',
  'orientation_text', 'has_elevator_text',
  'community_name', 'community_id', 'city_id', 'm_url', 'details_imgs', 'dynamic_json',
  'resources_json', 'community_info_json', 'market_trend_json',
  'same_community_for_sale_json', 'same_community_trades_json', 'commute_json',
  'surroundings_json', 'community_comment_json', 'triggers_json',
  'route_info_json', 'http_count',
];

function assertDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
}

function defaultDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveDetailCaptureFilePath(options = {}) {
  if (options.filePath) return path.resolve(options.filePath);
  const date = options.date || defaultDateString();
  assertDateString(date);
  return path.join(capturesDir, `ershou_details_${date}.json`);
}

function normalizeBoolean(value) {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

function jsonText(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function buildDetailRows(payload) {
  const captureDate = payload.date;
  assertDateString(captureDate);

  const items = Array.isArray(payload.items) ? payload.items : [];
  const rows = [];

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const overview = item.overview && typeof item.overview === 'object' ? item.overview : {};
    const houseOverview = item.houseOverview && typeof item.houseOverview === 'object' ? item.houseOverview : {};

    rows.push([
      captureDate, item.houseCode || null, item.route || null, overview.title || null,
      overview.price || null, overview.unitPrice || null,
      overview.area === undefined ? null : overview.area,
      overview.bedRoomNum === undefined ? null : overview.bedRoomNum,
      overview.hallNum === undefined ? null : overview.hallNum,
      overview.orientation || null, overview.floorState || null,
      houseOverview.propertyType || null, houseOverview.buildYear || null,
      houseOverview.houseUse || null, houseOverview.buildingType || null,
      houseOverview.orientationText || null, houseOverview.hasElevatorText || null,
      overview.communityName || null, overview.communityId || null,
      overview.cityId || null, overview.mUrl || null,
      jsonText(item.detailsImgs || item.details_imgs),
      jsonText(item.dynamic), jsonText(item.resources), jsonText(item.communityInfo),
      jsonText(item.marketTrend), jsonText(item.sameCommunityForSale),
      jsonText(item.sameCommunityTrades), jsonText(item.commute), jsonText(item.surroundings),
      jsonText(item.communityComment), jsonText(item.triggers), jsonText(item.routeInfo),
      item.httpCount === undefined ? null : item.httpCount,
    ]);
  });

  return { captureDate, itemCount: rows.length, rows };
}

async function readDetailPayload(options = {}) {
  if (options.payload) {
    return {
      filePath: null,
      fileName: options.sourceFileName || `request_detail_payload_${options.payload.date || defaultDateString()}.json`,
      payload: options.payload,
    };
  }

  const filePath = resolveDetailCaptureFilePath(options);
  const content = await fs.readFile(filePath, 'utf8');
  return { filePath, fileName: path.basename(filePath), payload: JSON.parse(content.replace(/^\uFEFF/, '')) };
}

async function importDailyDetailCapture(pool, options = {}) {
  const replaceExisting = options.replaceExisting !== false;
  const { filePath, fileName, payload } = await readDetailPayload(options);
  const { captureDate, itemCount, rows } = buildDetailRows(payload);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    let deletedRows = 0;

    if (replaceExisting) {
      const [deleteResult] = await connection.query(`DELETE FROM \`${DETAILS_TABLE_NAME}\``);
      deletedRows = deleteResult.affectedRows || 0;
    }

    if (rows.length > 0) {
      const columnSql = DETAILS_INSERT_COLUMNS.map((column) => `\`${column}\``).join(', ');
      const batchSize = 100;
      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        await connection.query(`INSERT INTO \`${DETAILS_TABLE_NAME}\` (${columnSql}) VALUES ?`, [batch]);
      }
    }

    await connection.commit();
    return { filePath, fileName, captureDate, itemCount, insertedRows: rows.length, deletedRows, replaceExisting };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function importOneDetailCapture(pool, options = {}) {
  const item = options.item;
  if (!item || typeof item !== 'object') {
    throw new Error('detail item is required');
  }

  const captureDate = String(options.captureDate || item.date || '').trim();
  assertDateString(captureDate);

  const { rows } = buildDetailRows({
    date: captureDate,
    items: [item],
  });

  if (rows.length !== 1) {
    throw new Error('failed to build single detail row');
  }

  const houseCode = rows[0][1];
  if (!houseCode) {
    throw new Error('houseCode is required');
  }

  const columnSql = DETAILS_INSERT_COLUMNS.map((column) => `\`${column}\``).join(', ');
  const placeholderSql = DETAILS_INSERT_COLUMNS.map(() => '?').join(', ');
  const updateSql = DETAILS_INSERT_COLUMNS
    .filter((column) => column !== 'capture_date' && column !== 'house_code')
    .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
    .join(', ');

  const [result] = await pool.query(
    `INSERT INTO \`${DETAILS_TABLE_NAME}\` (${columnSql})
     VALUES (${placeholderSql})
     ON DUPLICATE KEY UPDATE ${updateSql}`,
    rows[0]
  );

  return {
    captureDate,
    houseCode,
    affectedRows: result.affectedRows || 0,
    changedRows: result.changedRows || 0,
  };
}

module.exports = {
  importDailyDetailCapture,
  importOneDetailCapture,
  resolveDetailCaptureFilePath,
};
