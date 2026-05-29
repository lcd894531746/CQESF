const { DJL_SUB_AREA_TABLE_NAME } = require('./djlSubAreaSchema');

const DJL_COMMUNITY_TABLE_NAME = 'djl_community_map_rel';
const DJL_HOUSE_DETAIL_TABLE_NAME = 'djl_esf_house_detail';

async function refreshDjlDistrictMetrics(connection) {
  await connection.query(
    `
      UPDATE djl_map_district_rel d
      LEFT JOIN (
        SELECT
          h.area_code,
          COUNT(*) AS sale_count,
          COUNT(DISTINCT h.community_id) AS community_count,
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
        FROM \`${DJL_HOUSE_DETAIL_TABLE_NAME}\` h
        LEFT JOIN \`${DJL_COMMUNITY_TABLE_NAME}\` c
          ON c.community_id = h.community_id
        GROUP BY h.area_code
      ) x ON x.area_code = d.area_code
      SET d.sale_count = COALESCE(x.sale_count, 0),
          d.community_count = COALESCE(x.community_count, 0),
          d.avg_price_text = CASE
            WHEN x.avg_unit_price IS NULL THEN ''
            WHEN MOD(x.avg_unit_price, 1) = 0 THEN CONCAT(CAST(x.avg_unit_price AS UNSIGNED), '元/㎡')
            ELSE CONCAT(x.avg_unit_price, '元/㎡')
          END
    `
  );
}

async function rebuildDjlSubAreaCenters(connection) {
  await connection.query(`TRUNCATE TABLE \`${DJL_SUB_AREA_TABLE_NAME}\``);

  await connection.query(
    `
      INSERT INTO \`${DJL_SUB_AREA_TABLE_NAME}\` (
        area_code,
        area_name,
        sub_area_name,
        longitude_bd09,
        latitude_bd09,
        community_count,
        house_count,
        source
      )
      SELECT
        c.area_code,
        c.area_name,
        c.sub_area_name,
        COALESCE(c.community_longitude, h.house_longitude) AS longitude_bd09,
        COALESCE(c.community_latitude, h.house_latitude) AS latitude_bd09,
        c.community_count,
        COALESCE(h.house_count, 0) AS house_count,
        CASE
          WHEN c.community_longitude IS NOT NULL AND c.community_latitude IS NOT NULL THEN 'community_avg'
          WHEN h.house_longitude IS NOT NULL AND h.house_latitude IS NOT NULL THEN 'house_avg'
          ELSE 'missing'
        END AS source
      FROM (
        SELECT
          area_code,
          area_name,
          sub_area_name,
          COUNT(DISTINCT community_id) AS community_count,
          ROUND(AVG(CASE WHEN longitude_bd09 IS NOT NULL THEN longitude_bd09 END), 6) AS community_longitude,
          ROUND(AVG(CASE WHEN latitude_bd09 IS NOT NULL THEN latitude_bd09 END), 6) AS community_latitude
        FROM \`${DJL_COMMUNITY_TABLE_NAME}\`
        WHERE TRIM(COALESCE(area_code, '')) <> ''
          AND TRIM(COALESCE(area_name, '')) <> ''
          AND TRIM(COALESCE(sub_area_name, '')) <> ''
        GROUP BY area_code, area_name, sub_area_name
      ) AS c
      LEFT JOIN (
        SELECT
          area_code,
          area_name,
          sub_area_name,
          COUNT(*) AS house_count,
          ROUND(AVG(CASE WHEN longitude_bd09 IS NOT NULL THEN longitude_bd09 END), 6) AS house_longitude,
          ROUND(AVG(CASE WHEN latitude_bd09 IS NOT NULL THEN latitude_bd09 END), 6) AS house_latitude
        FROM \`${DJL_HOUSE_DETAIL_TABLE_NAME}\`
        WHERE TRIM(COALESCE(area_code, '')) <> ''
          AND TRIM(COALESCE(area_name, '')) <> ''
          AND TRIM(COALESCE(sub_area_name, '')) <> ''
        GROUP BY area_code, area_name, sub_area_name
      ) AS h
        ON h.area_code = c.area_code
       AND h.area_name = c.area_name
       AND h.sub_area_name = c.sub_area_name
      ORDER BY c.area_code ASC, c.sub_area_name ASC
    `
  );

  const [rows] = await connection.query(
    `
      SELECT
        area_code,
        area_name,
        sub_area_name,
        longitude_bd09,
        latitude_bd09,
        community_count,
        house_count,
        source
      FROM \`${DJL_SUB_AREA_TABLE_NAME}\`
      ORDER BY area_code ASC, sub_area_name ASC
    `
  );

  return rows.map((row) => ({
    areaCode: String(row.area_code || '').trim(),
    areaName: String(row.area_name || '').trim(),
    subAreaName: String(row.sub_area_name || '').trim(),
    longitude: row.longitude_bd09 === null ? null : Number(row.longitude_bd09),
    latitude: row.latitude_bd09 === null ? null : Number(row.latitude_bd09),
    communityCount: Number(row.community_count || 0),
    houseCount: Number(row.house_count || 0),
    source: String(row.source || '').trim(),
  }));
}

module.exports = {
  rebuildDjlSubAreaCenters,
  refreshDjlDistrictMetrics,
};
