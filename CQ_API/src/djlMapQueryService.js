const DJL_COMMUNITY_TABLE_NAME = 'djl_community_map_rel';
const DJL_SUB_AREA_TABLE_NAME = 'djl_sub_area_map_rel';
const { convertPointFromBd09 } = require('./coordinateUtils');

const FIXED_DJL_DISTRICTS = [
  { areaCode: 'a1', areaName: '渝中区', displayName: '渝中', longitude: 106.54503, latitude: 29.553162 },
  { areaCode: 'a4', areaName: '南岸区', displayName: '南岸', longitude: 106.608759, latitude: 29.534808 },
  { areaCode: 'a6', areaName: '大渡口区', displayName: '大渡口', longitude: 106.479341, latitude: 29.457765 },
  { areaCode: 'a5', areaName: '九龙坡区', displayName: '九龙坡', longitude: 106.487852, latitude: 29.504235 },
  { areaCode: 'a2', areaName: '沙坪坝区', displayName: '沙坪坝', longitude: 106.398656, latitude: 29.599685 },
  { areaCode: 'a8', areaName: '巴南区', displayName: '巴南', longitude: 106.549276, latitude: 29.426386 },
  { areaCode: 'a7', areaName: '两江新区', displayName: '两江新区', longitude: 106.550764, latitude: 29.668822 },
];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUnitPriceText(value) {
  const parsed = toNumberOrNull(value);
  if (parsed === null || parsed <= 0) return '';
  const rounded = Math.round(parsed * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}元/㎡` : `${rounded.toFixed(1)}元/㎡`;
}

async function queryDjlMapDistricts(pool) {
  const areaCodes = FIXED_DJL_DISTRICTS.map((item) => item.areaCode);
  const placeholders = areaCodes.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `
      SELECT
        d.area_code,
        MAX(d.sale_count) AS sale_count,
        MAX(d.longitude_bd09) AS longitude_bd09,
        MAX(d.latitude_bd09) AS latitude_bd09,
        ROUND(
          AVG(
            CASE
              WHEN TRIM(COALESCE(c.community_avg_price_text, '')) <> ''
                THEN CAST(TRIM(c.community_avg_price_text) AS DECIMAL(10, 2))
              ELSE NULL
            END
          ),
          1
        ) AS avg_unit_price
      FROM \`djl_map_district_rel\` AS d
      LEFT JOIN \`${DJL_COMMUNITY_TABLE_NAME}\` AS c
        ON c.area_code = d.area_code
      WHERE d.area_code IN (${placeholders})
      GROUP BY d.area_code
      ORDER BY FIELD(d.area_code, ${placeholders})
    `,
    [...areaCodes, ...areaCodes]
  );

  const metricsMap = new Map(
    rows.map((row) => [
      String(row.area_code || '').trim(),
      {
        houseCount: Number(row.sale_count || 0),
        avgUnitPrice: toNumberOrNull(row.avg_unit_price),
        longitude: toNumberOrNull(row.longitude_bd09),
        latitude: toNumberOrNull(row.latitude_bd09),
      },
    ])
  );

  return FIXED_DJL_DISTRICTS.map((item) => {
    const metrics = metricsMap.get(item.areaCode) || {
      houseCount: 0,
      avgUnitPrice: null,
      longitude: null,
      latitude: null,
    };
    const point = convertPointFromBd09(
      metrics.longitude ?? item.longitude,
      metrics.latitude ?? item.latitude,
    );
    return {
      areaCode: item.areaCode,
      areaName: item.areaName,
      displayName: item.displayName,
      longitude: point.longitude,
      latitude: point.latitude,
      houseCount: metrics.houseCount,
      avgTotalPriceWan: metrics.avgUnitPrice,
      priceText: formatUnitPriceText(metrics.avgUnitPrice),
    };
  });
}

async function queryDjlMapSubAreas(pool, options = {}) {
  const areaCode = String(options.areaCode || '').trim();
  if (!areaCode) {
    const error = new Error('areaCode is required');
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.query(
    `
      SELECT
        s.area_code,
        s.area_name,
        s.sub_area_name,
        s.longitude_bd09,
        s.latitude_bd09,
        s.community_count,
        s.house_count,
        ROUND(
          AVG(
            CASE
              WHEN TRIM(COALESCE(c.community_avg_price_text, '')) <> ''
                THEN CAST(TRIM(c.community_avg_price_text) AS DECIMAL(10, 2))
              ELSE NULL
            END
          ),
          1
        ) AS avg_unit_price
      FROM \`${DJL_SUB_AREA_TABLE_NAME}\` AS s
      LEFT JOIN \`${DJL_COMMUNITY_TABLE_NAME}\` AS c
        ON c.area_code = s.area_code
       AND c.sub_area_name = s.sub_area_name
      WHERE s.area_code = ?
      GROUP BY
        s.area_code,
        s.area_name,
        s.sub_area_name,
        s.longitude_bd09,
        s.latitude_bd09,
        s.community_count,
        s.house_count
      ORDER BY s.house_count DESC, s.sub_area_name ASC
    `,
    [areaCode]
  );

  return rows.map((row) => {
    const point = convertPointFromBd09(row.longitude_bd09, row.latitude_bd09);
    return {
      areaCode: String(row.area_code || '').trim(),
      areaName: String(row.area_name || '').trim(),
      subAreaName: String(row.sub_area_name || '').trim(),
      longitude: point.longitude,
      latitude: point.latitude,
      communityCount: Number(row.community_count || 0),
      houseCount: Number(row.house_count || 0),
      avgTotalPriceWan: toNumberOrNull(row.avg_unit_price),
      priceText: formatUnitPriceText(row.avg_unit_price),
    };
  });
}

async function queryDjlMapCommunities(pool, options = {}) {
  const areaCode = String(options.areaCode || '').trim();
  const subAreaName = String(options.subAreaName || '').trim();
  if (!areaCode || !subAreaName) {
    const error = new Error('areaCode and subAreaName are required');
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.query(
    `
      SELECT
        c.community_id,
        c.community_name,
        c.area_code,
        c.area_name,
        c.sub_area_name,
        c.longitude_bd09,
        c.latitude_bd09,
        c.community_avg_price_text
      FROM \`${DJL_COMMUNITY_TABLE_NAME}\` AS c
      WHERE c.area_code = ?
        AND c.sub_area_name = ?
      ORDER BY c.community_name ASC
    `,
    [areaCode, subAreaName]
  );

  return rows.map((row) => {
    const point = convertPointFromBd09(row.longitude_bd09, row.latitude_bd09);
    return {
      communityId: String(row.community_id || '').trim(),
      communityName: String(row.community_name || '').trim(),
      areaCode: String(row.area_code || '').trim(),
      areaName: String(row.area_name || '').trim(),
      subAreaName: String(row.sub_area_name || '').trim(),
      longitude: point.longitude,
      latitude: point.latitude,
      houseCount: 0,
      avgTotalPriceWan: toNumberOrNull(String(row.community_avg_price_text || '').replace(/[^\d.]/g, '')),
      priceText: String(row.community_avg_price_text || '').trim(),
    };
  });
}

module.exports = {
  FIXED_DJL_DISTRICTS,
  queryDjlMapDistricts,
  queryDjlMapSubAreas,
  queryDjlMapCommunities,
};
