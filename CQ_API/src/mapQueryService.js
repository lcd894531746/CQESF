const {
  MAP_BUBBLES_TABLE_NAME,
  MAP_HOUSES_TABLE_NAME,
  MAP_HOUSE_DISTRICTS_TABLE_NAME,
} = require('./mapSchema');
const { normalizeImageArray, toPublicImageUrl } = require('./utils');

async function resolveLatestDate(pool, tableName, date) {
  if (date) return date;
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(MAX(capture_date), '%Y-%m-%d') AS capture_date FROM \`${tableName}\``
  );
  return rows[0] && rows[0].capture_date ? rows[0].capture_date : null;
}

function normalizeBubbleRow(row) {
  return {
    captureDate: row.capture_date,
    groupType: row.group_type,
    parentGroupType: row.parent_group_type,
    parentId: row.parent_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    bubbleId: row.bubble_id,
    name: row.bubble_name,
    fullSpell: row.full_spell,
    price: row.price,
    priceStr: row.price_str,
    priceUnit: row.price_unit,
    desc: row.desc_text,
    bubbleDesc: row.bubble_desc,
    longitude: row.longitude === null ? null : Number(row.longitude),
    latitude: row.latitude === null ? null : Number(row.latitude),
  };
}

function normalizeHouseRow(row) {
  return {
    id: row.id,
    captureDate: row.capture_date,
    districtName: row.district_name,
    resblockId: row.resblock_id,
    resblockName: row.resblock_name,
    houseCode: row.house_code,
    title: row.title,
    desc: row.house_desc,
    originalCoverPic: toPublicImageUrl(row.cover_pic),
    coverPic: toPublicImageUrl(row.new_cover_pic || row.cover_pic),
    posterImage: toPublicImageUrl(row.new_cover_pic || row.cover_pic),
    priceStr: row.price_str,
    unitPriceStr: row.unit_price_str,
    longitude: row.longitude === null ? null : Number(row.longitude),
    latitude: row.latitude === null ? null : Number(row.latitude),
    actionUrl: row.action_url,
    cardType: row.card_type,
    itemIndex: row.item_index,
    total: row.total,
  };
}

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

function toNullablePositiveNumber(value) {
  const parsed = toNullableNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed;
}

function extractPriceNumber(priceText) {
  const matched = String(priceText || '').trim().match(/[\d.]+/);
  if (!matched) return null;
  const parsed = Number(matched[0]);
  return Number.isNaN(parsed) ? null : parsed;
}

function splitPriceText(priceText) {
  const text = String(priceText || '').trim();
  const match = text.match(/^([\d.]+)\s*(.*)$/);
  if (!match) return { value: '', unit: '' };
  return { value: match[1], unit: match[2] || '' };
}

function normalizeListHouseRow(row, selectedDistrictName = '') {
  const price = splitPriceText(row.price_str);
  const effectiveCover = row.new_cover_pic || row.cover_pic;
  return {
    id: row.id,
    captureDate: row.capture_date,
    houseCode: row.house_code,
    title: row.title,
    listingDesc: row.house_desc,
    communityId: row.resblock_id,
    communityName: row.resblock_name,
    districtName: selectedDistrictName || row.district_name,
    cardType: row.card_type,
    totalPriceText: price.value,
    totalPriceUnit: price.unit,
    unitPriceText: row.unit_price_str,
    originalCoverPic: toPublicImageUrl(row.cover_pic),
    coverPic: toPublicImageUrl(effectiveCover),
    posterImage: toPublicImageUrl(effectiveCover),
    galleryImages: normalizeImageArray(row.details_imgs),
    longitude: row.longitude === null ? null : Number(row.longitude),
    latitude: row.latitude === null ? null : Number(row.latitude),
    approvalType: String(row.approval_type_label || '').trim(),
    approvalStatus: String(row.approval_status_label || '').trim(),
    actionUrl: row.action_url,
  };
}

async function queryMapBubbles(pool, options = {}) {
  const groupType = options.groupType || 'district';
  const captureDate = await resolveLatestDate(pool, MAP_BUBBLES_TABLE_NAME, options.date);
  if (!captureDate) {
    return { captureDate: null, groupType, parentId: options.parentId || null, items: [], itemCount: 0 };
  }

  const params = [captureDate, groupType];
  const where = ['capture_date = ?', 'group_type = ?'];

  if (options.parentId !== undefined) {
    if (options.parentId === null || options.parentId === '') {
      where.push('parent_id IS NULL');
    } else {
      const pid = String(options.parentId);
      const alt =
        options.parentAltId !== undefined && options.parentAltId !== null && options.parentAltId !== ''
          ? String(options.parentAltId)
          : '';
      if (alt && alt !== pid) {
        where.push('(parent_id = ? OR parent_id = ?)');
        params.push(pid, alt);
      } else {
        where.push('parent_id = ?');
        params.push(pid);
      }
    }
  } else if (groupType === 'district') {
    where.push("(parent_id IS NULL OR parent_id = '')");
  }

  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(capture_date, '%Y-%m-%d') AS capture_date,
            group_type, parent_group_type, parent_id, entity_id, entity_type,
            bubble_id, bubble_name, full_spell, price, price_str, price_unit,
            desc_text, bubble_desc, longitude, latitude
       FROM \`${MAP_BUBBLES_TABLE_NAME}\`
       WHERE ${where.join(' AND ')}
       ORDER BY id ASC`,
    params
  );

  return {
    captureDate,
    groupType,
    parentId: options.parentId !== undefined ? options.parentId || null : null,
    items: rows.map(normalizeBubbleRow),
    itemCount: rows.length,
  };
}

async function queryMapHouseList(pool, options = {}) {
  const page = toPositiveInt(options.page, 1);
  const pageSize = Math.min(toPositiveInt(options.pageSize, 20), 100);
  const title = options.title ? String(options.title).trim() : '';
  const districtName = options.districtName ? String(options.districtName).trim() : '';
  const frontendMinPrice = toNullablePositiveNumber(options.minPrice);
  const frontendMaxPrice = toNullablePositiveNumber(options.maxPrice);
  if (frontendMinPrice !== null && frontendMaxPrice !== null && frontendMinPrice > frontendMaxPrice) {
    throw new Error('minPrice cannot be greater than maxPrice');
  }
  const captureDate = await resolveLatestDate(pool, MAP_HOUSES_TABLE_NAME, options.date);

  if (!captureDate) {
    return {
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      filters: {
        title,
        districtName,
        minPrice: frontendMinPrice,
        maxPrice: frontendMaxPrice,
        date: null,
      },
      items: [],
    };
  }

  const where = ['h.capture_date = ?', 'h.is_deleted = 0'];
  const params = [captureDate];

  if (title) {
    where.push('(h.title LIKE ? OR h.resblock_name LIKE ? OR h.house_desc LIKE ?)');
    params.push(`%${title}%`, `%${title}%`, `%${title}%`);
  }

  if (districtName) {
    // The district mapping table may contain one house under multiple districts,
    // so the low-down-payment list must filter by the house card's own district.
    where.push('h.district_name = ?');
    params.push(districtName);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [rows] = await pool.query(
    `SELECT h.id, DATE_FORMAT(h.capture_date, '%Y-%m-%d') AS capture_date,
            h.resblock_id, h.resblock_name, h.house_code, h.title, h.house_desc,
            h.district_name, h.cover_pic, h.new_cover_pic, h.price_str, h.unit_price_str, h.action_url, h.card_type,
            d.details_imgs,
            dj.longitude_bd09 AS longitude,
            dj.latitude_bd09 AS latitude,
            img.status AS image_review_status,
            del.status AS delete_review_status,
            CASE
              WHEN del.status = 'pending' THEN '删除审核'
              WHEN del.status = 'rejected' THEN '删除审核'
              WHEN img.status = 'pending' THEN '图片审核'
              WHEN img.status = 'approved' THEN '图片审核'
              WHEN img.status = 'rejected' THEN '图片审核'
              ELSE ''
            END AS approval_type_label,
            CASE
              WHEN del.status = 'pending' THEN '审核中'
              WHEN del.status = 'rejected' THEN '已驳回'
              WHEN img.status = 'pending' THEN '审核中'
              WHEN img.status = 'approved' THEN '审核完毕'
              WHEN img.status = 'rejected' THEN '已驳回'
              ELSE ''
            END AS approval_status_label
       FROM \`${MAP_HOUSES_TABLE_NAME}\` AS h
       LEFT JOIN \`bk_ershou_details\` AS d
         ON d.house_code = h.house_code
       LEFT JOIN \`djl_esf_house_detail\` AS dj
         ON dj.listing_id = h.house_code
       LEFT JOIN (
         SELECT latest.target_id, latest.status
           FROM \`approval_tasks\` AS latest
           INNER JOIN (
             SELECT MAX(id) AS id
               FROM \`approval_tasks\`
              WHERE action_type = 'bk_house_update_images'
              GROUP BY target_id
           ) AS picked
             ON picked.id = latest.id
       ) AS img
         ON img.target_id = CAST(h.id AS CHAR)
       LEFT JOIN (
         SELECT latest.target_id, latest.status
           FROM \`approval_tasks\` AS latest
           INNER JOIN (
             SELECT MAX(id) AS id
               FROM \`approval_tasks\`
              WHERE action_type = 'bk_house_delete'
              GROUP BY target_id
           ) AS picked
             ON picked.id = latest.id
       ) AS del
         ON del.target_id = CAST(h.id AS CHAR)
       ${whereSql}
       ORDER BY
         CASE
           WHEN h.new_cover_pic IS NULL OR TRIM(h.new_cover_pic) = '' THEN 0
           ELSE 1
         END ASC,
         h.id ASC`,
    params
  );

  const normalizedItems = rows.map((row) => normalizeListHouseRow(row, districtName));
  const filteredItems = normalizedItems.filter((item) => {
    const priceValue = extractPriceNumber(item.totalPriceText);
    if (frontendMinPrice !== null && (priceValue === null || priceValue < frontendMinPrice)) return false;
    if (frontendMaxPrice !== null && (priceValue === null || priceValue > frontendMaxPrice)) return false;
    return true;
  });
  const total = filteredItems.length;
  const offset = (page - 1) * pageSize;
  const pagedItems = filteredItems.slice(offset, offset + pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
    filters: {
      title,
      districtName,
      minPrice: frontendMinPrice,
      maxPrice: frontendMaxPrice,
      date: captureDate,
    },
    items: pagedItems,
  };
}

async function queryMapHouses(pool, options = {}) {
  const rid = options.resblockId != null && options.resblockId !== '' ? String(options.resblockId) : '';
  if (!rid) {
    const error = new Error('resblockId is required');
    error.statusCode = 400;
    throw error;
  }

  const captureDate = await resolveLatestDate(pool, MAP_HOUSES_TABLE_NAME, options.date);
  if (!captureDate) {
    return { captureDate: null, resblockId: rid, items: [], itemCount: 0, total: 0 };
  }

  const alt =
    options.resblockAltId !== undefined && options.resblockAltId !== null && options.resblockAltId !== ''
      ? String(options.resblockAltId)
      : '';
  const resblockWhere = alt && alt !== rid ? '(resblock_id = ? OR resblock_id = ?)' : 'resblock_id = ?';
  const params =
    alt && alt !== rid ? [captureDate, rid, alt] : [captureDate, rid];

  const [rows] = await pool.query(
    `SELECT h.id, DATE_FORMAT(h.capture_date, '%Y-%m-%d') AS capture_date,
            h.resblock_id, h.resblock_name, h.house_code, h.title, h.house_desc,
            h.district_name, h.cover_pic, h.new_cover_pic, h.price_str, h.unit_price_str, h.action_url, h.card_type,
            h.item_index, h.total,
            dj.longitude_bd09 AS longitude,
            dj.latitude_bd09 AS latitude
       FROM \`${MAP_HOUSES_TABLE_NAME}\` AS h
       LEFT JOIN \`djl_esf_house_detail\` AS dj
         ON dj.listing_id = h.house_code
       WHERE h.capture_date = ? AND h.is_deleted = 0 AND ${resblockWhere.replace(/resblock_id/g, 'h.resblock_id')}
       ORDER BY h.item_index ASC, h.id ASC`,
    params
  );

  const items = rows.map(normalizeHouseRow);
  return {
    captureDate,
    resblockId: rid,
    resblockName: items[0] ? items[0].resblockName : '',
    items,
    itemCount: items.length,
    total: items[0] && items[0].total !== null ? Number(items[0].total) : items.length,
  };
}

async function queryMapHouseCard(pool, options = {}) {
  const captureDate = await resolveLatestDate(pool, MAP_HOUSES_TABLE_NAME, options.date);
  if (!captureDate) {
    return null;
  }

  const where = ['capture_date = ?', 'is_deleted = 0'];
  const params = [captureDate];

  if (options.id && options.houseCode) {
    where.push('(id = ? OR house_code = ?)');
    params.push(Number(options.id), String(options.houseCode));
  } else if (options.id) {
    where.push('id = ?');
    params.push(Number(options.id));
  } else if (options.houseCode) {
    where.push('house_code = ?');
    params.push(String(options.houseCode));
  } else {
    const error = new Error('id or houseCode is required');
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.query(
    `SELECT h.id, DATE_FORMAT(h.capture_date, '%Y-%m-%d') AS capture_date,
            h.resblock_id, h.resblock_name, h.house_code, h.title, h.house_desc,
            h.district_name, h.cover_pic, h.new_cover_pic, h.price_str, h.unit_price_str, h.action_url, h.card_type,
            h.item_index, h.total,
            dj.longitude_bd09 AS longitude,
            dj.latitude_bd09 AS latitude
       FROM \`${MAP_HOUSES_TABLE_NAME}\` AS h
       LEFT JOIN \`djl_esf_house_detail\` AS dj
         ON dj.listing_id = h.house_code
       WHERE ${where.map((item) => item.replace(/\bcapture_date\b/g, 'h.capture_date').replace(/\bis_deleted\b/g, 'h.is_deleted').replace(/\bid\b/g, 'h.id').replace(/\bhouse_code\b/g, 'h.house_code')).join(' AND ')}
       ORDER BY h.id DESC
       LIMIT 1`,
    params
  );

  if (!rows.length) {
    const error = new Error('map house card not found');
    error.statusCode = 404;
    throw error;
  }

  return normalizeHouseRow(rows[0]);
}

module.exports = {
  queryMapBubbles,
  queryMapHouseList,
  queryMapHouses,
  queryMapHouseCard,
};
