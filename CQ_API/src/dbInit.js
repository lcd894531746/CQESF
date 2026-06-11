const { CREATE_DETAILS_TABLE_SQL } = require('./ershouSchema');
const crypto = require('crypto');
const {
  CREATE_MAP_DISTRICTS_TABLE_SQL,
  CREATE_MAP_BUBBLES_TABLE_SQL,
  CREATE_MAP_HOUSES_TABLE_SQL,
  CREATE_MAP_HOUSE_DISTRICTS_TABLE_SQL,
} = require('./mapSchema');
const { CREATE_DJL_SUB_AREA_TABLE_SQL } = require('./djlSubAreaSchema');
const { CREATE_DJL_SYNC_TASK_TABLE_SQL, CREATE_DJL_MAP_DISTRICT_TABLE_SQL } = require('./djlSyncSchema');

const SYSTEM_STAFF_TABLE = 'system_staff';
const APPROVAL_TASKS_TABLE = 'approval_tasks';
const LEGACY_SYSTEM_STAFF_TABLE = 'people';
const WECHAT_USERS_TABLE = 'wechat_users';
const WECHAT_SALES_SHARES_TABLE = 'wechat_sales_shares';
const WECHAT_CUSTOMER_SALES_BINDINGS_TABLE = 'wechat_customer_sales_bindings';
const LEGACY_WECHAT_USERS_TABLE = 'wechat_phone_auths';
const LEGACY_WECHAT_BINDINGS_TABLE = 'wechat_openid_bindings';
const DEFAULT_STAFF_PASSWORD = '123456';
const PASSWORD_SALT = 'cq-resale-house-system-staff';
const ROLE_ADMIN = 'admin';
const ROLE_REVIEWER = 'reviewer';
const ROLE_UPLOADER = 'uploader';
const ROLE_SALES = 'sales';

function hashPassword(password) {
  return crypto.createHash('sha256').update(`${PASSWORD_SALT}:${password}`).digest('hex');
}

const CREATE_SYSTEM_STAFF_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS system_staff (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  role VARCHAR(50) NOT NULL,
  password_hash VARCHAR(128) NOT NULL DEFAULT '',
  wechat_openid VARCHAR(64) DEFAULT '',
  wechat_unionid VARCHAR(64) DEFAULT '',
  wechat_bound_at DATETIME NULL,
  status TINYINT NOT NULL DEFAULT 1,
  remark VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_phone (phone)
)
`;

const CREATE_APPROVAL_TASKS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS approval_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  action_type VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) DEFAULT '',
  summary VARCHAR(255) DEFAULT '',
  payload JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_by_staff_id BIGINT NOT NULL,
  created_by_name VARCHAR(50) DEFAULT '',
  created_by_role VARCHAR(50) DEFAULT '',
  reviewed_by_staff_id BIGINT NULL,
  reviewed_by_name VARCHAR(50) DEFAULT '',
  review_note VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  INDEX idx_status (status),
  INDEX idx_created_by_staff_id (created_by_staff_id),
  INDEX idx_action_type (action_type),
  INDEX idx_target_type_target_id (target_type, target_id)
)
`;

const CREATE_BASIC_SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS basic_settings (
  id TINYINT PRIMARY KEY,
  min_house_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  max_house_price DECIMAL(12, 2) NOT NULL DEFAULT 150,
  interest_rate DECIMAL(6, 2) NOT NULL DEFAULT 3.15,
  fapai_intro TEXT NULL,
  low_down_payment_intro TEXT NULL,
  mini_program_access_mode VARCHAR(16) NOT NULL DEFAULT 'strict',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
`;

const CREATE_SPECIAL_ASSETS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS special_assets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  community_name VARCHAR(255) DEFAULT '',
  asset_desc TEXT NULL,
  total_price VARCHAR(64) DEFAULT '',
  unit_price VARCHAR(64) DEFAULT '',
  area DECIMAL(12, 2) NULL,
  bed_room_num INT NULL,
  hall_num INT NULL,
  orientation VARCHAR(64) DEFAULT '',
  floor_state VARCHAR(128) DEFAULT '',
  contact_name VARCHAR(80) DEFAULT '',
  contact_phone VARCHAR(40) DEFAULT '',
  cover_image LONGTEXT NULL,
  gallery_images JSON NULL,
  status TINYINT NOT NULL DEFAULT 1,
  remark VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
`;

const CREATE_DJL_DELETED_HOUSES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS djl_deleted_houses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  listing_id VARCHAR(64) NOT NULL DEFAULT '',
  source_house_id BIGINT NULL,
  community_id VARCHAR(64) DEFAULT '',
  title VARCHAR(255) DEFAULT '',
  area_code VARCHAR(32) DEFAULT '',
  area_name VARCHAR(64) DEFAULT '',
  sub_area_name VARCHAR(128) DEFAULT '',
  deleted_by_staff_id BIGINT NULL,
  deleted_by_name VARCHAR(64) DEFAULT '',
  delete_source VARCHAR(32) NOT NULL DEFAULT 'manual_admin_delete',
  remark VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_listing_id (listing_id),
  KEY idx_source_house_id (source_house_id),
  KEY idx_community_id (community_id),
  KEY idx_area_code (area_code)
)
`;

const CREATE_WECHAT_USERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS wechat_users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(64) NOT NULL,
  unionid VARCHAR(64) DEFAULT '',
  sales_openid VARCHAR(64) DEFAULT '',
  sales_person_id BIGINT NULL,
  bound_at DATETIME NULL,
  authorized_until DATETIME NULL,
  last_login_at DATETIME NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_openid (openid),
  INDEX idx_sales_openid (sales_openid),
  INDEX idx_sales_person_id (sales_person_id),
  INDEX idx_authorized_until (authorized_until),
  INDEX idx_last_login_at (last_login_at)
)
`;

const CREATE_WECHAT_SALES_SHARES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS wechat_sales_shares (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  share_key VARCHAR(80) NOT NULL,
  sales_openid VARCHAR(64) NOT NULL,
  sales_person_id BIGINT NULL,
  expire_at DATETIME NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_share_key (share_key),
  INDEX idx_sales_openid (sales_openid),
  INDEX idx_sales_person_id (sales_person_id),
  INDEX idx_expire_at (expire_at)
)
`;

const CREATE_WECHAT_CUSTOMER_SALES_BINDINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS wechat_customer_sales_bindings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(64) NOT NULL,
  unionid VARCHAR(64) DEFAULT '',
  sales_openid VARCHAR(64) NOT NULL,
  sales_person_id BIGINT NULL,
  share_key VARCHAR(80) NOT NULL,
  bound_at DATETIME NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_openid (openid),
  INDEX idx_sales_openid (sales_openid),
  INDEX idx_sales_person_id (sales_person_id),
  INDEX idx_share_key (share_key)
)
`;

async function tableExists(connection, tableName) {
  const [rows] = await connection.query('SHOW TABLES LIKE ?', [tableName]);
  return Array.isArray(rows) && rows.length > 0;
}

async function renameTableIfNeeded(connection, legacyTableName, nextTableName) {
  const legacyExists = await tableExists(connection, legacyTableName);
  if (!legacyExists) return;

  const nextExists = await tableExists(connection, nextTableName);
  if (nextExists) return;

  await connection.query(`RENAME TABLE \`${legacyTableName}\` TO \`${nextTableName}\``);
}

async function seedBasicSettings(connection) {
  await connection.query(`
    INSERT INTO basic_settings (id, min_house_price, max_house_price, interest_rate, mini_program_access_mode)
    VALUES (1, 0, 150, 3.15, 'strict')
    ON DUPLICATE KEY UPDATE id = id
  `);

  await connection.query(`
    UPDATE basic_settings
    SET interest_rate = 3.15
    WHERE id = 1
      AND min_house_price = 0
      AND max_house_price = 150
      AND interest_rate = 0
  `);
}

async function seedDefaultAdmin(connection) {
  const [rows] = await connection.query('SELECT COUNT(*) AS total FROM system_staff');
  const total = Number(rows?.[0]?.total || 0);
  if (total > 0) return;

  await connection.query(`
    INSERT INTO system_staff (name, phone, role, password_hash, status, remark)
    SELECT 'admin', 'admin', ?, ?, 1, '绯荤粺榛樿绠＄悊鍛橈細admin/123456'
  `, [ROLE_ADMIN, hashPassword(DEFAULT_STAFF_PASSWORD)]);
}


async function normalizeSystemStaffRoles(connection, tableName = SYSTEM_STAFF_TABLE) {
  await connection.query(
    `UPDATE \`${tableName}\`
        SET role = ?
      WHERE role = 'admin'`,
    [ROLE_ADMIN]
  );

  await connection.query(
    `UPDATE \`${tableName}\`
        SET role = ?
      WHERE role = 'sales'`,
    [ROLE_SALES]
  );

  await connection.query(
    `UPDATE \`${tableName}\`
        SET role = CASE
          WHEN name = 'admin' OR role = ? THEN ?
          WHEN role IN (?, ?, ?) THEN role
          ELSE ?
        END
      WHERE role NOT IN (?, ?, ?, ?)`,
    [
      ROLE_ADMIN,
      ROLE_ADMIN,
      ROLE_REVIEWER,
      ROLE_UPLOADER,
      ROLE_SALES,
      ROLE_SALES,
      ROLE_ADMIN,
      ROLE_REVIEWER,
      ROLE_UPLOADER,
      ROLE_SALES,
    ]
  );
}

async function synchronizeErshouDetailSchema(connection) {
  const exists = await tableExists(connection, 'bk_ershou_details');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `bk_ershou_details`');
  const [indexes] = await connection.query('SHOW INDEX FROM `bk_ershou_details`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  const alters = [];

  if (indexNames.has('idx_item_index')) alters.push('DROP INDEX `idx_item_index`');
  if (columnNames.has('source_file')) alters.push('DROP COLUMN `source_file`');
  if (columnNames.has('item_index')) alters.push('DROP COLUMN `item_index`');
  if (columnNames.has('raw_json')) alters.push('DROP COLUMN `raw_json`');

  if (!columnNames.has('details_imgs')) {
    alters.push('ADD COLUMN `details_imgs` JSON NULL AFTER `m_url`');
  }

  const detailColumnDefinitions = [
    ['property_type', 'VARCHAR(64) NULL', 'floor_state'],
    ['build_year', 'VARCHAR(64) NULL', 'property_type'],
    ['house_use', 'VARCHAR(64) NULL', 'build_year'],
    ['building_type', 'VARCHAR(64) NULL', 'house_use'],
    ['orientation_text', 'VARCHAR(64) NULL', 'building_type'],
    ['has_elevator_text', 'VARCHAR(64) NULL', 'orientation_text'],
  ];

  for (const [columnName, definition, afterColumn] of detailColumnDefinitions) {
    if (!columnNames.has(columnName)) {
      alters.push(`ADD COLUMN \`${columnName}\` ${definition} AFTER \`${afterColumn}\``);
      columnNames.add(columnName);
    }
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`bk_ershou_details\` ${alters.join(', ')}`);
  }
}


async function synchronizeBasicSettingsSchema(connection) {
  const [columns] = await connection.query('SHOW COLUMNS FROM `basic_settings`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('min_house_price')) {
    alters.push('ADD COLUMN `min_house_price` DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER `id`');
  }

  if (!columnNames.has('max_house_price')) {
    alters.push('ADD COLUMN `max_house_price` DECIMAL(12, 2) NOT NULL DEFAULT 150 AFTER `min_house_price`');
  }

  if (!columnNames.has('fapai_intro')) {
    alters.push('ADD COLUMN `fapai_intro` TEXT NULL AFTER `interest_rate`');
  }

  if (!columnNames.has('low_down_payment_intro')) {
    alters.push('ADD COLUMN `low_down_payment_intro` TEXT NULL AFTER `fapai_intro`');
  }

  if (!columnNames.has('mini_program_access_mode')) {
    alters.push("ADD COLUMN `mini_program_access_mode` VARCHAR(16) NOT NULL DEFAULT 'strict' AFTER `low_down_payment_intro`");
  }

  if (columnNames.has('house_price')) {
    alters.push('DROP COLUMN `house_price`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`basic_settings\` ${alters.join(', ')}`);
  }

  await connection.query(`
    ALTER TABLE \`basic_settings\`
    MODIFY COLUMN \`interest_rate\` DECIMAL(6, 2) NOT NULL DEFAULT 3.15
  `);
}

async function synchronizeSpecialAssetsSchema(connection) {
  const [columns] = await connection.query('SHOW COLUMNS FROM `special_assets`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('contact_name')) {
    alters.push('ADD COLUMN `contact_name` VARCHAR(80) DEFAULT \'\' AFTER `floor_state`');
  }

  if (!columnNames.has('contact_phone')) {
    alters.push('ADD COLUMN `contact_phone` VARCHAR(40) DEFAULT \'\' AFTER `contact_name`');
  }

  if (!columnNames.has('remark')) {
    alters.push('ADD COLUMN `remark` VARCHAR(255) DEFAULT \'\' AFTER `status`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`special_assets\` ${alters.join(', ')}`);
  }
}

async function synchronizeSystemStaffSchema(connection, tableName = SYSTEM_STAFF_TABLE) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
  const [indexes] = await connection.query(`SHOW INDEX FROM \`${tableName}\``);
  const columnNames = new Set(columns.map((column) => column.Field));
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  const alters = [];
  const wechatOpenidIndexName = `idx_${tableName}_wechat_openid`;

  if (!columnNames.has('wechat_openid')) {
    alters.push('ADD COLUMN `wechat_openid` VARCHAR(64) DEFAULT \'\' AFTER `phone`');
  }

  if (!columnNames.has('password_hash')) {
    alters.push('ADD COLUMN `password_hash` VARCHAR(128) NOT NULL DEFAULT \'\' AFTER `role`');
  }

  if (!columnNames.has('wechat_unionid')) {
    alters.push('ADD COLUMN `wechat_unionid` VARCHAR(64) DEFAULT \'\' AFTER `wechat_openid`');
  }

  if (!columnNames.has('wechat_bound_at')) {
    alters.push('ADD COLUMN `wechat_bound_at` DATETIME NULL AFTER `wechat_unionid`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`${tableName}\` ${alters.join(', ')}`);
  }

  await connection.query(
    `UPDATE \`${tableName}\`
        SET password_hash = ?
      WHERE password_hash IS NULL OR password_hash = ''`,
    [hashPassword(DEFAULT_STAFF_PASSWORD)]
  );

  if (columnNames.has('staff_type')) {
    await connection.query(`
      UPDATE \`${tableName}\`
      SET role = CASE
        WHEN staff_type = 'manager' THEN 'admin'
        WHEN staff_type = 'sales' THEN 'sales'
        ELSE role
      END
      WHERE role NOT IN ('admin', 'reviewer', 'uploader', 'sales')
    `);

    await connection.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`staff_type\``);
  }

  await connection.query(`
    UPDATE \`${tableName}\`
    SET role = 'admin'
    WHERE role = 'admin'
  `);

  await connection.query(`
    UPDATE \`${tableName}\`
    SET role = CASE
      WHEN name = 'admin' OR role = 'admin' THEN 'admin'
      WHEN role IN ('reviewer', 'uploader', 'sales') THEN role
      ELSE 'sales'
    END
    WHERE role NOT IN ('admin', 'reviewer', 'uploader', 'sales')
  `);

  if (!indexNames.has(wechatOpenidIndexName)) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${wechatOpenidIndexName}\` (\`wechat_openid\`)`);
  }
}

async function synchronizeApprovalTasksSchema(connection) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM \`${APPROVAL_TASKS_TABLE}\``);
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('review_note')) {
    alters.push('ADD COLUMN `review_note` VARCHAR(255) DEFAULT \'\' AFTER `reviewed_by_name`');
  }

  if (!columnNames.has('reviewed_at')) {
    alters.push('ADD COLUMN `reviewed_at` DATETIME NULL AFTER `updated_at`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`${APPROVAL_TASKS_TABLE}\` ${alters.join(', ')}`);
  }
}

async function synchronizeMapDistrictSchema(connection) {
  const exists = await tableExists(connection, 'bk_map_district_bubbles');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `bk_map_district_bubbles`');
  const [indexes] = await connection.query('SHOW INDEX FROM `bk_map_district_bubbles`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  const alters = [];

  if (indexNames.has('uniq_capture_district')) alters.push('DROP INDEX `uniq_capture_district`');
  if (indexNames.has('idx_district_id')) alters.push('DROP INDEX `idx_district_id`');

  [
    'source_file',
    'request_url',
    'req_id',
    'uniq_id',
    'errno',
    'errmsg',
    'cost',
    'city_id',
    'data_source',
    'condition_text',
    'group_type',
    'max_latitude',
    'min_latitude',
    'max_longitude',
    'min_longitude',
    'visible_count',
    'total_count',
    'hide_count',
    'top_rich_text',
    'item_index',
    'district_id',
    'house_count',
    'count_str',
    'image_type',
    'hide_house_count',
    'raw_json',
  ].forEach((columnName) => {
    if (columnNames.has(columnName)) {
      alters.push(`DROP COLUMN \`${columnName}\``);
    }
  });

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`bk_map_district_bubbles\` ${alters.join(', ')}`);
  }
}

async function synchronizeMapTreeSchema(connection) {
  const exists = await tableExists(connection, 'bk_map_bubbles');
  if (!exists) return;

  const [bubbleIndexes] = await connection.query('SHOW INDEX FROM `bk_map_bubbles`');
  const bubbleIndexNames = new Set(bubbleIndexes.map((index) => index.Key_name));
  const bubbleAlters = [];

  if (bubbleIndexNames.has('uniq_map_bubble')) {
    bubbleAlters.push('DROP INDEX `uniq_map_bubble`');
  }

  if (!bubbleIndexNames.has('uniq_map_bubble_parent')) {
    bubbleAlters.push('ADD UNIQUE KEY `uniq_map_bubble_parent` (`capture_date`, `group_type`, `parent_id`, `bubble_id`)');
  }

  if (bubbleAlters.length > 0) {
    await connection.query(`ALTER TABLE \`bk_map_bubbles\` ${bubbleAlters.join(', ')}`);
  }
}

async function synchronizeMapHouseSchema(connection) {
  const exists = await tableExists(connection, 'bk_map_house_cards');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `bk_map_house_cards`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('new_cover_pic')) {
    alters.push('ADD COLUMN `new_cover_pic` LONGTEXT NULL AFTER `cover_pic`');
  }

  if (!columnNames.has('district_name')) {
    alters.push('ADD COLUMN `district_name` VARCHAR(255) NULL AFTER `capture_date`');
  }

  if (!columnNames.has('is_deleted')) {
    alters.push('ADD COLUMN `is_deleted` TINYINT(1) NOT NULL DEFAULT 0 AFTER `has_more`');
  }

  if (!columnNames.has('deleted_at')) {
    alters.push('ADD COLUMN `deleted_at` DATETIME NULL AFTER `is_deleted`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`bk_map_house_cards\` ${alters.join(', ')}`);
  }

  const [indexes] = await connection.query('SHOW INDEX FROM `bk_map_house_cards`');
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  if (!indexNames.has('idx_is_deleted')) {
    await connection.query('ALTER TABLE `bk_map_house_cards` ADD INDEX `idx_is_deleted` (`is_deleted`)');
  }
  if (!indexNames.has('idx_map_house_district_name')) {
    await connection.query('ALTER TABLE `bk_map_house_cards` ADD INDEX `idx_map_house_district_name` (`district_name`)');
  }
}

async function synchronizeDjlHouseDetailSchema(connection) {
  const exists = await tableExists(connection, 'djl_esf_house_detail');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `djl_esf_house_detail`');
  const [indexes] = await connection.query('SHOW INDEX FROM `djl_esf_house_detail`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  const alters = [];

  if (!columnNames.has('manual_cover_image_url')) {
    alters.push('ADD COLUMN `manual_cover_image_url` LONGTEXT NULL AFTER `cover_image_url`');
  }

  if (!columnNames.has('manual_cover_removed')) {
    alters.push('ADD COLUMN `manual_cover_removed` TINYINT(1) NOT NULL DEFAULT 0 AFTER `manual_cover_image_url`');
  }

  if (!columnNames.has('manual_gallery_images_json')) {
    alters.push('ADD COLUMN `manual_gallery_images_json` JSON NULL AFTER `image_urls_json`');
  }

  if (!columnNames.has('source_up_time')) {
    alters.push('ADD COLUMN `source_up_time` DATETIME NULL AFTER `manual_gallery_images_json`');
  }

  if (!columnNames.has('is_deleted')) {
    alters.push('ADD COLUMN `is_deleted` TINYINT(1) NOT NULL DEFAULT 0 AFTER `source_up_time`');
  }

  if (!columnNames.has('deleted_at')) {
    alters.push('ADD COLUMN `deleted_at` DATETIME NULL AFTER `is_deleted`');
  }

  if (!columnNames.has('delete_reason')) {
    alters.push("ADD COLUMN `delete_reason` VARCHAR(255) DEFAULT '' AFTER `deleted_at`");
  }

  const createdAtColumn = columns.find((column) => column.Field === 'created_at');
  if (createdAtColumn) {
    const createdAtType = String(createdAtColumn.Type || '').toLowerCase();
    const createdAtNullable = String(createdAtColumn.Null || '').toUpperCase() === 'YES';
    const createdAtDefault = createdAtColumn.Default;
    const needsCreatedAtAlter = createdAtType === 'timestamp'
      && (!createdAtNullable || createdAtDefault !== null);
    if (needsCreatedAtAlter) {
      alters.push('MODIFY COLUMN `created_at` TIMESTAMP NULL DEFAULT NULL');
    }
  }

  [
    'community_url',
    'inner_area_sqm',
    'viewing_time',
    'status_text',
    'attention_count',
    'main_agent_name',
    'main_agent_phone',
    'video_url',
    'image_titles_json',
    'sale_info_json',
    'detail_html',
    'source_updated_hint',
  ].forEach((columnName) => {
    if (columnNames.has(columnName)) {
      alters.push(`DROP COLUMN \`${columnName}\``);
    }
  });

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`djl_esf_house_detail\` ${alters.join(', ')}`);
  }

  if (!indexNames.has('idx_djl_house_is_deleted')) {
    await connection.query('ALTER TABLE `djl_esf_house_detail` ADD INDEX `idx_djl_house_is_deleted` (`is_deleted`)');
  }
  if (!indexNames.has('idx_djl_house_list_sort')) {
    await connection.query(
      'ALTER TABLE `djl_esf_house_detail` ADD INDEX `idx_djl_house_list_sort` (`is_deleted`, `area_name`, `sub_area_name`, `community_name`, `id`)'
    );
  }
  if (!indexNames.has('idx_djl_house_area_sort')) {
    await connection.query(
      'ALTER TABLE `djl_esf_house_detail` ADD INDEX `idx_djl_house_area_sort` (`is_deleted`, `area_code`, `sub_area_name`, `community_name`, `id`)'
    );
  }
  if (!indexNames.has('idx_djl_house_list_sort_desc')) {
    await connection.query(
      'ALTER TABLE `djl_esf_house_detail` ADD INDEX `idx_djl_house_list_sort_desc` (`is_deleted`, `area_name`, `sub_area_name`, `community_name`, `id` DESC)'
    );
  }
  if (!indexNames.has('idx_djl_house_area_sort_desc')) {
    await connection.query(
      'ALTER TABLE `djl_esf_house_detail` ADD INDEX `idx_djl_house_area_sort_desc` (`is_deleted`, `area_code`, `sub_area_name`, `community_name`, `id` DESC)'
    );
  }
}

async function synchronizeDjlDeletedHousesSchema(connection) {
  const exists = await tableExists(connection, 'djl_deleted_houses');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `djl_deleted_houses`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('source_house_id')) {
    alters.push('ADD COLUMN `source_house_id` BIGINT NULL AFTER `listing_id`');
  }
  if (!columnNames.has('community_id')) {
    alters.push("ADD COLUMN `community_id` VARCHAR(64) DEFAULT '' AFTER `source_house_id`");
  }
  if (!columnNames.has('title')) {
    alters.push("ADD COLUMN `title` VARCHAR(255) DEFAULT '' AFTER `community_id`");
  }
  if (!columnNames.has('area_code')) {
    alters.push("ADD COLUMN `area_code` VARCHAR(32) DEFAULT '' AFTER `title`");
  }
  if (!columnNames.has('area_name')) {
    alters.push("ADD COLUMN `area_name` VARCHAR(64) DEFAULT '' AFTER `area_code`");
  }
  if (!columnNames.has('sub_area_name')) {
    alters.push("ADD COLUMN `sub_area_name` VARCHAR(128) DEFAULT '' AFTER `area_name`");
  }
  if (!columnNames.has('deleted_by_staff_id')) {
    alters.push('ADD COLUMN `deleted_by_staff_id` BIGINT NULL AFTER `sub_area_name`');
  }
  if (!columnNames.has('deleted_by_name')) {
    alters.push("ADD COLUMN `deleted_by_name` VARCHAR(64) DEFAULT '' AFTER `deleted_by_staff_id`");
  }
  if (!columnNames.has('delete_source')) {
    alters.push("ADD COLUMN `delete_source` VARCHAR(32) NOT NULL DEFAULT 'manual_admin_delete' AFTER `deleted_by_name`");
  }
  if (!columnNames.has('remark')) {
    alters.push("ADD COLUMN `remark` VARCHAR(255) DEFAULT '' AFTER `delete_source`");
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`djl_deleted_houses\` ${alters.join(', ')}`);
  }
}

async function synchronizeDjlSubAreaSchema(connection) {
  const exists = await tableExists(connection, 'djl_sub_area_map_rel');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `djl_sub_area_map_rel`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('community_count')) {
    alters.push('ADD COLUMN `community_count` INT NOT NULL DEFAULT 0 AFTER `latitude_bd09`');
  }

  if (!columnNames.has('house_count')) {
    alters.push('ADD COLUMN `house_count` INT NOT NULL DEFAULT 0 AFTER `community_count`');
  }

  if (!columnNames.has('source')) {
    alters.push("ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'community_avg' AFTER `house_count`");
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`djl_sub_area_map_rel\` ${alters.join(', ')}`);
  }
}

async function synchronizeDjlSyncTaskSchema(connection) {
  const exists = await tableExists(connection, 'djl_sync_tasks');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `djl_sync_tasks`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('task_type')) {
    alters.push("ADD COLUMN `task_type` VARCHAR(32) NOT NULL DEFAULT 'full_sync' AFTER `id`");
  }

  if (!columnNames.has('summary')) {
    alters.push('ADD COLUMN `summary` JSON NULL AFTER `trigger_by_name`');
  }

  if (!columnNames.has('error_message')) {
    alters.push('ADD COLUMN `error_message` TEXT NULL AFTER `summary`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`djl_sync_tasks\` ${alters.join(', ')}`);
  }
}

async function synchronizeDjlMapDistrictSchema(connection) {
  const exists = await tableExists(connection, 'djl_map_district_rel');
  if (!exists) return;

  const [columns] = await connection.query('SHOW COLUMNS FROM `djl_map_district_rel`');
  const columnNames = new Set(columns.map((column) => column.Field));
  const alters = [];

  if (!columnNames.has('area_id')) {
    alters.push("ADD COLUMN `area_id` VARCHAR(32) NOT NULL DEFAULT '' AFTER `area_code`");
  }

  if (!columnNames.has('display_name')) {
    alters.push("ADD COLUMN `display_name` VARCHAR(64) DEFAULT '' AFTER `area_name`");
  }

  if (!columnNames.has('community_count')) {
    alters.push('ADD COLUMN `community_count` INT NOT NULL DEFAULT 0 AFTER `rent_count`');
  }

  if (!columnNames.has('avg_price_text')) {
    alters.push("ADD COLUMN `avg_price_text` VARCHAR(64) DEFAULT '' AFTER `community_count`");
  }

  if (!columnNames.has('raw_json')) {
    alters.push('ADD COLUMN `raw_json` JSON NULL AFTER `latitude_bd09`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`djl_map_district_rel\` ${alters.join(', ')}`);
  }
}

async function synchronizeWechatUsersSchema(connection, tableName = WECHAT_USERS_TABLE) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
  const [indexes] = await connection.query(`SHOW INDEX FROM \`${tableName}\``);
  const columnNames = new Set(columns.map((column) => column.Field));
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  const alters = [];

  if (!columnNames.has('openid')) {
    alters.push('ADD COLUMN `openid` VARCHAR(64) NOT NULL AFTER `id`');
  }
  if (!columnNames.has('unionid')) {
    alters.push('ADD COLUMN `unionid` VARCHAR(64) DEFAULT \'\' AFTER `openid`');
  }
  if (!columnNames.has('sales_openid')) {
    alters.push('ADD COLUMN `sales_openid` VARCHAR(64) DEFAULT \'\' AFTER `unionid`');
  }
  if (!columnNames.has('sales_person_id')) {
    alters.push('ADD COLUMN `sales_person_id` BIGINT NULL AFTER `sales_openid`');
  }
  if (!columnNames.has('bound_at')) {
    alters.push('ADD COLUMN `bound_at` DATETIME NULL AFTER `sales_person_id`');
  }
  if (!columnNames.has('authorized_until')) {
    alters.push('ADD COLUMN `authorized_until` DATETIME NULL AFTER `bound_at`');
  }
  if (!columnNames.has('last_login_at')) {
    alters.push('ADD COLUMN `last_login_at` DATETIME NULL AFTER `authorized_until`');
  }
  if (!columnNames.has('raw_json')) {
    alters.push('ADD COLUMN `raw_json` JSON NULL AFTER `last_login_at`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`${tableName}\` ${alters.join(', ')}`);
  }

  if (!indexNames.has('uniq_openid')) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD UNIQUE KEY \`uniq_openid\` (\`openid\`)`);
  }
  if (!indexNames.has('idx_sales_openid')) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`idx_sales_openid\` (\`sales_openid\`)`);
  }
  if (!indexNames.has('idx_sales_person_id')) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`idx_sales_person_id\` (\`sales_person_id\`)`);
  }
  if (!indexNames.has('idx_authorized_until')) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`idx_authorized_until\` (\`authorized_until\`)`);
  }
  if (!indexNames.has('idx_last_login_at')) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`idx_last_login_at\` (\`last_login_at\`)`);
  }
}

async function synchronizeWechatSalesSharesSchema(connection) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM \`${WECHAT_SALES_SHARES_TABLE}\``);
  const [indexes] = await connection.query(`SHOW INDEX FROM \`${WECHAT_SALES_SHARES_TABLE}\``);
  const columnNames = new Set(columns.map((column) => column.Field));
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  const alters = [];

  if (!columnNames.has('share_key')) {
    alters.push('ADD COLUMN `share_key` VARCHAR(80) NOT NULL AFTER `id`');
  }
  if (!columnNames.has('sales_openid')) {
    alters.push('ADD COLUMN `sales_openid` VARCHAR(64) NOT NULL AFTER `share_key`');
  }
  if (!columnNames.has('sales_person_id')) {
    alters.push('ADD COLUMN `sales_person_id` BIGINT NULL AFTER `sales_openid`');
  }
  if (!columnNames.has('expire_at')) {
    alters.push('ADD COLUMN `expire_at` DATETIME NOT NULL AFTER `sales_person_id`');
  }
  if (!columnNames.has('status')) {
    alters.push('ADD COLUMN `status` TINYINT NOT NULL DEFAULT 1 AFTER `expire_at`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`${WECHAT_SALES_SHARES_TABLE}\` ${alters.join(', ')}`);
  }

  if (!indexNames.has('uniq_share_key')) {
    await connection.query(`ALTER TABLE \`${WECHAT_SALES_SHARES_TABLE}\` ADD UNIQUE KEY \`uniq_share_key\` (\`share_key\`)`);
  }
  if (!indexNames.has('idx_sales_openid')) {
    await connection.query(`ALTER TABLE \`${WECHAT_SALES_SHARES_TABLE}\` ADD INDEX \`idx_sales_openid\` (\`sales_openid\`)`);
  }
  if (!indexNames.has('idx_sales_person_id')) {
    await connection.query(`ALTER TABLE \`${WECHAT_SALES_SHARES_TABLE}\` ADD INDEX \`idx_sales_person_id\` (\`sales_person_id\`)`);
  }
  if (!indexNames.has('idx_expire_at')) {
    await connection.query(`ALTER TABLE \`${WECHAT_SALES_SHARES_TABLE}\` ADD INDEX \`idx_expire_at\` (\`expire_at\`)`);
  }
}

async function synchronizeWechatCustomerSalesBindingsSchema(connection) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM \`${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}\``);
  const [indexes] = await connection.query(`SHOW INDEX FROM \`${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}\``);
  const columnNames = new Set(columns.map((column) => column.Field));
  const indexNames = new Set(indexes.map((index) => index.Key_name));
  const alters = [];

  if (!columnNames.has('openid')) {
    alters.push('ADD COLUMN `openid` VARCHAR(64) NOT NULL AFTER `id`');
  }
  if (!columnNames.has('unionid')) {
    alters.push('ADD COLUMN `unionid` VARCHAR(64) DEFAULT \'\' AFTER `openid`');
  }
  if (!columnNames.has('sales_openid')) {
    alters.push('ADD COLUMN `sales_openid` VARCHAR(64) NOT NULL AFTER `unionid`');
  }
  if (!columnNames.has('sales_person_id')) {
    alters.push('ADD COLUMN `sales_person_id` BIGINT NULL AFTER `sales_openid`');
  }
  if (!columnNames.has('share_key')) {
    alters.push('ADD COLUMN `share_key` VARCHAR(80) NOT NULL AFTER `sales_person_id`');
  }
  if (!columnNames.has('bound_at')) {
    alters.push('ADD COLUMN `bound_at` DATETIME NULL AFTER `share_key`');
  }
  if (!columnNames.has('raw_json')) {
    alters.push('ADD COLUMN `raw_json` JSON NULL AFTER `bound_at`');
  }

  if (alters.length > 0) {
    await connection.query(`ALTER TABLE \`${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}\` ${alters.join(', ')}`);
  }

  if (!indexNames.has('uniq_openid')) {
    await connection.query(`ALTER TABLE \`${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}\` ADD UNIQUE KEY \`uniq_openid\` (\`openid\`)`);
  }
  if (!indexNames.has('idx_sales_openid')) {
    await connection.query(`ALTER TABLE \`${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}\` ADD INDEX \`idx_sales_openid\` (\`sales_openid\`)`);
  }
  if (!indexNames.has('idx_sales_person_id')) {
    await connection.query(`ALTER TABLE \`${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}\` ADD INDEX \`idx_sales_person_id\` (\`sales_person_id\`)`);
  }
  if (!indexNames.has('idx_share_key')) {
    await connection.query(`ALTER TABLE \`${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}\` ADD INDEX \`idx_share_key\` (\`share_key\`)`);
  }
}

async function mergeLegacySystemStaffTable(connection) {
  const legacyExists = await tableExists(connection, LEGACY_SYSTEM_STAFF_TABLE);
  if (!legacyExists) return;

  await synchronizeSystemStaffSchema(connection, LEGACY_SYSTEM_STAFF_TABLE);
  await connection.query(`
    INSERT INTO system_staff
      (id, name, phone, role, password_hash, wechat_openid, wechat_unionid, wechat_bound_at, status, remark, created_at, updated_at)
    SELECT
      id,
      name,
      phone,
      role,
      COALESCE(password_hash, ?),
      COALESCE(wechat_openid, ''),
      COALESCE(wechat_unionid, ''),
      wechat_bound_at,
      COALESCE(status, 1),
      COALESCE(remark, ''),
      created_at,
      updated_at
    FROM people
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      phone = VALUES(phone),
      role = VALUES(role),
      password_hash = VALUES(password_hash),
      wechat_openid = VALUES(wechat_openid),
      wechat_unionid = VALUES(wechat_unionid),
      wechat_bound_at = VALUES(wechat_bound_at),
      status = VALUES(status),
      remark = VALUES(remark),
      updated_at = VALUES(updated_at)
  `, [hashPassword(DEFAULT_STAFF_PASSWORD)]);
  await connection.query('DROP TABLE `people`');
}

async function mergeLegacyWechatUsersTable(connection) {
  const legacyExists = await tableExists(connection, LEGACY_WECHAT_USERS_TABLE);
  if (!legacyExists) return;

  await synchronizeWechatUsersSchema(connection, LEGACY_WECHAT_USERS_TABLE);
  await connection.query(`
    INSERT INTO wechat_users
      (id, openid, unionid, sales_openid, sales_person_id, bound_at, authorized_until, last_login_at, raw_json, created_at, updated_at)
    SELECT
      id,
      openid,
      COALESCE(unionid, ''),
      COALESCE(sales_openid, ''),
      sales_person_id,
      bound_at,
      authorized_until,
      last_login_at,
      raw_json,
      created_at,
      updated_at
    FROM wechat_phone_auths
    WHERE openid IS NOT NULL
      AND openid <> ''
    ON DUPLICATE KEY UPDATE
      unionid = VALUES(unionid),
      sales_openid = VALUES(sales_openid),
      sales_person_id = VALUES(sales_person_id),
      bound_at = VALUES(bound_at),
      authorized_until = VALUES(authorized_until),
      last_login_at = VALUES(last_login_at),
      raw_json = VALUES(raw_json),
      updated_at = VALUES(updated_at)
  `);
  await connection.query('DROP TABLE `wechat_phone_auths`');
}

async function migrateWechatOpenidBindingsToWechatUsers(connection) {
  const legacyExists = await tableExists(connection, LEGACY_WECHAT_BINDINGS_TABLE);
  if (!legacyExists) return;

  await connection.query(`
    INSERT INTO wechat_users
      (openid, unionid, sales_openid, sales_person_id, bound_at, authorized_until, last_login_at, raw_json)
    SELECT
      b.openid,
      COALESCE(b.unionid, ''),
      COALESCE(b.sales_openid, ''),
      b.sales_person_id,
      b.bound_at,
      DATE_ADD(b.bound_at, INTERVAL 7 DAY),
      COALESCE(b.bound_at, NOW()),
      b.raw_json
    FROM wechat_openid_bindings b
    WHERE b.openid IS NOT NULL
      AND b.openid <> ''
    ON DUPLICATE KEY UPDATE
      unionid = VALUES(unionid),
      sales_openid = VALUES(sales_openid),
      sales_person_id = VALUES(sales_person_id),
      bound_at = VALUES(bound_at),
      authorized_until = VALUES(authorized_until),
      last_login_at = VALUES(last_login_at),
      raw_json = VALUES(raw_json)
  `);

  await connection.query('DROP TABLE `wechat_openid_bindings`');
}

async function initializeApplicationSchema(connection) {
  await renameTableIfNeeded(connection, LEGACY_SYSTEM_STAFF_TABLE, SYSTEM_STAFF_TABLE);
  await renameTableIfNeeded(connection, LEGACY_WECHAT_USERS_TABLE, WECHAT_USERS_TABLE);
  await connection.query(CREATE_SYSTEM_STAFF_TABLE_SQL);
  await connection.query(CREATE_APPROVAL_TASKS_TABLE_SQL);
  await connection.query(CREATE_BASIC_SETTINGS_TABLE_SQL);
  await connection.query(CREATE_SPECIAL_ASSETS_TABLE_SQL);
  await connection.query(CREATE_WECHAT_USERS_TABLE_SQL);
  await connection.query(CREATE_WECHAT_SALES_SHARES_TABLE_SQL);
  await connection.query(CREATE_WECHAT_CUSTOMER_SALES_BINDINGS_TABLE_SQL);
  await connection.query(CREATE_DJL_DELETED_HOUSES_TABLE_SQL);
  await connection.query(CREATE_DJL_SUB_AREA_TABLE_SQL);
  await connection.query(CREATE_DJL_SYNC_TASK_TABLE_SQL);
  await connection.query(CREATE_DJL_MAP_DISTRICT_TABLE_SQL);
  await synchronizeBasicSettingsSchema(connection);
  await synchronizeSpecialAssetsSchema(connection);
  await synchronizeSystemStaffSchema(connection);
  await normalizeSystemStaffRoles(connection);
  await synchronizeApprovalTasksSchema(connection);
  await synchronizeErshouDetailSchema(connection);
  await synchronizeMapDistrictSchema(connection);
  await synchronizeMapTreeSchema(connection);
  await synchronizeMapHouseSchema(connection);
  await synchronizeDjlHouseDetailSchema(connection);
  await synchronizeDjlDeletedHousesSchema(connection);
  await synchronizeDjlSubAreaSchema(connection);
  await synchronizeDjlSyncTaskSchema(connection);
  await synchronizeDjlMapDistrictSchema(connection);
  await synchronizeWechatUsersSchema(connection);
  await synchronizeWechatSalesSharesSchema(connection);
  await synchronizeWechatCustomerSalesBindingsSchema(connection);
  await mergeLegacySystemStaffTable(connection);
  await mergeLegacyWechatUsersTable(connection);
  await migrateWechatOpenidBindingsToWechatUsers(connection);
  await seedDefaultAdmin(connection);
  await seedBasicSettings(connection);
}

module.exports = {
  initializeApplicationSchema,
};


