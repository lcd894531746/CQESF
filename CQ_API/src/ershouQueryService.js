const { LISTINGS_TABLE_NAME } = require('./ershouSchema');
const { parseJsonArray } = require('./utils');

const PAGE_SIZE = 20;
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

function toNullableDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid date: ${value}`);
  return text;
}

function buildWhereClause(filters) {
  const conditions = [];
  const values = [];

  if (filters.title) {
    conditions.push('title LIKE ?');
    values.push(`%${filters.title}%`);
  }

  if (filters.minPrice !== null) {
    conditions.push('CAST(total_price_text AS DECIMAL(12,2)) >= ?');
    values.push(filters.minPrice);
  }

  if (filters.maxPrice !== null) {
    conditions.push('CAST(total_price_text AS DECIMAL(12,2)) <= ?');
    values.push(filters.maxPrice);
  }

  if (filters.date) {
    conditions.push('capture_date = ?');
    values.push(filters.date);
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

async function queryListings(pool, options = {}) {
  const page = toPositiveInt(options.page, 1);
  const pageSize = Math.min(toPositiveInt(options.pageSize, PAGE_SIZE), MAX_PAGE_SIZE);
  const title = options.title ? String(options.title).trim() : '';
  const minPrice = toNullableNumber(options.minPrice);
  const maxPrice = toNullableNumber(options.maxPrice);
  const date = toNullableDate(options.date);

  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new Error('minPrice cannot be greater than maxPrice');
  }

  const filters = { title, minPrice, maxPrice, date };
  const { whereSql, values } = buildWhereClause(filters);
  const offset = (page - 1) * pageSize;

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM \`${LISTINGS_TABLE_NAME}\` ${whereSql}`, values);
  const total = countRows[0] ? Number(countRows[0].total) : 0;

  const [rows] = await pool.query(
    `
      SELECT
        id,
        DATE_FORMAT(capture_date, '%Y-%m-%d') AS captureDate,
        source_file AS sourceFile,
        global_index AS globalIndex,
        page_sequence AS pageSequence,
        request_page AS requestPage,
        item_index_in_page AS itemIndexInPage,
        house_code AS houseCode,
        title,
        listing_desc AS listingDesc,
        community_id AS communityId,
        community_name AS communityName,
        card_type AS cardType,
        total_price_text AS totalPriceText,
        total_price_unit AS totalPriceUnit,
        unit_price_text AS unitPriceText,
        poster_image AS posterImage,
        gallery_images AS galleryImages,
        frame_picture AS framePicture,
        action_url_json.extractedActionUrl AS actionUrl,
        is_vr AS isVr,
        is_vr_future_home AS isVrFutureHome,
        is_inspected AS isInspected,
        is_top AS isTop,
        house_status AS houseStatus,
        dig_type AS digType,
        fb_query_id AS fbQueryId,
        feed_query_id AS feedQueryId,
        request_url AS requestUrl
      FROM (
        SELECT
          *,
          JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.actionUrl')) AS extractedActionUrl
        FROM \`${LISTINGS_TABLE_NAME}\`
        ${whereSql}
      ) AS action_url_json
      ORDER BY global_index ASC
      LIMIT ? OFFSET ?
    `,
    [...values, pageSize, offset]
  );

  return {
    page,
    pageSize,
    total,
    totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
    filters,
    items: rows.map((row) => ({
      id: row.id,
      captureDate: row.captureDate,
      sourceFile: row.sourceFile,
      globalIndex: row.globalIndex,
      pageSequence: row.pageSequence,
      requestPage: row.requestPage,
      itemIndexInPage: row.itemIndexInPage,
      houseCode: row.houseCode,
      title: row.title,
      listingDesc: row.listingDesc,
      communityId: row.communityId,
      communityName: row.communityName,
      cardType: row.cardType,
      totalPriceText: row.totalPriceText,
      totalPriceUnit: row.totalPriceUnit,
      unitPriceText: row.unitPriceText,
      posterImage: row.posterImage,
      galleryImages: parseJsonArray(row.galleryImages),
      framePicture: row.framePicture,
      actionUrl: row.actionUrl,
      isVr: Boolean(row.isVr),
      isVrFutureHome: Boolean(row.isVrFutureHome),
      isInspected: Boolean(row.isInspected),
      isTop: row.isTop,
      houseStatus: row.houseStatus,
      digType: row.digType,
      fbQueryId: row.fbQueryId,
      feedQueryId: row.feedQueryId,
      requestUrl: row.requestUrl,
    })),
  };
}

module.exports = {
  queryListings,
};
