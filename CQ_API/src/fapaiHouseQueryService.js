const ExcelJS = require('exceljs');

const TABLE_NAME = 'fp_house_listings';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function trimText(value) {
  return String(value || '').trim();
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

function toIsoString(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function formatDateOnly(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`;
}

function formatDateTimeForFileName(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function extractDistrictName(value) {
  const raw = trimText(value);
  if (!raw) return '';
  const parts = raw
    .split(/[，,]/)
    .map((item) => trimText(item))
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : raw;
}

function buildWhereClause(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.title) {
    conditions.push('title LIKE ?');
    values.push(`%${filters.title}%`);
  }

  if (filters.districtId) {
    conditions.push('district_id = ?');
    values.push(filters.districtId);
  }

  if (filters.startDate) {
    conditions.push('DATE(create_time) >= ?');
    values.push(filters.startDate);
  }

  if (filters.endDate) {
    conditions.push('DATE(create_time) <= ?');
    values.push(filters.endDate);
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

function normalizeListRow(row) {
  return {
    id: Number(row.id || 0),
    sourceId: row.source_id === null || row.source_id === undefined ? null : Number(row.source_id),
    title: trimText(row.title),
    districtId: row.district_id === null || row.district_id === undefined ? null : Number(row.district_id),
    districtAreaCode: trimText(row.district_area_code),
    districtWholeName: trimText(row.district_whole_name),
    districtName: extractDistrictName(row.district_whole_name),
    communityName: trimText(row.community_name),
    buildYear: trimText(row.build_year),
    createTime: toIsoString(row.create_time),
    createdAt: toIsoString(row.created_at),
  };
}

async function queryFapaiDistrictOptions(pool) {
  const [rows] = await pool.query(
    `
      SELECT
        district_id AS districtId,
        district_whole_name AS districtWholeName
      FROM \`${TABLE_NAME}\`
      WHERE district_id IS NOT NULL
      GROUP BY district_id, district_whole_name
      ORDER BY district_id ASC
    `
  );

  return rows.map((row) => ({
    districtId: Number(row.districtId || 0),
    districtName: extractDistrictName(row.districtWholeName),
    districtWholeName: trimText(row.districtWholeName),
  }));
}

async function queryFapaiHouseList(pool, options = {}) {
  const page = toPositiveInt(options.page, 1);
  const pageSize = Math.min(toPositiveInt(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const includeTotal = toBoolean(options.includeTotal, true);
  const title = trimText(options.title);
  const districtId = trimText(options.districtId);
  const startDate = trimText(options.startDate);
  const endDate = trimText(options.endDate);
  const filters = {
    title,
    districtId: districtId ? Number(districtId) : null,
    startDate,
    endDate,
  };
  const { whereSql, values } = buildWhereClause(filters);
  const offset = (page - 1) * pageSize;
  let total = 0;

  if (includeTotal) {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM \`${TABLE_NAME}\` ${whereSql}`,
      values
    );
    total = Number(countRows?.[0]?.total || 0);
  }

  const [rows] = await pool.query(
    `
      SELECT
        id,
        source_id,
        title,
        district_id,
        district_area_code,
        district_whole_name,
        community_name,
        build_year,
        create_time,
        created_at
      FROM \`${TABLE_NAME}\`
      ${whereSql}
      ORDER BY create_time DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    [...values, pageSize, offset]
  );

  return {
    page,
    pageSize,
    total,
    totalPages: includeTotal && total > 0 ? Math.ceil(total / pageSize) : 0,
    items: rows.map(normalizeListRow),
  };
}

function buildSheetName(districtName, usedNames) {
  const fallback = trimText(districtName) || '未分区';
  let nextName = fallback.slice(0, 31);
  let index = 2;
  while (usedNames.has(nextName)) {
    const suffix = String(index);
    nextName = `${fallback.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedNames.add(nextName);
  return nextName;
}

function applySheetHeaderStyle(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'D9EAD3' },
  };
}

async function exportFapaiHouseWorkbook(pool) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        source_id,
        title,
        district_id,
        district_area_code,
        district_whole_name,
        community_name,
        plate_name,
        detail_address,
        build_year,
        build_year_group,
        floor_level,
        elevator_text,
        decoration_text,
        layout,
        area,
        area_group,
        market_price,
        starting_price,
        bargain_space,
        discount_rate_percent,
        guarantee_amount,
        markup_price,
        property_type_text,
        jump_link,
        platform,
        auction_time,
        auction_end_time,
        create_time,
        created_at
      FROM \`${TABLE_NAME}\`
      ORDER BY district_id ASC, create_time DESC, id DESC
    `
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex';
  workbook.created = new Date();

  const groups = new Map();
  rows.forEach((row) => {
    const districtName = extractDistrictName(row.district_whole_name);
    const key = districtName || '未分区';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const headers = [
    '序号',
    '区域',
    '标题',
    '小区名称',
    '商圈',
    '房屋建立时间',
    '装修',
    '户型',
    '建筑面积(㎡)',
    '评估价(万)',
    '起拍价(万)',
    '捡漏空间(万)',
    '楼层',
    '电梯',
    '房屋类型',
    '面积区间',
    '年代区间',
    '房源链接',
    '拍卖开始时间',
    '拍卖结束时间',
    '详细地址',
    '起拍折扣(%)',
    '保证金(万)',
    '加价幅度(万)',
    '拍卖平台',
    '房屋上架时间',
    '数据采集时间',
  ];

  const usedNames = new Set();
  for (const [districtName, items] of groups.entries()) {
    const sheet = workbook.addWorksheet(buildSheetName(districtName, usedNames));
    sheet.addRow(headers);
    applySheetHeaderStyle(sheet);

    items.forEach((item, index) => {
      sheet.addRow([
        index + 1,
        districtName,
        trimText(item.title),
        trimText(item.community_name),
        trimText(item.plate_name),
        trimText(item.build_year),
        trimText(item.decoration_text),
        trimText(item.layout),
        item.area === null || item.area === undefined ? '' : Number(item.area),
        item.market_price === null || item.market_price === undefined ? '' : Number(item.market_price),
        item.starting_price === null || item.starting_price === undefined ? '' : Number(item.starting_price),
        item.bargain_space === null || item.bargain_space === undefined ? '' : Number(item.bargain_space),
        trimText(item.floor_level),
        trimText(item.elevator_text),
        trimText(item.property_type_text),
        trimText(item.area_group),
        trimText(item.build_year_group),
        trimText(item.jump_link),
        formatDateOnly(item.auction_time),
        formatDateOnly(item.auction_end_time),
        trimText(item.detail_address),
        item.discount_rate_percent === null || item.discount_rate_percent === undefined ? '' : Number(item.discount_rate_percent),
        item.guarantee_amount === null || item.guarantee_amount === undefined ? '' : Number(item.guarantee_amount),
        item.markup_price === null || item.markup_price === undefined ? '' : Number(item.markup_price),
        trimText(item.platform),
        formatDateOnly(item.create_time),
        formatDateTime(item.created_at),
      ]);
    });

    sheet.columns = [
      { width: 8 },
      { width: 16 },
      { width: 12 },
      { width: 36 },
      { width: 20 },
      { width: 14 },
      { width: 14 },
      { width: 10 },
      { width: 16 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 12 },
      { width: 10 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 28 },
      { width: 16 },
      { width: 16 },
      { width: 34 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 16 },
    ];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    fileName: `法拍房源导出_${formatDateTimeForFileName(new Date())}.xlsx`,
    total: rows.length,
    sheetCount: groups.size,
  };
}

module.exports = {
  queryFapaiHouseList,
  queryFapaiDistrictOptions,
  exportFapaiHouseWorkbook,
};
