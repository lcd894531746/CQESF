const DJL_SUB_AREA_TABLE_NAME = 'djl_sub_area_map_rel';

const CREATE_DJL_SUB_AREA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${DJL_SUB_AREA_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  area_code VARCHAR(32) NOT NULL,
  area_name VARCHAR(64) NOT NULL,
  sub_area_name VARCHAR(128) NOT NULL,
  longitude_bd09 DECIMAL(12, 6) DEFAULT NULL,
  latitude_bd09 DECIMAL(12, 6) DEFAULT NULL,
  community_count INT NOT NULL DEFAULT 0,
  house_count INT NOT NULL DEFAULT 0,
  source VARCHAR(32) NOT NULL DEFAULT 'community_avg',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_area_sub_area (area_code, sub_area_name),
  KEY idx_area_code (area_code),
  KEY idx_area_name (area_name),
  KEY idx_sub_area_name (sub_area_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

module.exports = {
  DJL_SUB_AREA_TABLE_NAME,
  CREATE_DJL_SUB_AREA_TABLE_SQL,
};
