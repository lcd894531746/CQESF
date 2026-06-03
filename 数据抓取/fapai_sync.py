#!/usr/bin/env python
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import math
import os
import re
import ssl
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    import pymysql
except ModuleNotFoundError as error:
    if error.name == "pymysql":
        print("Missing dependency: PyMySQL. Run: pip install -r requirements.txt", file=sys.stderr)
        raise SystemExit(1)
    raise


CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent
API_PROJECT_ROOT = REPO_ROOT / "CQ_API"
ENV_PATH = API_PROJECT_ROOT / ".env"

HOUSE_LIST_API = "https://api.ysfp.com.cn/api/house/index/list"
DISTRICT_LIST_API = "https://api.ysfp.com.cn/api/common/area/distList"

DEFAULT_CITY_NAME = "重庆市区"
DEFAULT_HOUSE_TYPE_ID = 2
DEFAULT_PAGE_SIZE = 100
DEFAULT_TABLE_NAME = "fp_house_listings"

SYNC_TASK_TABLE_NAME = "djl_sync_tasks"
TASK_TYPE_FAPAI_SYNC = "fapai_sync"
UNVERIFIED_SSL_CONTEXT = ssl._create_unverified_context()

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541a1b) XWEB/19895",
    "xweb_xhr": "1",
    "Content-Type": "application/x-www-form-urlencoded",
    "token": "",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Referer": "https://servicewechat.com/wx71d736c4bc775ecb/66/page-frame.html",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

AUCTION_MODE_TEXT_MAP = {
    "1": "一拍",
    "2": "二拍",
    "3": "变卖",
}

PROPERTY_TYPE_TEXT_MAP = {
    "1": "住宅",
    "2": "商业",
    "3": "工业",
}

ELEVATOR_TEXT_MAP = {
    "1": "有电梯",
    "2": "无电梯",
    "3": "未知",
}

DECORATION_TEXT_MAP = {
    "1": "简装",
    "2": "中装",
    "3": "精装",
}

STATUS_TEXT_MAP = {
    0: "未起拍",
    1: "竞拍中",
    2: "已成交",
    3: "已流拍",
}

CREATE_TABLE_SQL_TEMPLATE = """
CREATE TABLE IF NOT EXISTS `{table_name}` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT NOT NULL,
  city_name VARCHAR(64) NOT NULL DEFAULT '',
  district_id BIGINT NULL,
  district_area_code VARCHAR(32) NOT NULL DEFAULT '',
  district_whole_name VARCHAR(128) NOT NULL DEFAULT '',
  community_id BIGINT NULL,
  community_name VARCHAR(255) NOT NULL DEFAULT '',
  plate_name VARCHAR(255) NOT NULL DEFAULT '',
  title VARCHAR(255) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',
  detail_address VARCHAR(500) NOT NULL DEFAULT '',
  location VARCHAR(64) NOT NULL DEFAULT '',
  longitude DECIMAL(12, 8) NULL,
  latitude DECIMAL(12, 8) NULL,
  jump_link VARCHAR(500) NOT NULL DEFAULT '',
  platform VARCHAR(64) NOT NULL DEFAULT '',
  property_type_code VARCHAR(32) NOT NULL DEFAULT '',
  property_type_text VARCHAR(64) NOT NULL DEFAULT '',
  auction_mode_code VARCHAR(32) NOT NULL DEFAULT '',
  auction_mode_text VARCHAR(64) NOT NULL DEFAULT '',
  auction_status_code INT NULL,
  auction_status_text VARCHAR(64) NOT NULL DEFAULT '',
  auction_time DATETIME NULL,
  auction_end_time DATETIME NULL,
  auction_date DATE NULL,
  auction_end_date DATE NULL,
  build_year VARCHAR(32) NOT NULL DEFAULT '',
  build_year_group VARCHAR(32) NOT NULL DEFAULT '',
  floor_level VARCHAR(64) NOT NULL DEFAULT '',
  elevator_code VARCHAR(32) NOT NULL DEFAULT '',
  elevator_text VARCHAR(32) NOT NULL DEFAULT '',
  decoration_code VARCHAR(32) NOT NULL DEFAULT '',
  decoration_text VARCHAR(32) NOT NULL DEFAULT '',
  layout VARCHAR(64) NOT NULL DEFAULT '',
  room_count INT NULL,
  hall_count INT NULL,
  bath_count INT NULL,
  orientation VARCHAR(64) NOT NULL DEFAULT '',
  area DECIMAL(12, 2) NULL,
  area_group VARCHAR(32) NOT NULL DEFAULT '',
  starting_price DECIMAL(12, 2) NULL,
  market_price DECIMAL(12, 2) NULL,
  price_diff DECIMAL(12, 2) NULL,
  discount_rate DECIMAL(8, 4) NULL,
  discount_rate_percent DECIMAL(8, 2) NULL,
  bargain_space DECIMAL(12, 2) NULL,
  bargain_space_percent DECIMAL(8, 2) NULL,
  guarantee_amount DECIMAL(12, 2) NULL,
  markup_price DECIMAL(12, 2) NULL,
  starting_unit_price DECIMAL(12, 2) NULL,
  market_unit_price DECIMAL(12, 2) NULL,
  transaction_price DECIMAL(12, 2) NULL,
  handle_price DECIMAL(12, 2) NULL,
  handle_unit_price DECIMAL(12, 2) NULL,
  loan_amount DECIMAL(12, 2) NULL,
  first_pay_rate DECIMAL(8, 4) NULL,
  rate DECIMAL(8, 4) NULL,
  start_aver_price DECIMAL(12, 2) NULL,
  market_aver_price DECIMAL(12, 2) NULL,
  auction_count INT NULL,
  file_list TEXT NULL,
  house_tags VARCHAR(500) NOT NULL DEFAULT '',
  data_process_memo VARCHAR(255) NOT NULL DEFAULT '',
  end_date VARCHAR(64) NOT NULL DEFAULT '',
  report_create_time DATETIME NULL,
  create_time DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_source_id (source_id),
  KEY idx_city_name (city_name),
  KEY idx_community_id (community_id),
  KEY idx_auction_time (auction_time),
  KEY idx_auction_date (auction_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

CREATE_SYNC_TASK_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS `{SYNC_TASK_TABLE_NAME}` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

DROP_COLUMNS = [
    "district_name",
    "house_type_id",
    "house_type_name",
    "house_use_type",
    "raw_json",
    "updated_at",
    "last_sync_at",
    "view_flag",
    "has_report_flag",
    "is_update",
    "is_care_community",
    "is_collected",
    "is_set_district",
    "is_show",
    "is_finish",
    "house_tags_json",
    "update_time",
]

DROP_INDEXES = [
    "idx_district_name",
    "idx_update_time",
]

INSERT_COLUMNS = [
    "source_id",
    "city_name",
    "district_id",
    "district_area_code",
    "district_whole_name",
    "community_id",
    "community_name",
    "plate_name",
    "title",
    "address",
    "detail_address",
    "location",
    "longitude",
    "latitude",
    "jump_link",
    "platform",
    "property_type_code",
    "property_type_text",
    "auction_mode_code",
    "auction_mode_text",
    "auction_status_code",
    "auction_status_text",
    "auction_time",
    "auction_end_time",
    "auction_date",
    "auction_end_date",
    "build_year",
    "build_year_group",
    "floor_level",
    "elevator_code",
    "elevator_text",
    "decoration_code",
    "decoration_text",
    "layout",
    "room_count",
    "hall_count",
    "bath_count",
    "orientation",
    "area",
    "area_group",
    "starting_price",
    "market_price",
    "price_diff",
    "discount_rate",
    "discount_rate_percent",
    "bargain_space",
    "bargain_space_percent",
    "guarantee_amount",
    "markup_price",
    "starting_unit_price",
    "market_unit_price",
    "transaction_price",
    "handle_price",
    "handle_unit_price",
    "loan_amount",
    "first_pay_rate",
    "rate",
    "start_aver_price",
    "market_aver_price",
    "auction_count",
    "file_list",
    "house_tags",
    "data_process_memo",
    "end_date",
    "report_create_time",
    "create_time",
]


def log(message: str) -> None:
    print(message, flush=True)


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_env_file(env_path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def first_env(env_values: Dict[str, str], *keys: str, default: str = "") -> str:
    for key in keys:
        env_value = os.getenv(key)
        if env_value not in (None, ""):
            return env_value
        file_value = env_values.get(key)
        if file_value not in (None, ""):
            return file_value
    return default


def trim_text(value) -> str:
    return str(value or "").strip()


def to_int(value) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).strip()))
    except Exception:
        return None


def to_float(value) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(str(value).strip())
        return number if math.isfinite(number) else None
    except Exception:
        return None


def normalize_datetime(value) -> Optional[str]:
    text = trim_text(value)
    if not text:
        return None
    text = text.replace("T", " ")
    try:
        dt = datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def normalize_date(value) -> Optional[str]:
    dt = normalize_datetime(value)
    return dt[:10] if dt else None


def parse_location(value) -> Tuple[Optional[float], Optional[float]]:
    text = trim_text(value)
    if not text or "," not in text:
        return None, None
    left, right = text.split(",", 1)
    return to_float(left), to_float(right)


def parse_layout(layout: str) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    text = trim_text(layout)
    if not text:
        return None, None, None
    room_match = re.search(r"(\d+)\s*室", text)
    hall_match = re.search(r"(\d+)\s*厅", text)
    bath_match = re.search(r"(\d+)\s*卫", text)
    return (
        int(room_match.group(1)) if room_match else None,
        int(hall_match.group(1)) if hall_match else None,
        int(bath_match.group(1)) if bath_match else None,
    )


def build_area_group(area: Optional[float]) -> str:
    if area is None:
        return ""
    if area < 60:
        return "60㎡以下"
    if area < 80:
        return "60-79㎡"
    if area < 100:
        return "80-99㎡"
    if area < 120:
        return "100-119㎡"
    if area < 150:
        return "120-149㎡"
    if area < 200:
        return "150-199㎡"
    return "200㎡以上"


def build_year_group(build_year: str) -> str:
    year = to_int(build_year)
    if not year:
        return ""
    if year < 2000:
        return "90年代"
    if year <= 2004:
        return "2000-2004年"
    if year <= 2009:
        return "2005-2009年"
    if year <= 2014:
        return "2010-2014年"
    if year <= 2019:
        return "2015-2019年"
    if year <= 2024:
        return "2020-2024年"
    return "2025年以后"


def build_house_tags(row: dict) -> str:
    tags_list = row.get("houseTagsList")
    if isinstance(tags_list, list):
        normalized = [trim_text(item) for item in tags_list if trim_text(item)]
        return ",".join(normalized)
    return trim_text(row.get("houseTags"))


def guess_status_text(row: dict) -> str:
    status_code = to_int(row.get("status"))
    if status_code in STATUS_TEXT_MAP:
        return STATUS_TEXT_MAP[status_code]
    return ""


def request_json(url: str) -> dict:
    request = Request(url, headers=REQUEST_HEADERS, method="GET")
    with urlopen(request, timeout=30, context=UNVERIFIED_SSL_CONTEXT) as response:
        raw = response.read().decode("utf-8", errors="ignore")
    payload = json.loads(raw)
    if int(payload.get("code") or 0) != 200:
        raise RuntimeError(f"API error: {payload.get('msg') or 'unknown error'}")
    return payload


def fetch_district_map(city_name: str) -> Dict[int, dict]:
    url = f"{DISTRICT_LIST_API}?{urlencode({'cityName': city_name})}"
    payload = request_json(url)
    rows = payload.get("data") or []
    result: Dict[int, dict] = {}
    for row in rows:
        district_id = to_int(row.get("id"))
        if district_id is None:
            continue
        result[district_id] = {
            "district_area_code": trim_text(row.get("areaCode")),
            "district_whole_name": trim_text(row.get("wholeName")),
        }
    return result


def fetch_house_page(page_num: int, page_size: int, city_name: str, house_type_id: int) -> Tuple[int, List[dict]]:
    query = urlencode(
        {
            "pageNum": page_num,
            "pageSize": page_size,
            "cityName": city_name,
            "houseTypeId": house_type_id,
        }
    )
    payload = request_json(f"{HOUSE_LIST_API}?{query}")
    data = payload.get("data") or {}
    total = int(data.get("total") or 0)
    rows = data.get("rows") or []
    return total, rows


def normalize_row(row: dict, city_name: str, district_map: Dict[int, dict]) -> Optional[dict]:
    source_id = to_int(row.get("id"))
    if source_id is None:
        return None

    district_id = to_int(row.get("districtId"))
    district_info = district_map.get(district_id or -1, {})
    longitude, latitude = parse_location(row.get("location"))
    area = to_float(row.get("area"))
    starting_price = to_float(row.get("startingPrice"))
    market_price = to_float(row.get("marketPrice"))
    discount_rate = to_float(row.get("discountRate"))
    price_diff = None
    bargain_space_percent = None

    if starting_price is not None and market_price is not None:
        price_diff = round(market_price - starting_price, 2)
        if market_price:
            bargain_space_percent = round((price_diff / market_price) * 100, 2)

    room_count, hall_count, bath_count = parse_layout(trim_text(row.get("layout")))

    return {
        "source_id": source_id,
        "city_name": city_name,
        "district_id": district_id,
        "district_area_code": trim_text(district_info.get("district_area_code")),
        "district_whole_name": trim_text(district_info.get("district_whole_name")),
        "community_id": to_int(row.get("communityId")),
        "community_name": trim_text(row.get("communityName")),
        "plate_name": trim_text(row.get("plateName")),
        "title": trim_text(row.get("title")),
        "address": trim_text(row.get("address")),
        "detail_address": trim_text(row.get("detailAddress")),
        "location": trim_text(row.get("location")),
        "longitude": longitude,
        "latitude": latitude,
        "jump_link": trim_text(row.get("jumpLink")),
        "platform": trim_text(row.get("platform")),
        "property_type_code": trim_text(row.get("propertyType")),
        "property_type_text": PROPERTY_TYPE_TEXT_MAP.get(trim_text(row.get("propertyType")), ""),
        "auction_mode_code": trim_text(row.get("auctionMode")),
        "auction_mode_text": AUCTION_MODE_TEXT_MAP.get(trim_text(row.get("auctionMode")), ""),
        "auction_status_code": to_int(row.get("status")),
        "auction_status_text": guess_status_text(row),
        "auction_time": normalize_datetime(row.get("auctionTime")),
        "auction_end_time": normalize_datetime(row.get("auctionEndTime")),
        "auction_date": normalize_date(row.get("auctionTime")),
        "auction_end_date": normalize_date(row.get("auctionEndTime")),
        "build_year": trim_text(row.get("buildYear")),
        "build_year_group": build_year_group(trim_text(row.get("buildYear"))),
        "floor_level": trim_text(row.get("floorLevel")),
        "elevator_code": trim_text(row.get("elevator")),
        "elevator_text": ELEVATOR_TEXT_MAP.get(trim_text(row.get("elevator")), ""),
        "decoration_code": trim_text(row.get("decoration")),
        "decoration_text": DECORATION_TEXT_MAP.get(trim_text(row.get("decoration")), ""),
        "layout": trim_text(row.get("layout")),
        "room_count": room_count,
        "hall_count": hall_count,
        "bath_count": bath_count,
        "orientation": trim_text(row.get("orientation")),
        "area": area,
        "area_group": build_area_group(area),
        "starting_price": starting_price,
        "market_price": market_price,
        "price_diff": price_diff,
        "discount_rate": discount_rate,
        "discount_rate_percent": round(discount_rate * 100, 2) if discount_rate is not None else None,
        "bargain_space": price_diff,
        "bargain_space_percent": bargain_space_percent,
        "guarantee_amount": to_float(row.get("guaranteeAmount")),
        "markup_price": to_float(row.get("markupPrice")),
        "starting_unit_price": to_float(row.get("startingUnitPrice")),
        "market_unit_price": to_float(row.get("marketUnitPrice")),
        "transaction_price": to_float(row.get("transactionPrice")),
        "handle_price": to_float(row.get("handlePrice")),
        "handle_unit_price": to_float(row.get("handleUnitPrice")),
        "loan_amount": to_float(row.get("loanAmount")),
        "first_pay_rate": to_float(row.get("firstPayRate")),
        "rate": to_float(row.get("rate")),
        "start_aver_price": to_float(row.get("startAverPrice")),
        "market_aver_price": to_float(row.get("marketAverPrice")),
        "auction_count": to_int(row.get("auctionCount")),
        "file_list": trim_text(row.get("fileList")) or None,
        "house_tags": build_house_tags(row),
        "data_process_memo": trim_text(row.get("dataProcessMemo")),
        "end_date": trim_text(row.get("endDate")),
        "report_create_time": normalize_datetime(row.get("reportCreateTime")),
        "create_time": normalize_datetime(row.get("createTime")),
    }


def connect_db():
    env_values = load_env_file(ENV_PATH)
    return pymysql.connect(
        host=first_env(env_values, "DB_HOST", "MYSQL_HOST", default="152.136.108.55"),
        port=int(first_env(env_values, "DB_PORT", "MYSQL_PORT", default="3306")),
        user=first_env(env_values, "DB_USER", "MYSQL_USER", default="root"),
        password=first_env(env_values, "DB_PASSWORD", "MYSQL_PASSWORD", default=""),
        database=first_env(env_values, "DB_NAME", "MYSQL_DATABASE", default="cq_house"),
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )


def ensure_table(cursor, table_name: str) -> None:
    cursor.execute(CREATE_TABLE_SQL_TEMPLATE.format(table_name=table_name))


def synchronize_table_columns(cursor, table_name: str) -> None:
    cursor.execute(f"SHOW COLUMNS FROM `{table_name}`")
    column_names = {row["Field"] for row in cursor.fetchall()}

    cursor.execute(f"SHOW INDEX FROM `{table_name}`")
    index_names = {row["Key_name"] for row in cursor.fetchall()}

    alter_items = []
    for index_name in DROP_INDEXES:
        if index_name in index_names:
            alter_items.append(f"DROP INDEX `{index_name}`")
    for column_name in DROP_COLUMNS:
        if column_name in column_names:
            alter_items.append(f"DROP COLUMN `{column_name}`")

    if alter_items:
        cursor.execute(f"ALTER TABLE `{table_name}` {', '.join(alter_items)}")


def ensure_sync_task_table(cursor) -> None:
    cursor.execute(CREATE_SYNC_TASK_TABLE_SQL)


def chunked(items: Sequence[Sequence], size: int) -> List[Sequence[Sequence]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def build_insert_sql(table_name: str) -> str:
    column_sql = ", ".join(f"`{column}`" for column in INSERT_COLUMNS)
    placeholder_sql = ", ".join(["%s"] * len(INSERT_COLUMNS))
    update_sql = ", ".join(f"`{column}`=VALUES(`{column}`)" for column in INSERT_COLUMNS if column != "source_id")
    return f"INSERT INTO `{table_name}` ({column_sql}) VALUES ({placeholder_sql}) ON DUPLICATE KEY UPDATE {update_sql}"


def upsert_rows(connection, table_name: str, rows: List[dict], batch_size: int = 200) -> int:
    if not rows:
        return 0
    sql = build_insert_sql(table_name)
    values = [tuple(row.get(column) for column in INSERT_COLUMNS) for row in rows]
    written = 0
    with connection.cursor() as cursor:
        for batch in chunked(values, batch_size):
            cursor.executemany(sql, batch)
            written += len(batch)
    return written


def create_sync_task(connection, trigger_by_name: str = "") -> int:
    with connection.cursor() as cursor:
        ensure_sync_task_table(cursor)
        cursor.execute(
            f"""
            INSERT INTO `{SYNC_TASK_TABLE_NAME}` (
              task_type,
              status,
              started_at,
              trigger_by_staff_id,
              trigger_by_name
            ) VALUES (%s, 'running', NOW(), %s, %s)
            """,
            (TASK_TYPE_FAPAI_SYNC, None, trim_text(trigger_by_name)),
        )
        connection.commit()
        return int(cursor.lastrowid)


def update_sync_task_success(connection, task_id: int, summary: dict) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            UPDATE `{SYNC_TASK_TABLE_NAME}`
               SET status = 'success',
                   finished_at = NOW(),
                   summary = %s,
                   error_message = NULL
             WHERE id = %s
            """,
            (json.dumps(summary, ensure_ascii=False), task_id),
        )
    connection.commit()


def update_sync_task_failed(connection, task_id: int, error: Exception | str) -> None:
    message = trim_text(getattr(error, "message", "") or str(error))
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            UPDATE `{SYNC_TASK_TABLE_NAME}`
               SET status = 'failed',
                   finished_at = NOW(),
                   error_message = %s
             WHERE id = %s
            """,
            (message[:65535], task_id),
        )
    connection.commit()


def sync_houses(
    city_name: str,
    house_type_id: int,
    page_size: int,
    table_name: str,
    trigger_by_name: str,
    max_pages: Optional[int] = None,
    dry_run: bool = False,
) -> dict:
    connection = connect_db()
    task_id = create_sync_task(connection, trigger_by_name=trigger_by_name)

    try:
        district_map = fetch_district_map(city_name)
        page_num = 1
        total = 0
        fetched_rows = 0
        fetched_page_count = 0
        normalized_rows: List[dict] = []

        while True:
            if max_pages is not None and page_num > max_pages:
                break

            page_total, rows = fetch_house_page(page_num, page_size, city_name, house_type_id)
            if page_num == 1:
                total = page_total
            if not rows:
                break

            page_normalized = []
            for row in rows:
                normalized = normalize_row(row, city_name, district_map)
                if normalized:
                    page_normalized.append(normalized)

            normalized_rows.extend(page_normalized)
            fetched_rows += len(rows)
            fetched_page_count += 1
            log(f"[page] {page_num}: api={len(rows)} normalized={len(page_normalized)} total={fetched_rows}/{total}")

            if len(rows) < page_size:
                break
            if total and fetched_rows >= total:
                break
            page_num += 1

        result = {
            "task_id": task_id,
            "task_type": TASK_TYPE_FAPAI_SYNC,
            "city_name": city_name,
            "page_size": page_size,
            "page_count": fetched_page_count,
            "total": total,
            "fetched_rows": fetched_rows,
            "normalized_rows": len(normalized_rows),
            "written_rows": 0,
            "table_name": table_name,
            "sync_time": now_text(),
            "dry_run": dry_run,
            "trigger_by_name": trim_text(trigger_by_name),
        }

        if not dry_run:
            with connection.cursor() as cursor:
                ensure_table(cursor, table_name)
                synchronize_table_columns(cursor, table_name)
            written_rows = upsert_rows(connection, table_name, normalized_rows)
            connection.commit()
            result["written_rows"] = written_rows

        update_sync_task_success(connection, task_id, result)
        return result
    except Exception as error:
        try:
            connection.rollback()
        except Exception:
            pass
        try:
            update_sync_task_failed(connection, task_id, error)
        except Exception:
            pass
        raise
    finally:
        connection.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch auction houses and write them into MySQL")
    parser.add_argument("--city-name", default=DEFAULT_CITY_NAME)
    parser.add_argument("--house-type-id", type=int, default=DEFAULT_HOUSE_TYPE_ID)
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--table-name", default=DEFAULT_TABLE_NAME)
    parser.add_argument("--trigger-by-name", default="python_script")
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    started_at = datetime.now()
    log("[start] auction sync")
    result = sync_houses(
        city_name=args.city_name,
        house_type_id=args.house_type_id,
        page_size=args.page_size,
        table_name=args.table_name,
        trigger_by_name=args.trigger_by_name,
        max_pages=args.max_pages,
        dry_run=args.dry_run,
    )
    cost = round((datetime.now() - started_at).total_seconds(), 1)
    log(f"[done] {cost}s")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("[cancelled]")
        sys.exit(130)
    except Exception as exc:
        log("[failed]")
        log(str(exc))
        traceback.print_exc()
        sys.exit(1)
