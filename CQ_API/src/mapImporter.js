const fs = require('fs/promises');
const path = require('path');
const { capturesDir } = require('./config');
const {
  MAP_DISTRICTS_TABLE_NAME,
  MAP_BUBBLES_TABLE_NAME,
  MAP_HOUSES_TABLE_NAME,
  MAP_HOUSE_DISTRICTS_TABLE_NAME,
} = require('./mapSchema');

const MAP_DISTRICTS_INSERT_COLUMNS = [
  'capture_date', 'district_name', 'full_spell', 'price', 'price_str',
  'price_unit', 'desc_text', 'count_unit', 'longitude', 'latitude', 'border',
];

const MAP_BUBBLES_INSERT_COLUMNS = [
  'capture_date', 'group_type', 'parent_group_type', 'parent_id', 'entity_id',
  'entity_type', 'bubble_id', 'bubble_name', 'full_spell', 'price', 'price_str',
  'price_unit', 'desc_text', 'bubble_desc', 'count_unit', 'longitude', 'latitude',
  'border',
];

const MAP_HOUSES_INSERT_COLUMNS = [
  'capture_date', 'district_name', 'resblock_id', 'resblock_name', 'house_code', 'title',
  'house_desc', 'cover_pic', 'new_cover_pic', 'price_str', 'unit_price_str',
  'action_url', 'card_type', 'item_index', 'total', 'page', 'page_size', 'has_more',
];

const MAP_HOUSE_DISTRICTS_INSERT_COLUMNS = [
  'capture_date', 'district_name', 'resblock_id', 'house_code',
];

async function insertRowsInBatches(connection, tableName, columns, rows, options = {}) {
  if (!rows.length) return;
  const batchSize = options.batchSize || 200;
  const columnSql = columns.map((column) => `\`${column}\``).join(', ');
  const duplicateSql = options.duplicateSql || '';

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    await connection.query(`INSERT ${options.ignore ? 'IGNORE ' : ''}INTO \`${tableName}\` (${columnSql}) VALUES ?${duplicateSql}`, [batch]);
  }
}

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

function resolveMapDistrictCaptureFilePath(options = {}) {
  if (options.filePath) return path.resolve(options.filePath);
  const date = options.date || defaultDateString();
  assertDateString(date);
  return path.join(capturesDir, `bk_map_districts_${date}.json`);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function buildMapDistrictRows(payload) {
  const captureDate = payload.date;
  assertDateString(captureDate);

  const response = payload.response || {};
  const data = response.data || {};
  const items = Array.isArray(data.bubbleList) ? data.bubbleList : [];

  const rows = items.map((item) => [
    captureDate,
    item.name || null,
    item.fullSpell || null,
    intOrNull(item.price),
    item.priceStr || null,
    item.priceUnit || null,
    item.desc || null,
    item.countUnit || null,
    numberOrNull(item.longitude),
    numberOrNull(item.latitude),
    item.border || null,
  ]);

  return {
    captureDate,
    itemCount: rows.length,
    visibleCount: data.visibleCount === undefined ? null : data.visibleCount,
    totalCount: data.totalCount === undefined ? null : data.totalCount,
    rows,
  };
}

function extractHouseCode(actionUrl) {
  const match = String(actionUrl || '').match(/\/ershoufang\/(\d+)\.html/);
  return match ? match[1] : null;
}

function resolvePayloadDistrictName(payload) {
  const bubbleCaptures = Array.isArray(payload.bubbleCaptures) ? payload.bubbleCaptures : [];
  const districtCapture = bubbleCaptures.find((capture) => capture && capture.groupType === 'district');
  const districtItems = districtCapture && districtCapture.response && districtCapture.response.data
    ? districtCapture.response.data.bubbleList
    : [];
  return Array.isArray(districtItems) && districtItems.length === 1 && districtItems[0]
    ? String(districtItems[0].name || '').trim()
    : '';
}

function buildMapTreeRows(payload) {
  const captureDate = payload.date;
  assertDateString(captureDate);

  const bubbleCaptures = Array.isArray(payload.bubbleCaptures) ? payload.bubbleCaptures : [];
  const houseCaptures = Array.isArray(payload.houseCaptures) ? payload.houseCaptures : [];
  const payloadDistrictName = resolvePayloadDistrictName(payload);
  const bubbleRows = [];
  const houseRows = [];
  const houseDistrictRows = [];
  const seenHouseDistrictKeys = new Set();

  for (const capture of bubbleCaptures) {
    const groupType = capture.groupType || null;
    const parent = capture.parent || {};
    const parentId = parent.id === undefined || parent.id === null ? '' : String(parent.id);
    const data = capture.response && capture.response.data ? capture.response.data : {};
    const items = Array.isArray(data.bubbleList) ? data.bubbleList : [];

    for (const item of items) {
      bubbleRows.push([
        captureDate,
        groupType,
        parent.groupType || null,
        parentId,
        item.entityId === undefined || item.entityId === null || item.entityId === '' ? null : String(item.entityId),
        item.entityType || null,
        item.id === undefined || item.id === null ? null : String(item.id),
        item.name || null,
        item.fullSpell || null,
        intOrNull(item.price),
        item.priceStr || null,
        item.priceUnit || null,
        item.desc || null,
        item.bubbleDesc || null,
        item.countUnit || null,
        numberOrNull(item.longitude),
        numberOrNull(item.latitude),
        item.border || null,
      ]);
    }
  }

  for (const capture of houseCaptures) {
    const query = capture.request && capture.request.query ? capture.request.query : {};
    const data = capture.response && capture.response.data ? capture.response.data : {};
    const list = Array.isArray(data.list) ? data.list : [];
    const resblockId = query.resblockId || capture.resblockId || null;
    const resblockName = capture.resblockName || null;

    list.forEach((item, index) => {
      const actionUrl = item.actionUrl || null;
      const houseCode = extractHouseCode(actionUrl);
      const districtName = capture.districtName || payloadDistrictName || null;
      houseRows.push([
        captureDate,
        districtName,
        resblockId ? String(resblockId) : null,
        resblockName,
        houseCode,
        item.title || null,
        item.desc || null,
        item.coverPic || null,
        item.newCoverPic || item.new_cover_pic || null,
        item.priceStr || null,
        item.unitPriceStr || null,
        actionUrl,
        item.cardType || null,
        index + 1,
        data.total === undefined ? null : intOrNull(data.total),
        data.page === undefined ? null : intOrNull(data.page),
        data.pagesize === undefined ? null : intOrNull(data.pagesize),
        data.hasMore === undefined ? null : intOrNull(data.hasMore),
      ]);

      if (districtName && resblockId && houseCode) {
        const key = `${captureDate}|${districtName}|${resblockId}|${houseCode}`;
        if (!seenHouseDistrictKeys.has(key)) {
          seenHouseDistrictKeys.add(key);
          houseDistrictRows.push([captureDate, districtName, String(resblockId), houseCode]);
        }
      }
    });
  }

  return { captureDate, bubbleRows, houseRows, houseDistrictRows };
}

async function readMapDistrictPayload(options = {}) {
  if (options.payload) {
    return {
      filePath: null,
      fileName: options.sourceFileName || `bk_map_districts_${options.payload.date || defaultDateString()}.json`,
      payload: options.payload,
    };
  }

  const filePath = resolveMapDistrictCaptureFilePath(options);
  const content = await fs.readFile(filePath, 'utf8');
  return { filePath, fileName: path.basename(filePath), payload: JSON.parse(content.replace(/^\uFEFF/, '')) };
}

async function importMapDistrictCapture(pool, options = {}) {
  const replaceExisting = options.replaceExisting !== false;
  const { filePath, fileName, payload } = await readMapDistrictPayload(options);
  const { captureDate, itemCount, visibleCount, totalCount, rows } = buildMapDistrictRows(payload);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    let deletedRows = 0;

    if (replaceExisting) {
      const [deleteResult] = await connection.query(`DELETE FROM \`${MAP_DISTRICTS_TABLE_NAME}\``);
      deletedRows = deleteResult.affectedRows || 0;
    }

    if (rows.length > 0) {
      const columnSql = MAP_DISTRICTS_INSERT_COLUMNS.map((column) => `\`${column}\``).join(', ');
      await connection.query(`INSERT INTO \`${MAP_DISTRICTS_TABLE_NAME}\` (${columnSql}) VALUES ?`, [rows]);
    }

    await connection.commit();
    return { filePath, fileName, captureDate, itemCount, visibleCount, totalCount, insertedRows: rows.length, deletedRows, replaceExisting };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function importMapTreeCapture(pool, options = {}) {
  const replaceExisting = options.replaceExisting !== false;
  const payload = options.payload || JSON.parse((await fs.readFile(path.resolve(options.filePath), 'utf8')).replace(/^\uFEFF/, ''));
  const { captureDate, bubbleRows, houseRows, houseDistrictRows } = buildMapTreeRows(payload);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    let deletedBubbleRows = 0;
    let deletedHouseRows = 0;
    let deletedHouseDistrictRows = 0;

    if (replaceExisting) {
      const [houseDistrictDeleteResult] = await connection.query(`DELETE FROM \`${MAP_HOUSE_DISTRICTS_TABLE_NAME}\``);
      const [houseDeleteResult] = await connection.query(`DELETE FROM \`${MAP_HOUSES_TABLE_NAME}\``);
      const [bubbleDeleteResult] = await connection.query(`DELETE FROM \`${MAP_BUBBLES_TABLE_NAME}\``);
      deletedHouseDistrictRows = houseDistrictDeleteResult.affectedRows || 0;
      deletedHouseRows = houseDeleteResult.affectedRows || 0;
      deletedBubbleRows = bubbleDeleteResult.affectedRows || 0;
    }

    if (bubbleRows.length > 0) {
      const updateSql = MAP_BUBBLES_INSERT_COLUMNS
        .filter((column) => column !== 'capture_date' && column !== 'group_type' && column !== 'parent_id' && column !== 'bubble_id')
        .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
        .join(', ');
      await insertRowsInBatches(connection, MAP_BUBBLES_TABLE_NAME, MAP_BUBBLES_INSERT_COLUMNS, bubbleRows, {
        batchSize: 300,
        duplicateSql: ` ON DUPLICATE KEY UPDATE ${updateSql}`,
      });
    }

    if (houseRows.length > 0) {
      await insertRowsInBatches(connection, MAP_HOUSES_TABLE_NAME, MAP_HOUSES_INSERT_COLUMNS, houseRows, {
        batchSize: 300,
        ignore: true,
      });
    }

    if (houseDistrictRows.length > 0) {
      await insertRowsInBatches(connection, MAP_HOUSE_DISTRICTS_TABLE_NAME, MAP_HOUSE_DISTRICTS_INSERT_COLUMNS, houseDistrictRows, {
        batchSize: 300,
        ignore: true,
      });
    }

    await connection.commit();
    return {
      captureDate,
      bubbleRows: bubbleRows.length,
      houseRows: houseRows.length,
      houseDistrictRows: houseDistrictRows.length,
      deletedBubbleRows,
      deletedHouseRows,
      deletedHouseDistrictRows,
      replaceExisting,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  importMapDistrictCapture,
  importMapTreeCapture,
  resolveMapDistrictCaptureFilePath,
};
