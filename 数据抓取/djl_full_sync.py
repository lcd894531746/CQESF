#!/usr/bin/env python
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import re
import ssl
import sys
import time
import traceback
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pymysql


CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent
PROJECT_ROOT = REPO_ROOT / "CQ_API"
ENV_PATH = PROJECT_ROOT / ".env"

API_HOST = "https://api.daojiale.com"
API_BASE_QUERY = "select_city=500000"
CITY_NAME = "重庆市区"
SEARCH_PAGE_SIZE = 200
TOP_HOUSES_PER_COMMUNITY = 5
DETAIL_FETCH_DELAY = 0.05
SUB_AREA_FETCH_DELAY = 0.12

TARGET_DISTRICTS = [
    {"area_code": "a1", "area_id": "1", "area_name": "渝中区", "display_name": "渝中", "longitude": 106.54503, "latitude": 29.553162},
    {"area_code": "a4", "area_id": "4", "area_name": "南岸区", "display_name": "南岸", "longitude": 106.608759, "latitude": 29.534808},
    {"area_code": "a6", "area_id": "6", "area_name": "大渡口区", "display_name": "大渡口", "longitude": 106.479341, "latitude": 29.457765},
    {"area_code": "a5", "area_id": "5", "area_name": "九龙坡区", "display_name": "九龙坡", "longitude": 106.487852, "latitude": 29.504235},
    {"area_code": "a2", "area_id": "2", "area_name": "沙坪坝区", "display_name": "沙坪坝", "longitude": 106.398656, "latitude": 29.599685},
    {"area_code": "a8", "area_id": "8", "area_name": "巴南区", "display_name": "巴南", "longitude": 106.549276, "latitude": 29.426386},
    {"area_code": "a7", "area_id": "7", "area_name": "两江新区", "display_name": "两江新区", "longitude": 106.550764, "latitude": 29.668822},
]

TARGET_AREA_CODE_SET = {item["area_code"] for item in TARGET_DISTRICTS}
AREA_CODE_MAP = {
    "1": "a1",
    "2": "a2",
    "3": "a3",
    "4": "a4",
    "5": "a5",
    "6": "a6",
    "7": "a7",
    "8": "a8",
}

FIXED_DISTRICT_BOUNDS = {
    "first": "106.464295,29.486707",
    "second": "106.865298,30.085270",
}
FIXED_SUB_AREA_BOUNDS = {
    "first": "106.101141,29.062445",
    "second": "107.552145,30.962354",
}

DEFAULT_SEARCH_DATA = {
    "metrname": "",
    "characteristicStr": "",
    "saleSort": "0",
    "housezx": "",
    "buildingAge": "",
    "housecx": "",
    "floorState": "",
    "metrstation": "",
    "isLift": "",
    "houseRight": "",
    "fang": "",
    "saletotal": "",
    "builtArea": "",
    "houseUse": "",
}

DEFAULT_PARAMETER = {
    "metrname": "",
    "flag": "",
    "keywords": "",
    "housezx": "",
    "housecx": "",
    "floorState": "",
    "labelCondition": "",
    "metrstation": "",
    "dataId": "",
    "is_district_dk": "",
    "fang": "",
    "characteristicStr": "",
    "saleSort": "0",
    "dyname": "",
    "buildId": "",
    "buildingAge": "",
    "dzname": "",
    "depuDate": "",
    "isLift": "",
    "areaId": "",
    "districtId": "",
    "builtAreas": "",
    "fhname": "",
    "houseRight": "",
    "saletotal": "",
    "housetz": "",
    "houseUse": "",
}

DEFAULT_OLD_BUILD_PARAMETER = {
    "areaId": "",
    "districtId": "",
    "keywords": "",
    "zzsaleprice": "",
    "houseClasses": "",
    "oldBuildSort": "0",
    "buildingAge": "",
}

API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 12)",
    "Connection": "Keep-Alive",
    "Accept-Encoding": "gzip",
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept-Language": "zh-CN,zh;q=0.8",
    "Cache-Control": "no-cache",
}

DETAIL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Connection": "keep-alive",
}

UNVERIFIED_SSL_CONTEXT = ssl._create_unverified_context()


@dataclass
class DistrictRow:
    area_code: str
    area_id: str
    area_name: str
    display_name: str
    sale_count: int
    rent_count: int
    community_count: int
    avg_price_text: str
    longitude: Optional[float]
    latitude: Optional[float]
    raw_json: str


@dataclass
class SubAreaRow:
    area_code: str
    area_id: str
    district_id: str
    area_name: str
    sub_area_name: str
    sale_count: int
    rent_count: int
    community_count: int
    avg_price_text: str
    longitude: Optional[float]
    latitude: Optional[float]
    raw_json: str


@dataclass
class HouseRow:
    listing_id: str
    title: str
    listing_url: str
    area_code: str
    area_name: str
    sub_area_name: str
    community_id: str
    community_name: str
    longitude: Optional[float]
    latitude: Optional[float]
    total_price_wan: Optional[float]
    unit_price: Optional[float]
    unit_price_text: str
    house_type: str
    build_area_sqm: Optional[float]
    decoration: str
    orientation: str
    building_year: str
    building_structure: str
    property_fee_text: str
    usage_type: str
    elevator_text: str
    floor_text: str
    metro_text: str
    house_location_text: str
    tags_text: str
    vr_url: str
    cover_image_url: str
    image_urls_json: str
    community_info_json: str


@dataclass
class CommunityRow:
    community_id: str
    community_name: str
    area_code: str
    area_name: str
    sub_area_name: str
    community_url: str
    longitude: Optional[float]
    latitude: Optional[float]
    community_avg_price_text: str
    source_listing_id: str
    source_url: str
    houses: List[HouseRow]


def log(message: str) -> None:
    print(message, flush=True)


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
        value = os.getenv(key)
        if value not in (None, ""):
            return value
        env_file_value = env_values.get(key)
        if env_file_value not in (None, ""):
            return env_file_value
    return default


def trim_text(value) -> str:
    return str(value or "").strip()


def to_int(value) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0


def to_float(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def decimal_from_text(value: str) -> Optional[float]:
    raw = trim_text(value).replace("万", "")
    if not raw:
        return None
    try:
        return float(Decimal(raw))
    except (InvalidOperation, ValueError):
        return None


def parse_position(item: dict) -> Tuple[Optional[float], Optional[float]]:
    px = to_float(item.get("px"))
    py = to_float(item.get("py"))
    if px is not None and py is not None:
        return px, py
    position = trim_text(item.get("position"))
    if not position:
        return None, None
    parts = position.split()
    if len(parts) < 2:
        return None, None
    return to_float(parts[0]), to_float(parts[1])


def extract_unit_price_value(unit_price_text: str, fallback: Optional[float]) -> float:
    if fallback is not None and math.isfinite(fallback):
        return fallback
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", trim_text(unit_price_text))
    if not match:
        return math.inf
    try:
        return float(match.group(1))
    except Exception:
        return math.inf


def compare_house_priority(house: HouseRow) -> Tuple[float, float, str]:
    unit_price = extract_unit_price_value(house.unit_price_text, house.unit_price)
    total_price = house.total_price_wan if house.total_price_wan is not None else math.inf
    return unit_price, total_price, house.listing_id


def limit_houses_for_community(houses: Sequence[HouseRow], deleted_listing_ids: Optional[set[str]] = None) -> List[HouseRow]:
    deleted_listing_ids = deleted_listing_ids or set()
    sorted_houses = sorted(houses, key=compare_house_priority)
    picked: List[HouseRow] = []
    used_listing_ids: set[str] = set()
    for house in sorted_houses:
        if not house.listing_id or house.listing_id in used_listing_ids:
            continue
        if house.listing_id in deleted_listing_ids:
            continue
        used_listing_ids.add(house.listing_id)
        picked.append(house)
        if len(picked) >= TOP_HOUSES_PER_COMMUNITY:
            break
    return picked


def build_sale_total_range(min_house_price, max_house_price) -> str:
    min_value = to_float(min_house_price)
    max_value = to_float(max_house_price)
    if min_value is None or max_value is None:
        return ""
    return f"{min_value:g}-{max_value:g}"


def request_json(pathname: str, payload: dict) -> dict:
    body = urlencode(payload).encode("utf-8")
    request = Request(
        f"{API_HOST}{pathname}",
        data=body,
        headers=API_HEADERS,
        method="POST",
    )
    with urlopen(request, timeout=30, context=UNVERIFIED_SSL_CONTEXT) as response:
        raw = response.read()
        if response.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.decompress(raw)
        text = raw.decode("utf-8", errors="ignore")
        return json.loads(text)


def fetch_html(url: str) -> str:
    request = Request(url, headers=DETAIL_HEADERS, method="GET")
    with urlopen(request, timeout=30, context=UNVERIFIED_SSL_CONTEXT) as response:
        raw = response.read()
        if response.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", errors="ignore")


def load_basic_settings(connection) -> dict:
    with connection.cursor() as cursor:
        cursor.execute("SELECT min_house_price, max_house_price FROM basic_settings WHERE id = 1 LIMIT 1")
        row = cursor.fetchone()
        return row or {}


def load_sale_total_range() -> str:
    connection = connect_db()
    try:
        basic_settings = load_basic_settings(connection)
        return build_sale_total_range(
            basic_settings.get("min_house_price"),
            basic_settings.get("max_house_price"),
        )
    finally:
        connection.close()


def fetch_districts() -> List[DistrictRow]:
    payload = request_json(
        f"/map/oldMapInfoV1?{API_BASE_QUERY}",
        {
            "token": "",
            "sourceType": "1",
            "versionCodes": "142",
            "versionName": "4.8.1",
            "tipType": "1",
            "first": FIXED_DISTRICT_BOUNDS["first"],
            "second": FIXED_DISTRICT_BOUNDS["second"],
            "searchData": json.dumps(DEFAULT_SEARCH_DATA, ensure_ascii=False),
        },
    )
    rows = payload.get("data") or payload.get("result") or []
    normalized: Dict[str, DistrictRow] = {}
    for item in rows:
        area_id = trim_text(item.get("dataId"))
        area_code = AREA_CODE_MAP.get(area_id, f"a{area_id}" if area_id else "")
        if not area_code:
            continue
        longitude, latitude = parse_position(item)
        normalized[area_code] = DistrictRow(
            area_code=area_code,
            area_id=area_id,
            area_name=trim_text(item.get("key")),
            display_name=trim_text(item.get("key")),
            sale_count=to_int(item.get("saleCount")),
            rent_count=to_int(item.get("rentCount")),
            community_count=to_int(item.get("buildCount")),
            avg_price_text=trim_text(item.get("buildPrice")),
            longitude=longitude,
            latitude=latitude,
            raw_json=json.dumps(item, ensure_ascii=False),
        )

    result: List[DistrictRow] = []
    for district in TARGET_DISTRICTS:
        matched = normalized.get(district["area_code"])
        result.append(
            DistrictRow(
                area_code=district["area_code"],
                area_id=district["area_id"],
                area_name=matched.area_name if matched and matched.area_name else district["area_name"],
                display_name=district["display_name"],
                sale_count=matched.sale_count if matched else 0,
                rent_count=matched.rent_count if matched else 0,
                community_count=matched.community_count if matched else 0,
                avg_price_text=matched.avg_price_text if matched else "",
                longitude=matched.longitude if matched and matched.longitude is not None else district["longitude"],
                latitude=matched.latitude if matched and matched.latitude is not None else district["latitude"],
                raw_json=matched.raw_json if matched else json.dumps({"fixed": True, "areaCode": district["area_code"]}, ensure_ascii=False),
            )
        )
    return result


def fetch_sub_areas() -> List[SubAreaRow]:
    payload = request_json(
        f"/map/oldMapInfoV1?{API_BASE_QUERY}",
        {
            "token": "",
            "sourceType": "1",
            "versionCodes": "142",
            "versionName": "4.8.1",
            "tipType": "2",
            "first": FIXED_SUB_AREA_BOUNDS["first"],
            "second": FIXED_SUB_AREA_BOUNDS["second"],
            "searchData": json.dumps(DEFAULT_SEARCH_DATA, ensure_ascii=False),
        },
    )
    rows = payload.get("data") or payload.get("result") or []
    result: List[SubAreaRow] = []
    for item in rows:
        parts = trim_text(item.get("id")).split(":")
        district_id = trim_text(parts[1] if len(parts) > 1 else item.get("dataId"))
        area_id = trim_text(parts[2] if len(parts) > 2 else "")
        area_code = AREA_CODE_MAP.get(area_id, f"a{area_id}" if area_id else "")
        if area_code not in TARGET_AREA_CODE_SET:
            continue
        longitude, latitude = parse_position(item)
        result.append(
            SubAreaRow(
                area_code=area_code,
                area_id=area_id,
                district_id=district_id,
                area_name=trim_text(item.get("areaName") or item.get("msgList")),
                sub_area_name=trim_text(item.get("key")),
                sale_count=to_int(item.get("saleCount")),
                rent_count=to_int(item.get("rentCount")),
                community_count=to_int(item.get("buildCount")),
                avg_price_text=trim_text(item.get("buildPrice")),
                longitude=longitude,
                latitude=latitude,
                raw_json=json.dumps(item, ensure_ascii=False),
            )
        )
    return result


def fetch_sub_area_houses(sub_area: SubAreaRow, sale_total_range: str = "") -> List[dict]:
    page_no = 1
    rows: List[dict] = []
    total_pages = 1
    while page_no <= total_pages:
        payload = request_json(
            f"/searchSale?{API_BASE_QUERY}",
            {
                "token": "",
                "sourceType": "1",
                "versionCodes": "142",
                "versionName": "4.8.1",
                "parameter": json.dumps(
                    {
                        **DEFAULT_PARAMETER,
                        "areaId": sub_area.area_id,
                        "districtId": sub_area.district_id,
                        "saletotal": sale_total_range,
                    },
                    ensure_ascii=False,
                ),
                "pageNo": str(page_no),
                "pageSize": str(SEARCH_PAGE_SIZE),
            },
        )
        data = payload.get("data") or {}
        page_rows = data.get("rows") or payload.get("result") or []
        if not page_rows:
            break
        rows.extend(page_rows)
        total_pages = max(1, to_int(data.get("totalPages") or 1))
        page_no += 1
        if page_no <= total_pages:
            time.sleep(0.08)
    return rows


def fetch_sub_area_old_builds(sub_area: SubAreaRow) -> List[dict]:
    page_no = 1
    rows: List[dict] = []
    total_pages = 1
    while page_no <= total_pages:
        payload = request_json(
            f"/searchOldBuild?{API_BASE_QUERY}",
            {
                "token": "",
                "sourceType": "1",
                "versionCodes": "142",
                "versionName": "4.8.1",
                "parameter": json.dumps(
                    {
                        **DEFAULT_OLD_BUILD_PARAMETER,
                        "areaId": sub_area.area_id,
                        "districtId": sub_area.district_id,
                    },
                    ensure_ascii=False,
                ),
                "pageNo": str(page_no),
                "pageSize": str(SEARCH_PAGE_SIZE),
            },
        )
        data = payload.get("data") or {}
        page_rows = data.get("rows") or payload.get("result") or []
        if not page_rows:
            break
        rows.extend(page_rows)
        total_pages = max(1, to_int(data.get("totalPages") or 1))
        page_no += 1
        if page_no <= total_pages:
            time.sleep(0.08)
    return rows


def normalize_house_row(row: dict, sub_area: SubAreaRow) -> Optional[HouseRow]:
    listing_id = trim_text(row.get("houseid"))
    if not listing_id:
        return None

    build_id = trim_text(row.get("buildid") or row.get("comid"))
    community_name = trim_text(row.get("buildname") or row.get("community"))
    if not community_name:
        return None

    community_id = build_id or f"fallback-{sub_area.area_code}-{sub_area.district_id}-{community_name}"
    image_urls = []
    for item in row.get("imgs") or []:
        image = trim_text(item)
        if not image:
            continue
        image_urls.append(image if image.startswith("http") else f"https://image.daojiale.com:17000/cqimg{image}")

    unit_price = to_float(row.get("saleprice"))
    return HouseRow(
        listing_id=listing_id,
        title=trim_text(row.get("housetitle")),
        listing_url=f"https://cq.daojiale.com/esf/{listing_id}.html",
        area_code=sub_area.area_code,
        area_name=trim_text(row.get("areaname") or sub_area.area_name),
        sub_area_name=trim_text(row.get("districtname") or sub_area.sub_area_name),
        community_id=community_id,
        community_name=community_name,
        longitude=None,
        latitude=None,
        total_price_wan=to_float(row.get("saletotal")),
        unit_price=unit_price,
        unit_price_text=f"{int(unit_price)}元/m²" if unit_price is not None else "",
        house_type=trim_text(row.get("compositeAttribute") or ""),
        build_area_sqm=to_float(row.get("builtarea") or row.get("builtarea1")),
        decoration=trim_text(row.get("housezx")),
        orientation=trim_text(row.get("housecx")),
        building_year=trim_text(row.get("buildage")),
        building_structure="",
        property_fee_text="",
        usage_type=trim_text(row.get("houseuse")),
        elevator_text=trim_text(row.get("isLift")),
        floor_text=trim_text(row.get("floorState")),
        metro_text=trim_text(row.get("metrname") or row.get("metrstation")),
        house_location_text=trim_text(row.get("districtname") or sub_area.sub_area_name),
        tags_text=trim_text(row.get("housebq")),
        vr_url="",
        cover_image_url=trim_text(row.get("listUrl")),
        image_urls_json=json.dumps(image_urls, ensure_ascii=False),
        community_info_json=json.dumps(
            {
                "areaId": row.get("areaId"),
                "districtId": row.get("districtId"),
                "buildId": row.get("buildid"),
                "buildName": row.get("buildname"),
                "districtName": row.get("districtname"),
            },
            ensure_ascii=False,
        ),
    )


def normalize_old_build_row(row: dict, sub_area: SubAreaRow) -> Optional[dict]:
    community_id = trim_text(row.get("rrjuId") or row.get("buildid") or row.get("comid"))
    community_name = trim_text(row.get("buildname") or row.get("community"))
    if not community_id or not community_name:
        return None

    avg_unit_price = to_float(row.get("zzsaleprice"))
    return {
        "community_id": community_id,
        "community_name": community_name,
        "area_code": sub_area.area_code,
        "area_name": trim_text(row.get("areaname") or sub_area.area_name),
        "sub_area_name": trim_text(row.get("districtname") or sub_area.sub_area_name),
        "community_url": f"https://cq.daojiale.com/xiaoqu/{community_id}.html",
        "longitude": to_float(row.get("px")),
        "latitude": to_float(row.get("py")),
        "avg_price_text": f"{int(avg_unit_price)}元/m²" if avg_unit_price is not None else "",
    }


def pick_top_houses_by_community(rows: List[dict], sub_area: SubAreaRow, old_build_map: Dict[str, dict]) -> Dict[str, CommunityRow]:
    grouped: Dict[str, CommunityRow] = {}
    for row in rows:
        normalized = normalize_house_row(row, sub_area)
        if not normalized:
            continue
        old_build = old_build_map.get(normalized.community_id)
        community = grouped.get(normalized.community_id)
        if community is None:
            community = CommunityRow(
                community_id=normalized.community_id,
                community_name=normalized.community_name,
                area_code=normalized.area_code,
                area_name=normalized.area_name,
                sub_area_name=normalized.sub_area_name,
                community_url=(old_build or {}).get("community_url") or (
                    f"https://cq.daojiale.com/xiaoqu/{normalized.community_id}.html"
                    if not normalized.community_id.startswith("fallback-")
                    else ""
                ),
                longitude=(old_build or {}).get("longitude"),
                latitude=(old_build or {}).get("latitude"),
                community_avg_price_text=(old_build or {}).get("avg_price_text") or sub_area.avg_price_text,
                source_listing_id=normalized.listing_id,
                source_url=normalized.listing_url,
                houses=[],
            )
            grouped[normalized.community_id] = community
        if old_build and old_build.get("longitude") is not None:
            normalized.longitude = old_build.get("longitude")
        if old_build and old_build.get("latitude") is not None:
            normalized.latitude = old_build.get("latitude")
        community.houses.append(normalized)

    for community_id, old_build in old_build_map.items():
        if community_id in grouped:
            continue
        grouped[community_id] = CommunityRow(
            community_id=community_id,
            community_name=old_build["community_name"],
            area_code=old_build["area_code"],
            area_name=old_build["area_name"],
            sub_area_name=old_build["sub_area_name"],
            community_url=old_build["community_url"],
            longitude=old_build["longitude"],
            latitude=old_build["latitude"],
            community_avg_price_text=old_build["avg_price_text"] or sub_area.avg_price_text,
            source_listing_id="",
            source_url="",
            houses=[],
        )

    for item in grouped.values():
        item.houses = limit_houses_for_community(item.houses)
        if item.houses:
            item.source_listing_id = item.houses[0].listing_id
            item.source_url = item.houses[0].listing_url
    return grouped


def merge_communities(groups: Iterable[Dict[str, CommunityRow]]) -> Dict[str, CommunityRow]:
    merged: Dict[str, CommunityRow] = {}
    for group in groups:
        for community_id, item in group.items():
            if community_id not in merged:
                merged[community_id] = CommunityRow(**{
                    "community_id": item.community_id,
                    "community_name": item.community_name,
                    "area_code": item.area_code,
                    "area_name": item.area_name,
                    "sub_area_name": item.sub_area_name,
                    "community_url": item.community_url,
                    "longitude": item.longitude,
                    "latitude": item.latitude,
                    "community_avg_price_text": item.community_avg_price_text,
                    "source_listing_id": item.source_listing_id,
                    "source_url": item.source_url,
                    "houses": list(item.houses),
                })
                continue
            existing = merged[community_id]
            house_map = {house.listing_id: house for house in existing.houses}
            for house in item.houses:
                house_map[house.listing_id] = house
            existing.houses = limit_houses_for_community(list(house_map.values()))
            if existing.longitude is None and item.longitude is not None:
                existing.longitude = item.longitude
            if existing.latitude is None and item.latitude is not None:
                existing.latitude = item.latitude
            if not existing.community_avg_price_text and item.community_avg_price_text:
                existing.community_avg_price_text = item.community_avg_price_text
            if existing.houses:
                existing.source_listing_id = existing.houses[0].listing_id
                existing.source_url = existing.houses[0].listing_url
    return merged


def parse_detail_coordinates(html_text: str) -> Tuple[Optional[float], Optional[float]]:
    patterns = [
        r"map\.centerAndZoom\(new\s+BMap\.Point\('([0-9.]+)'\s*,\s*'([0-9.]+)'\)",
        r"var\s+point\s*=\s*new\s+BMap\.Point\('([0-9.]+)'\s*,\s*'([0-9.]+)'\)",
    ]
    for pattern in patterns:
        match = re.search(pattern, html_text, flags=re.I)
        if match:
            return to_float(match.group(1)), to_float(match.group(2))
    return None, None


def parse_detail_community_info(html_text: str) -> Tuple[Optional[str], Optional[str]]:
    community_match = re.search(
        r'<a[^>]+href="(https?://[^"]*/xiaoqu/(\d+)\.html)"[^>]*>[^<]+</a>',
        html_text,
        flags=re.I,
    )
    if not community_match:
        return None, None
    return community_match.group(2), community_match.group(1)


def enrich_community_coordinates(communities: Dict[str, CommunityRow]) -> None:
    items = list(communities.values())
    total = len(items)
    for index, community in enumerate(items, start=1):
        source_house = community.houses[0] if community.houses else None
        if source_house is None:
            continue
        log(f"[坐标] {community.community_name} ({index}/{total})")
        try:
            html_text = fetch_html(source_house.listing_url)
            longitude, latitude = parse_detail_coordinates(html_text)
            detail_community_id, detail_community_url = parse_detail_community_info(html_text)
            if longitude is not None and latitude is not None:
                community.longitude = longitude
                community.latitude = latitude
                for house in community.houses:
                    house.longitude = longitude
                    house.latitude = latitude
            if detail_community_id and community.community_id.startswith("fallback-"):
                community.community_id = detail_community_id
                community.community_url = detail_community_url or community.community_url
                for house in community.houses:
                    house.community_id = detail_community_id
            elif detail_community_url and not community.community_url:
                community.community_url = detail_community_url
        except Exception as exc:
            log(f"  [坐标失败] {community.community_name}: {exc}")
        time.sleep(DETAIL_FETCH_DELAY)


def reindex_communities(communities: Dict[str, CommunityRow]) -> Dict[str, CommunityRow]:
    remapped: Dict[str, CommunityRow] = {}
    for item in communities.values():
        existing = remapped.get(item.community_id)
        if existing is None:
            remapped[item.community_id] = item
            continue
        house_map = {house.listing_id: house for house in existing.houses}
        for house in item.houses:
            house_map[house.listing_id] = house
        existing.houses = sorted(house_map.values(), key=compare_house_priority)[:TOP_HOUSES_PER_COMMUNITY]
        if existing.longitude is None and item.longitude is not None:
            existing.longitude = item.longitude
        if existing.latitude is None and item.latitude is not None:
            existing.latitude = item.latitude
        if not existing.community_url and item.community_url:
            existing.community_url = item.community_url
        if not existing.community_avg_price_text and item.community_avg_price_text:
            existing.community_avg_price_text = item.community_avg_price_text
        if existing.houses:
            existing.source_listing_id = existing.houses[0].listing_id
            existing.source_url = existing.houses[0].listing_url
    return remapped


def rebuild_sub_area_summary(communities: Sequence[CommunityRow]) -> List[Tuple[str, str, str, Optional[float], Optional[float], int, int]]:
    grouped: Dict[Tuple[str, str, str], dict] = {}
    for community in communities:
        key = (community.area_code, community.area_name, community.sub_area_name)
        bucket = grouped.setdefault(
            key,
            {
                "community_count": 0,
                "house_count": 0,
                "longitudes": [],
                "latitudes": [],
            },
        )
        bucket["community_count"] += 1
        bucket["house_count"] += len(community.houses)
        if community.longitude is not None and community.latitude is not None:
            bucket["longitudes"].append(community.longitude)
            bucket["latitudes"].append(community.latitude)

    result = []
    for (area_code, area_name, sub_area_name), bucket in grouped.items():
        lng = round(sum(bucket["longitudes"]) / len(bucket["longitudes"]), 6) if bucket["longitudes"] else None
        lat = round(sum(bucket["latitudes"]) / len(bucket["latitudes"]), 6) if bucket["latitudes"] else None
        result.append((area_code, area_name, sub_area_name, lng, lat, bucket["community_count"], bucket["house_count"]))
    result.sort(key=lambda item: (item[0], item[2]))
    return result


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


def delete_in_chunks(cursor, table_name: str, key_name: str, values: Sequence[str], chunk_size: int = 1000) -> int:
    deleted = 0
    for index in range(0, len(values), chunk_size):
        chunk = list(values[index:index + chunk_size])
        if not chunk:
            continue
        placeholders = ",".join(["%s"] * len(chunk))
        deleted += cursor.execute(f"DELETE FROM {table_name} WHERE {key_name} IN ({placeholders})", chunk)
    return deleted


def load_deleted_listing_ids(cursor) -> set[str]:
    cursor.execute("SELECT listing_id FROM djl_deleted_houses WHERE TRIM(COALESCE(listing_id, '')) <> ''")
    return {trim_text(row["listing_id"]) for row in cursor.fetchall() if trim_text(row["listing_id"])}


def upsert_sync(connection, districts: List[DistrictRow], sub_areas: List[SubAreaRow], communities: Dict[str, CommunityRow], all_listing_ids: List[str]) -> None:
    community_items = list(communities.values())
    houses = [house for item in community_items for house in item.houses]

    with connection.cursor() as cursor:
        deleted_listing_ids = load_deleted_listing_ids(cursor)
        if deleted_listing_ids:
            log(f"[过滤] 已跳过人工删除房源 {len(deleted_listing_ids)} 套")
            community_items = [
                CommunityRow(**{
                    "community_id": item.community_id,
                    "community_name": item.community_name,
                    "area_code": item.area_code,
                    "area_name": item.area_name,
                    "sub_area_name": item.sub_area_name,
                    "community_url": item.community_url,
                    "longitude": item.longitude,
                    "latitude": item.latitude,
                    "community_avg_price_text": item.community_avg_price_text,
                    "source_listing_id": item.source_listing_id,
                    "source_url": item.source_url,
                    "houses": limit_houses_for_community(item.houses, deleted_listing_ids),
                })
                for item in community_items
            ]
            community_items = [item for item in community_items if item.houses]
            communities = {item.community_id: item for item in community_items}
            houses = [house for item in community_items for house in item.houses]
            all_listing_ids = [house.listing_id for house in houses if house.listing_id]

        fresh_listing_ids = sorted(set(all_listing_ids))
        fresh_community_ids = sorted({item.community_id for item in community_items if item.community_id})
        rebuilt_sub_areas = rebuild_sub_area_summary(community_items)

        log(f"[入库] 区级 {len(districts)} 条")
        for district in districts:
            cursor.execute(
                """
                INSERT INTO djl_map_district_rel
                  (area_code, area_id, area_name, display_name, sale_count, rent_count, community_count, avg_price_text, longitude_bd09, latitude_bd09, raw_json)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  area_id = VALUES(area_id),
                  area_name = VALUES(area_name),
                  display_name = VALUES(display_name),
                  sale_count = VALUES(sale_count),
                  rent_count = VALUES(rent_count),
                  community_count = VALUES(community_count),
                  avg_price_text = VALUES(avg_price_text),
                  longitude_bd09 = VALUES(longitude_bd09),
                  latitude_bd09 = VALUES(latitude_bd09),
                  raw_json = VALUES(raw_json)
                """,
                (
                    district.area_code,
                    district.area_id,
                    district.area_name,
                    district.display_name,
                    district.sale_count,
                    district.rent_count,
                    district.community_count,
                    district.avg_price_text,
                    district.longitude,
                    district.latitude,
                    district.raw_json,
                ),
            )

        log(f"[入库] 商圈气泡 {len(rebuilt_sub_areas)} 条")
        current_sub_area_keys = {(item.area_code, item.sub_area_name) for item in sub_areas}
        cursor.execute("SELECT area_code, sub_area_name FROM djl_sub_area_map_rel")
        stale_sub_area_pairs = [
            (trim_text(row["area_code"]), trim_text(row["sub_area_name"]))
            for row in cursor.fetchall()
            if (trim_text(row["area_code"]), trim_text(row["sub_area_name"])) not in current_sub_area_keys
        ]
        for item in rebuilt_sub_areas:
            cursor.execute(
                """
                INSERT INTO djl_sub_area_map_rel
                  (area_code, area_name, sub_area_name, longitude_bd09, latitude_bd09, community_count, house_count, source)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  area_name = VALUES(area_name),
                  longitude_bd09 = VALUES(longitude_bd09),
                  latitude_bd09 = VALUES(latitude_bd09),
                  community_count = VALUES(community_count),
                  house_count = VALUES(house_count),
                  source = VALUES(source)
                """,
                (*item, "community_avg"),
            )
        for area_code, sub_area_name in stale_sub_area_pairs:
            cursor.execute(
                "DELETE FROM djl_sub_area_map_rel WHERE area_code = %s AND sub_area_name = %s",
                (area_code, sub_area_name),
            )

        log(f"[入库] 小区 {len(community_items)} 条")
        for item in community_items:
            cursor.execute(
                """
                INSERT INTO djl_community_map_rel
                  (community_id, community_name, area_code, area_name, sub_area_name, community_url, longitude_bd09, latitude_bd09, community_avg_price_text, source_listing_id, source_url)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  community_name = VALUES(community_name),
                  area_code = VALUES(area_code),
                  area_name = VALUES(area_name),
                  sub_area_name = VALUES(sub_area_name),
                  community_url = VALUES(community_url),
                  longitude_bd09 = VALUES(longitude_bd09),
                  latitude_bd09 = VALUES(latitude_bd09),
                  community_avg_price_text = VALUES(community_avg_price_text),
                  source_listing_id = VALUES(source_listing_id),
                  source_url = VALUES(source_url)
                """,
                (
                    item.community_id,
                    item.community_name,
                    item.area_code,
                    item.area_name,
                    item.sub_area_name,
                    item.community_url,
                    item.longitude,
                    item.latitude,
                    item.community_avg_price_text,
                    item.source_listing_id,
                    item.source_url,
                ),
            )

        log(f"[入库] 房源 {len(houses)} 条")
        for house in houses:
            cursor.execute(
                """
                INSERT INTO djl_esf_house_detail
                  (listing_id, title, listing_url, area_code, area_name, sub_area_name, community_id, community_name, longitude_bd09, latitude_bd09, total_price_wan, unit_price_text, house_type, build_area_sqm, decoration, orientation, building_year, building_structure, property_fee_text, usage_type, elevator_text, floor_text, metro_text, house_location_text, tags_text, vr_url, cover_image_url, image_urls_json, community_info_json)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  title = VALUES(title),
                  listing_url = VALUES(listing_url),
                  area_code = VALUES(area_code),
                  area_name = VALUES(area_name),
                  sub_area_name = VALUES(sub_area_name),
                  community_id = VALUES(community_id),
                  community_name = VALUES(community_name),
                  longitude_bd09 = VALUES(longitude_bd09),
                  latitude_bd09 = VALUES(latitude_bd09),
                  total_price_wan = VALUES(total_price_wan),
                  unit_price_text = VALUES(unit_price_text),
                  house_type = VALUES(house_type),
                  build_area_sqm = VALUES(build_area_sqm),
                  decoration = VALUES(decoration),
                  orientation = VALUES(orientation),
                  building_year = VALUES(building_year),
                  building_structure = VALUES(building_structure),
                  property_fee_text = VALUES(property_fee_text),
                  usage_type = VALUES(usage_type),
                  elevator_text = VALUES(elevator_text),
                  floor_text = VALUES(floor_text),
                  metro_text = VALUES(metro_text),
                  house_location_text = VALUES(house_location_text),
                  tags_text = VALUES(tags_text),
                  vr_url = VALUES(vr_url),
                  cover_image_url = VALUES(cover_image_url),
                  image_urls_json = VALUES(image_urls_json),
                  community_info_json = VALUES(community_info_json)
                """,
                (
                    house.listing_id,
                    house.title,
                    house.listing_url,
                    house.area_code,
                    house.area_name,
                    house.sub_area_name,
                    house.community_id,
                    house.community_name,
                    house.longitude,
                    house.latitude,
                    house.total_price_wan,
                    house.unit_price_text,
                    house.house_type,
                    house.build_area_sqm,
                    house.decoration,
                    house.orientation,
                    house.building_year,
                    house.building_structure,
                    house.property_fee_text,
                    house.usage_type,
                    house.elevator_text,
                    house.floor_text,
                    house.metro_text,
                    house.house_location_text,
                    house.tags_text,
                    house.vr_url,
                    house.cover_image_url,
                    house.image_urls_json,
                    house.community_info_json,
                ),
            )

        log("[入库] 清理本次抓取之外的旧数据")
        cursor.execute("SELECT listing_id FROM djl_esf_house_detail")
        existing_listing_ids = {trim_text(row["listing_id"]) for row in cursor.fetchall()}
        stale_listing_ids = sorted(existing_listing_ids - set(fresh_listing_ids))
        deleted_house_count = delete_in_chunks(cursor, "djl_esf_house_detail", "listing_id", stale_listing_ids)

        cursor.execute("SELECT community_id FROM djl_community_map_rel")
        existing_community_ids = {trim_text(row["community_id"]) for row in cursor.fetchall()}
        stale_community_ids = sorted(existing_community_ids - set(fresh_community_ids))
        deleted_community_count = delete_in_chunks(cursor, "djl_community_map_rel", "community_id", stale_community_ids)

        cursor.execute(
            """
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
              FROM djl_esf_house_detail h
              LEFT JOIN djl_community_map_rel c
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
            """
        )
        connection.commit()
        return

        log(f"  [删除] 房源 {deleted_house_count} 条 | 小区 {deleted_community_count} 条")

        cursor.execute(
            """
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
              FROM djl_esf_house_detail h
              LEFT JOIN djl_community_map_rel c
                ON c.community_id = h.community_id
              GROUP BY h.area_code
            ) x ON x.area_code = d.area_code
            SET d.sale_count = COALESCE(x.sale_count, 0),
                d.community_count = COALESCE(x.community_count, 0),
                d.avg_price_text = CASE
                  WHEN x.avg_price IS NULL THEN ''
                  WHEN MOD(x.avg_price, 1) = 0 THEN CONCAT(CAST(x.avg_price AS UNSIGNED), '万')
                  ELSE CONCAT(x.avg_price, '万')
                END
            """
        )

        cursor.execute(
            """
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
              FROM djl_esf_house_detail h
              LEFT JOIN djl_community_map_rel c
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
            """
        )

    connection.commit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="到家了 7 区二手房抓取并全量同步入库")
    parser.add_argument("--skip-detail", action="store_true", help="跳过详情页坐标抓取，速度更快，但坐标会退化")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    started = time.time()
    sale_total_range = load_sale_total_range()
    log("[开始] 到家了二手房 7 区抓取 + 全量同步入库")
    districts = fetch_districts()
    sub_areas = fetch_sub_areas()
    grouped_results: List[Dict[str, CommunityRow]] = []
    all_listing_ids: List[str] = []

    for district in TARGET_DISTRICTS:
        district_sub_areas = [item for item in sub_areas if item.area_code == district["area_code"]]
        log(f"[区域] {district['display_name']} | 商圈 {len(district_sub_areas)} 个")
        for index, sub_area in enumerate(district_sub_areas, start=1):
            log(f"  [商圈] {district['display_name']} -> {sub_area.sub_area_name} ({index}/{len(district_sub_areas)})")
            old_build_rows = fetch_sub_area_old_builds(sub_area)
            old_build_map: Dict[str, dict] = {}
            for old_build_row in old_build_rows:
                normalized_old_build = normalize_old_build_row(old_build_row, sub_area)
                if normalized_old_build:
                    old_build_map[normalized_old_build["community_id"]] = normalized_old_build
            rows = fetch_sub_area_houses(sub_area, sale_total_range)
            log(f"    [房源] 抓到 {len(rows)} 套")
            for row in rows:
                listing_id = trim_text(row.get("houseid"))
                if listing_id:
                    all_listing_ids.append(listing_id)
            grouped_results.append(pick_top_houses_by_community(rows, sub_area, old_build_map))
            time.sleep(SUB_AREA_FETCH_DELAY)

    merged = merge_communities(grouped_results)
    log(f"[汇总] 小区 {len(merged)} 个 | 全量房源 {len(set(all_listing_ids))} 套 | 入库房源 {sum(len(item.houses) for item in merged.values())} 套")

    if not all_listing_ids or not merged:
        raise RuntimeError("本次抓取结果为空，已中止入库，避免误删库内数据")

    if args.skip_detail:
        log("[坐标] 已跳过详情页补坐标")
    else:
        enrich_community_coordinates(merged)
        merged = reindex_communities(merged)

    connection = connect_db()
    try:
        upsert_sync(connection, districts, sub_areas, merged, list(set(all_listing_ids)))
    finally:
        connection.close()

    cost = round(time.time() - started, 1)
    log(f"[完成] 抓取入库结束，用时 {cost}s")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("[中断] 用户取消执行")
        sys.exit(130)
    except Exception as exc:
        log("[失败] 脚本执行异常")
        log(str(exc))
        traceback.print_exc()
        sys.exit(1)
