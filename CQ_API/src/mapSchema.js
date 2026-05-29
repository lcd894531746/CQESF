const MAP_DISTRICTS_TABLE_NAME = 'bk_map_district_bubbles';
const MAP_BUBBLES_TABLE_NAME = 'bk_map_bubbles';
const MAP_HOUSES_TABLE_NAME = 'bk_map_house_cards';
const MAP_HOUSE_DISTRICTS_TABLE_NAME = 'bk_map_house_districts';

const CREATE_MAP_DISTRICTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${MAP_DISTRICTS_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  capture_date DATE NOT NULL,
  district_name VARCHAR(255) NULL,
  full_spell VARCHAR(255) NULL,
  price INT NULL,
  price_str VARCHAR(64) NULL,
  price_unit VARCHAR(32) NULL,
  desc_text VARCHAR(64) NULL,
  count_unit VARCHAR(32) NULL,
  longitude DECIMAL(18, 12) NULL,
  latitude DECIMAL(18, 12) NULL,
  border LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_capture_district_name (capture_date, district_name),
  KEY idx_capture_date (capture_date),
  KEY idx_district_name (district_name),
  KEY idx_price (price)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_MAP_BUBBLES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${MAP_BUBBLES_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  capture_date DATE NOT NULL,
  group_type VARCHAR(32) NOT NULL,
  parent_group_type VARCHAR(32) NULL,
  parent_id VARCHAR(64) NULL,
  entity_id VARCHAR(64) NULL,
  entity_type VARCHAR(64) NULL,
  bubble_id VARCHAR(64) NULL,
  bubble_name VARCHAR(255) NULL,
  full_spell VARCHAR(255) NULL,
  price INT NULL,
  price_str VARCHAR(64) NULL,
  price_unit VARCHAR(32) NULL,
  desc_text VARCHAR(64) NULL,
  bubble_desc VARCHAR(255) NULL,
  count_unit VARCHAR(32) NULL,
  longitude DECIMAL(18, 12) NULL,
  latitude DECIMAL(18, 12) NULL,
  border LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_map_bubble_parent (capture_date, group_type, parent_id, bubble_id),
  KEY idx_capture_date (capture_date),
  KEY idx_group_type (group_type),
  KEY idx_parent_id (parent_id),
  KEY idx_entity_id (entity_id),
  KEY idx_bubble_name (bubble_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_MAP_HOUSES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${MAP_HOUSES_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  capture_date DATE NOT NULL,
  district_name VARCHAR(255) NULL,
  resblock_id VARCHAR(64) NULL,
  resblock_name VARCHAR(255) NULL,
  house_code VARCHAR(64) NULL,
  title VARCHAR(255) NULL,
  house_desc VARCHAR(255) NULL,
  cover_pic LONGTEXT NULL,
  new_cover_pic LONGTEXT NULL,
  price_str VARCHAR(64) NULL,
  unit_price_str VARCHAR(64) NULL,
  action_url LONGTEXT NULL,
  card_type VARCHAR(64) NULL,
  item_index INT NOT NULL,
  total INT NULL,
  page INT NULL,
  page_size INT NULL,
  has_more TINYINT(1) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_map_house (capture_date, resblock_id, house_code),
  KEY idx_capture_date (capture_date),
  KEY idx_district_name (district_name),
  KEY idx_resblock_id (resblock_id),
  KEY idx_house_code (house_code),
  KEY idx_is_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_MAP_HOUSE_DISTRICTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${MAP_HOUSE_DISTRICTS_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  capture_date DATE NOT NULL,
  district_name VARCHAR(255) NOT NULL,
  resblock_id VARCHAR(64) NOT NULL,
  house_code VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_map_house_district (capture_date, district_name, resblock_id, house_code),
  KEY idx_capture_district (capture_date, district_name),
  KEY idx_house_code (house_code),
  KEY idx_resblock_id (resblock_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

module.exports = {
  MAP_DISTRICTS_TABLE_NAME,
  MAP_BUBBLES_TABLE_NAME,
  MAP_HOUSES_TABLE_NAME,
  MAP_HOUSE_DISTRICTS_TABLE_NAME,
  CREATE_MAP_DISTRICTS_TABLE_SQL,
  CREATE_MAP_BUBBLES_TABLE_SQL,
  CREATE_MAP_HOUSES_TABLE_SQL,
  CREATE_MAP_HOUSE_DISTRICTS_TABLE_SQL,
};
