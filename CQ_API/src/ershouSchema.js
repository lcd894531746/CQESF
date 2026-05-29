const DETAILS_TABLE_NAME = 'bk_ershou_details';

const CREATE_DETAILS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${DETAILS_TABLE_NAME}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  capture_date DATE NOT NULL,
  house_code VARCHAR(64) NOT NULL,
  route LONGTEXT NULL,
  title VARCHAR(255) NULL,
  price VARCHAR(64) NULL,
  unit_price VARCHAR(64) NULL,
  area DECIMAL(12, 2) NULL,
  bed_room_num INT NULL,
  hall_num INT NULL,
  orientation VARCHAR(64) NULL,
  floor_state VARCHAR(128) NULL,
  property_type VARCHAR(64) NULL,
  build_year VARCHAR(64) NULL,
  house_use VARCHAR(64) NULL,
  building_type VARCHAR(64) NULL,
  orientation_text VARCHAR(64) NULL,
  has_elevator_text VARCHAR(64) NULL,
  community_name VARCHAR(255) NULL,
  community_id VARCHAR(64) NULL,
  city_id VARCHAR(64) NULL,
  m_url LONGTEXT NULL,
  details_imgs JSON NULL,
  dynamic_json JSON NULL,
  resources_json JSON NULL,
  community_info_json JSON NULL,
  market_trend_json JSON NULL,
  same_community_for_sale_json JSON NULL,
  same_community_trades_json JSON NULL,
  commute_json JSON NULL,
  surroundings_json JSON NULL,
  community_comment_json JSON NULL,
  triggers_json JSON NULL,
  route_info_json JSON NULL,
  http_count INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_capture_date_house_code (capture_date, house_code),
  KEY idx_capture_date (capture_date),
  KEY idx_house_code (house_code),
  KEY idx_community_id (community_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

module.exports = {
  DETAILS_TABLE_NAME,
  CREATE_DETAILS_TABLE_SQL,
};
