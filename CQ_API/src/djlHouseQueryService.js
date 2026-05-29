const { parseJsonArray, toPublicImageUrl, normalizeImageArray } = require('./utils');
const { convertPointFromBd09 } = require('./coordinateUtils');

const DJL_DETAIL_TABLE_NAME = 'djl_esf_house_detail';
const APPROVAL_TASKS_TABLE_NAME = 'approval_tasks';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function buildOrderByClause(filters = {}) {
  return 'ORDER BY h.created_at DESC, h.id DESC';
}

async function appendApprovalStates(pool, rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const targetIds = rows
    .map((row) => String(row.id || '').trim())
    .filter(Boolean);

  if (targetIds.length === 0) return rows;

  const placeholders = targetIds.map(() => '?').join(', ');

  const [imageRows] = await pool.query(
    `
      SELECT latest.target_id, latest.status, latest.payload, latest.created_at
      FROM \`${APPROVAL_TASKS_TABLE_NAME}\` AS latest
      INNER JOIN (
        SELECT MAX(id) AS id
        FROM \`${APPROVAL_TASKS_TABLE_NAME}\`
        WHERE action_type IN ('bk_house_update_image', 'bk_house_update_images')
          AND target_type = 'bk_house'
          AND target_id IN (${placeholders})
        GROUP BY target_id
      ) AS picked
        ON picked.id = latest.id
    `,
    targetIds
  );

  const [deleteRows] = await pool.query(
    `
      SELECT latest.target_id, latest.status
      FROM \`${APPROVAL_TASKS_TABLE_NAME}\` AS latest
      INNER JOIN (
        SELECT MAX(id) AS id
        FROM \`${APPROVAL_TASKS_TABLE_NAME}\`
        WHERE action_type = 'bk_house_delete'
          AND target_type = 'bk_house'
          AND target_id IN (${placeholders})
        GROUP BY target_id
      ) AS picked
        ON picked.id = latest.id
    `,
    targetIds
  );

  const imageMap = new Map(
    imageRows.map((row) => [String(row.target_id || '').trim(), row])
  );
  const deleteMap = new Map(
    deleteRows.map((row) => [String(row.target_id || '').trim(), row])
  );

  return rows.map((row) => {
    const targetId = String(row.id || '').trim();
    const imageState = imageMap.get(targetId);
    const deleteState = deleteMap.get(targetId);
    return Object.assign({}, row, {
      image_review_status: imageState ? imageState.status : null,
      image_review_payload: imageState ? imageState.payload : null,
      image_review_created_at: imageState ? imageState.created_at : null,
      delete_review_status: deleteState ? deleteState.status : null,
    });
  });
}

function buildWhereClause(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.title) {
    conditions.push('(h.title LIKE ? OR h.community_name LIKE ?)');
    values.push(`%${filters.title}%`, `%${filters.title}%`);
  }

  if (filters.districtName) {
    conditions.push('h.area_name = ?');
    values.push(filters.districtName);
  }

  if (filters.areaCode) {
    conditions.push('h.area_code = ?');
    values.push(filters.areaCode);
  }

  if (filters.subAreaName) {
    conditions.push('h.sub_area_name = ?');
    values.push(filters.subAreaName);
  }

  if (filters.communityId) {
    conditions.push('h.community_id = ?');
    values.push(filters.communityId);
  }

  if (filters.minPrice !== null) {
    conditions.push('h.total_price_wan >= ?');
    values.push(filters.minPrice);
  }

  if (filters.maxPrice !== null) {
    conditions.push('h.total_price_wan <= ?');
    values.push(filters.maxPrice);
  }

  if (filters.minArea !== null) {
    conditions.push('h.build_area_sqm >= ?');
    values.push(filters.minArea);
  }

  if (filters.maxArea !== null) {
    conditions.push('h.build_area_sqm <= ?');
    values.push(filters.maxArea);
  }

  if (filters.todayOnly) {
    conditions.push('DATE(h.created_at) = CURRENT_DATE()');
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

function buildStoredImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalizedUploadUrl = raw.replace(/^https?:\/\/shanlan\.xyz\/uploads\//i, '/uploads/');
  return toPublicImageUrl(normalizedUploadUrl);
}

function toIsoString(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function parsePendingImageReview(row) {
  if (String(row.image_review_status || '').trim() !== 'pending') {
    return null;
  }

  let payload = row.image_review_payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload || '{}');
    } catch {
      payload = {};
    }
  }
  if (!payload || typeof payload !== 'object') {
    payload = {};
  }

  const pendingPoster = buildStoredImageUrl(
    payload.posterImageUrl || payload.posterFileName || ''
  );
  const pendingPosterRemoved = Boolean(payload.posterRemoved);

  const pendingGallerySources = Array.isArray(payload.galleryImageUrls)
    ? payload.galleryImageUrls
    : (Array.isArray(payload.galleryFileNames) ? payload.galleryFileNames : []);

  const pendingGallery = pendingGallerySources
    .map((item) => buildStoredImageUrl(item))
    .filter(Boolean);

  return {
    status: 'pending',
    createdAt: toIsoString(row.image_review_created_at),
    posterImage: pendingPoster,
    posterRemoved: pendingPosterRemoved,
    galleryImages: pendingGallery,
  };
}

function normalizeHouseRow(row) {
  const point = convertPointFromBd09(row.longitude_bd09, row.latitude_bd09);
  const manualPoster = String(row.manual_cover_image_url || '').trim();
  const manualPosterRemoved = Number(row.manual_cover_removed || 0) === 1;
  const originalPoster = String(row.cover_image_url || '').trim();
  const manualGallery = parseJsonArray(row.manual_gallery_images_json);
  const originalGallery = parseJsonArray(row.image_urls_json);
  const pendingImageReview = parsePendingImageReview(row);
  const effectivePoster = manualPoster
    ? manualPoster
    : (manualPosterRemoved ? '' : originalPoster);

  let approvalType = '';
  let approvalStatus = '';
  if (String(row.delete_review_status || '').trim() === 'pending') {
    approvalType = '删除审核';
    approvalStatus = '审核中';
  } else if (String(row.delete_review_status || '').trim() === 'rejected') {
    approvalType = '删除审核';
    approvalStatus = '已驳回';
  } else if (String(row.image_review_status || '').trim() === 'pending') {
    approvalType = '图片审核';
    approvalStatus = '审核中';
  } else if (String(row.image_review_status || '').trim() === 'rejected') {
    approvalType = '图片审核';
    approvalStatus = '已驳回';
  } else if (String(row.image_review_status || '').trim() === 'approved') {
    approvalType = '图片审核';
    approvalStatus = '审核完成';
  }

  return {
    id: row.id,
    listingId: row.listing_id,
    houseCode: row.listing_id,
    createdAt: toIsoString(row.created_at),
    title: row.title,
    listingDesc: row.house_type || '',
    buildAreaSqm: row.build_area_sqm === null || row.build_area_sqm === undefined ? null : Number(row.build_area_sqm),
    communityId: row.community_id,
    communityName: row.community_name,
    districtName: row.area_name,
    subAreaName: row.sub_area_name,
    totalPriceText: row.total_price_wan === null || row.total_price_wan === undefined ? '' : String(row.total_price_wan),
    totalPriceUnit: '万',
    unitPriceText: row.unit_price_text || '',
    originalCoverPic: toPublicImageUrl(originalPoster),
    coverPic: toPublicImageUrl(effectivePoster),
    posterImage: toPublicImageUrl(effectivePoster),
    galleryImages: normalizeImageArray(manualGallery.length > 0 ? manualGallery : originalGallery),
    longitude: point.longitude,
    latitude: point.latitude,
    approvalType,
    approvalStatus,
    pendingImageReview,
    actionUrl: row.listing_url || '',
  };
}

async function queryDjlHouseList(pool, options = {}) {
  const page = toPositiveInt(options.page, 1);
  const pageSize = Math.min(toPositiveInt(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const includeTotal = toBoolean(options.includeTotal, true);
  const includeApproval = toBoolean(options.includeApproval, false);
  const title = options.title ? String(options.title).trim() : '';
  const districtName = options.districtName ? String(options.districtName).trim() : '';
  const areaCode = options.areaCode ? String(options.areaCode).trim() : '';
  const subAreaName = options.subAreaName ? String(options.subAreaName).trim() : '';
  const communityId = options.communityId ? String(options.communityId).trim() : '';
  const minPrice = toNullableNumber(options.minPrice);
  const maxPrice = toNullableNumber(options.maxPrice);
  const minArea = toNullableNumber(options.minArea);
  const maxArea = toNullableNumber(options.maxArea);
  const todayOnly = toBoolean(options.todayOnly, false);

  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new Error('minPrice cannot be greater than maxPrice');
  }

  if (minArea !== null && maxArea !== null && minArea > maxArea) {
    throw new Error('minArea cannot be greater than maxArea');
  }

  const filters = { title, districtName, areaCode, subAreaName, communityId, minPrice, maxPrice, minArea, maxArea, todayOnly };
  const { whereSql, values } = buildWhereClause(filters);
  const orderBySql = buildOrderByClause(filters);
  const offset = (page - 1) * pageSize;
  let total = 0;
  if (includeTotal) {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM \`${DJL_DETAIL_TABLE_NAME}\` AS h ${whereSql}`,
      values
    );
    total = countRows[0] ? Number(countRows[0].total) : 0;
  }

  const [baseRows] = await pool.query(
    `
      SELECT
        h.id,
        h.listing_id,
        h.created_at,
        h.title,
        h.listing_url,
        h.area_name,
        h.sub_area_name,
        h.community_id,
        h.community_name,
        h.longitude_bd09,
        h.latitude_bd09,
        h.total_price_wan,
        h.unit_price_text,
        h.house_type,
        h.build_area_sqm,
        h.cover_image_url,
        h.manual_cover_image_url,
        h.manual_cover_removed,
        h.image_urls_json,
        h.manual_gallery_images_json
      FROM \`${DJL_DETAIL_TABLE_NAME}\` AS h
      ${whereSql}
      ${orderBySql}
      LIMIT ? OFFSET ?
    `,
    [...values, pageSize, offset]
  );

  const rows = includeApproval
    ? await appendApprovalStates(pool, baseRows)
    : baseRows;

  return {
    page,
    pageSize,
    total,
    totalPages: includeTotal && total > 0 ? Math.ceil(total / pageSize) : 0,
    includeTotal,
    filters,
    items: rows.map(normalizeHouseRow),
  };
}

async function queryDjlDistrictOptions(pool) {
  const [rows] = await pool.query(
    `
      SELECT area_name
      FROM \`${DJL_DETAIL_TABLE_NAME}\`
      WHERE area_name IS NOT NULL
        AND TRIM(area_name) <> ''
      GROUP BY area_name
      ORDER BY MIN(id) ASC
    `
  );

  return rows
    .map((row) => String(row.area_name || '').trim())
    .filter(Boolean);
}

module.exports = {
  queryDjlHouseList,
  queryDjlDistrictOptions,
};
