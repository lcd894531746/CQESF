CREATE DATABASE IF NOT EXISTS `cq_house` DEFAULT CHARACTER SET utf8mb4;
USE `cq_house`;

CREATE TABLE IF NOT EXISTS people (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  role VARCHAR(50) NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  remark VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_phone (phone)
);

CREATE TABLE IF NOT EXISTS basic_settings (
  id TINYINT PRIMARY KEY,
  house_price DECIMAL(12, 2) NOT NULL,
  interest_rate DECIMAL(6, 2) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


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
);

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
);

INSERT INTO basic_settings (id, house_price, interest_rate)
VALUES (1, 0, 0)
ON DUPLICATE KEY UPDATE id = id;

