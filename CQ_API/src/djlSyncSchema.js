const DJL_SYNC_TASK_TABLE_NAME = 'djl_sync_tasks';
const DJL_MAP_DISTRICT_TABLE_NAME = 'djl_map_district_rel';

const CREATE_DJL_SYNC_TASK_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${DJL_SYNC_TASK_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_type VARCHAR(32) NOT NULL DEFAULT 'full_sync',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  trigger_by_staff_id BIGINT NULL,
  trigger_by_name VARCHAR(64) DEFAULT '',
  summary JSON NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_type (task_type),
  KEY idx_status (status),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_DJL_MAP_DISTRICT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${DJL_MAP_DISTRICT_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  area_code VARCHAR(32) NOT NULL,
  area_id VARCHAR(32) NOT NULL,
  area_name VARCHAR(64) NOT NULL,
  display_name VARCHAR(64) DEFAULT '',
  sale_count INT NOT NULL DEFAULT 0,
  rent_count INT NOT NULL DEFAULT 0,
  community_count INT NOT NULL DEFAULT 0,
  avg_price_text VARCHAR(64) DEFAULT '',
  longitude_bd09 DECIMAL(12, 6) DEFAULT NULL,
  latitude_bd09 DECIMAL(12, 6) DEFAULT NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_area_code (area_code),
  KEY idx_area_id (area_id),
  KEY idx_area_name (area_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

module.exports = {
  DJL_SYNC_TASK_TABLE_NAME,
  DJL_MAP_DISTRICT_TABLE_NAME,
  CREATE_DJL_SYNC_TASK_TABLE_SQL,
  CREATE_DJL_MAP_DISTRICT_TABLE_SQL,
};
