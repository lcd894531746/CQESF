const https = require('https');
const zlib = require('zlib');
const { DJL_MAP_DISTRICT_TABLE_NAME, DJL_SYNC_TASK_TABLE_NAME } = require('./djlSyncSchema');
const { rebuildDjlSubAreaCenters } = require('./djlSubAreaService');

const DJL_COMMUNITY_TABLE_NAME = 'djl_community_map_rel';
const DJL_HOUSE_DETAIL_TABLE_NAME = 'djl_esf_house_detail';

const API_HOST = 'api.daojiale.com';
const API_BASE_QUERY = 'select_city=500000';
const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; U; Android 12; zh-cn; SM-S7110 Build/V417IR) AppleWebKit/533.1 (KHTML, like Gecko) Version/5.0 Mobile Safari/533.1',
  Connection: 'Keep-Alive',
  'Accept-Encoding': 'gzip',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept-Language': 'zh-CN,zh;q=0.8',
  'Cache-Control': 'no-cache',
};
const SEARCH_PAGE_SIZE = 200;
const TOP_HOUSES_PER_COMMUNITY = 5;
const TASK_TYPE_FULL_SYNC = 'full_sync';
const DISTRICT_INSERT_CHUNK_SIZE = 20;
const COMMUNITY_INSERT_CHUNK_SIZE = 200;
const HOUSE_INSERT_CHUNK_SIZE = 500;
const DETAIL_FETCH_DELAY = 80;
const TARGET_DISTRICTS = [
  { areaCode: 'a1', areaId: '1', areaName: '渝中区', displayName: '渝中', longitude: 106.54503, latitude: 29.553162 },
  { areaCode: 'a4', areaId: '4', areaName: '南岸区', displayName: '南岸', longitude: 106.608759, latitude: 29.534808 },
  { areaCode: 'a6', areaId: '6', areaName: '大渡口区', displayName: '大渡口', longitude: 106.479341, latitude: 29.457765 },
  { areaCode: 'a5', areaId: '5', areaName: '九龙坡区', displayName: '九龙坡', longitude: 106.487852, latitude: 29.504235 },
  { areaCode: 'a2', areaId: '2', areaName: '沙坪坝区', displayName: '沙坪坝', longitude: 106.398656, latitude: 29.599685 },
  { areaCode: 'a8', areaId: '8', areaName: '巴南区', displayName: '巴南', longitude: 106.549276, latitude: 29.426386 },
  { areaCode: 'a7', areaId: '7', areaName: '两江新区', displayName: '两江新区', longitude: 106.550764, latitude: 29.668822 },
];
const TARGET_AREA_CODE_SET = new Set(TARGET_DISTRICTS.map((item) => item.areaCode));
const TARGET_AREA_NAME_SET = new Set(TARGET_DISTRICTS.flatMap((item) => [item.areaName, item.displayName]));
const FIXED_DISTRICT_BOUNDS = {
  first: '106.464295,29.486707',
  second: '106.865298,30.085270',
};
const FIXED_SUB_AREA_BOUNDS = {
  first: '106.101141,29.062445',
  second: '107.552145,30.962354',
};
const DEFAULT_SEARCH_DATA = {
  metrname: '',
  characteristicStr: '',
  saleSort: '0',
  housezx: '',
  buildingAge: '',
  housecx: '',
  floorState: '',
  metrstation: '',
  isLift: '',
  houseRight: '',
  fang: '',
  saletotal: '',
  builtArea: '',
  houseUse: '',
};
const DEFAULT_PARAMETER = {
  metrname: '',
  flag: '',
  keywords: '',
  housezx: '',
  housecx: '',
  floorState: '',
  labelCondition: '',
  metrstation: '',
  dataId: '',
  is_district_dk: '',
  fang: '',
  characteristicStr: '',
  saleSort: '0',
  dyname: '',
  buildId: '',
  buildingAge: '',
  dzname: '',
  depuDate: '',
  isLift: '',
  areaId: '',
  districtId: '',
  builtAreas: '',
  fhname: '',
  houseRight: '',
  saletotal: '',
  housetz: '',
  houseUse: '',
};
const DEFAULT_OLD_BUILD_PARAMETER = {
  areaId: '',
  districtId: '',
  keywords: '',
  zzsaleprice: '',
  houseClasses: '',
  oldBuildSort: '0',
  buildingAge: '',
};
const AREA_CODE_MAP = new Map([
  ['1', 'a1'],
  ['2', 'a2'],
  ['3', 'a3'],
  ['4', 'a4'],
  ['5', 'a5'],
  ['6', 'a6'],
  ['7', 'a7'],
  ['8', 'a8'],
]);

async function loadBasicSettings(pool) {
  const [rows] = await pool.query(
    'SELECT min_house_price, max_house_price FROM basic_settings WHERE id = 1 LIMIT 1'
  );
  return rows[0] || null;
}

function buildSaleTotalRange(settings) {
  const min = toNullableNumber(settings?.min_house_price);
  const max = toNullableNumber(settings?.max_house_price);
  if (min === null || max === null) return '';
  return `${min}-${max}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(items = [], chunkSize = 1) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const normalizedSize = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }
  return chunks;
}

function getChinaDateTimeString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
}

function toInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimText(value) {
  return String(value || '').trim();
}

function normalizeSourceDateTime(value) {
  const raw = trimText(value);
  if (!raw) return null;
  const normalized = raw.replace(/\//g, '-');
  const matched = normalized.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T\s]+(\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/
  );
  if (matched) {
    return `${matched[1]} ${matched[2] || '00:00:00'}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(parsed);
}

function isTargetDistrict(areaCode, areaName) {
  const normalizedAreaCode = trimText(areaCode);
  const normalizedAreaName = trimText(areaName);
  return TARGET_AREA_CODE_SET.has(normalizedAreaCode) || TARGET_AREA_NAME_SET.has(normalizedAreaName);
}

function getComparableUnitPrice(item = {}) {
  const rawText = trimText(item.unitPriceText).replace(/[^\d.]/g, '');
  const parsedFromText = rawText ? Number(rawText) : null;
  if (Number.isFinite(parsedFromText)) return parsedFromText;
  return Number.isFinite(item.unitPrice) ? item.unitPrice : Number.POSITIVE_INFINITY;
}

function compareHousePriority(left = {}, right = {}) {
  const leftUnitPrice = getComparableUnitPrice(left);
  const rightUnitPrice = getComparableUnitPrice(right);
  if (leftUnitPrice !== rightUnitPrice) return leftUnitPrice - rightUnitPrice;

  const leftTotalPrice = left.totalPriceWan === null ? Number.POSITIVE_INFINITY : left.totalPriceWan;
  const rightTotalPrice = right.totalPriceWan === null ? Number.POSITIVE_INFINITY : right.totalPriceWan;
  if (leftTotalPrice !== rightTotalPrice) return leftTotalPrice - rightTotalPrice;

  return String(left.listingId || '').localeCompare(String(right.listingId || ''));
}

function limitHousesForCommunity(houses = [], deletedListingIds = new Set()) {
  const sortedHouses = [...houses].sort(compareHousePriority);
  const result = [];
  const usedListingIds = new Set();
  for (const house of sortedHouses) {
    const listingId = trimText(house?.listingId);
    if (!listingId || usedListingIds.has(listingId)) continue;
    if (deletedListingIds.has(listingId)) continue;
    usedListingIds.add(listingId);
    result.push(house);
    if (result.length >= TOP_HOUSES_PER_COMMUNITY) break;
  }
  return result;
}

function parsePositionPxPy(item = {}) {
  const px = toNullableNumber(item.px);
  const py = toNullableNumber(item.py);
  if (px !== null && py !== null) {
    return { longitude: px, latitude: py };
  }

  const position = trimText(item.position);
  if (!position) return { longitude: null, latitude: null };

  const [lngText, latText] = position.split(/\s+/);
  return {
    longitude: toNullableNumber(lngText),
    latitude: toNullableNumber(latText),
  };
}

function normalizeDistrictItem(item = {}) {
  const areaId = String(item.dataId || '').trim();
  const { longitude, latitude } = parsePositionPxPy(item);
  return {
    areaCode: AREA_CODE_MAP.get(areaId) || `a${areaId}`,
    areaId,
    areaName: trimText(item.key),
    displayName: trimText(item.key),
    saleCount: toInt(item.saleCount),
    rentCount: toInt(item.rentCount),
    communityCount: toInt(item.buildCount),
    avgPriceText: trimText(item.buildPrice),
    longitude,
    latitude,
    rawJson: JSON.stringify(item),
  };
}

function buildTargetDistrictRows(districts = []) {
  const districtMap = new Map(
    districts.map((item) => [trimText(item.areaCode), item])
  );

  return TARGET_DISTRICTS.map((target) => {
    const matched = districtMap.get(target.areaCode);
    return {
      areaCode: target.areaCode,
      areaId: target.areaId,
      areaName: target.areaName,
      displayName: target.displayName,
      saleCount: matched?.saleCount || 0,
      rentCount: matched?.rentCount || 0,
      communityCount: matched?.communityCount || 0,
      avgPriceText: matched?.avgPriceText || '',
      longitude: matched?.longitude ?? target.longitude,
      latitude: matched?.latitude ?? target.latitude,
      rawJson: matched?.rawJson || JSON.stringify({ fixed: true, areaCode: target.areaCode, areaName: target.areaName }),
    };
  });
}

function normalizeSubAreaItem(item = {}) {
  const [tipType, districtId, areaId] = String(item.id || '').split(':');
  const { longitude, latitude } = parsePositionPxPy(item);
  return {
    tipType: trimText(tipType),
    districtId: trimText(districtId || item.dataId),
    areaId: trimText(areaId),
    areaCode: AREA_CODE_MAP.get(trimText(areaId)) || `a${trimText(areaId)}`,
    areaName: trimText(item.areaName || item.msgList || ''),
    subAreaName: trimText(item.key),
    saleCount: toInt(item.saleCount),
    rentCount: toInt(item.rentCount),
    communityCount: toInt(item.buildCount),
    avgPriceText: trimText(item.buildPrice),
    longitude,
    latitude,
    rawJson: JSON.stringify(item),
  };
}

function normalizeHouseRow(row = {}, subArea = {}) {
  const buildId = trimText(row.buildid || row.comid || '');
  const communityId = buildId || `fallback-${subArea.areaCode}-${subArea.districtId}-${trimText(row.buildname || row.community || row.housetitle)}`;
  const communityName = trimText(row.buildname || row.community || '');
  const areaName = trimText(row.areaname || subArea.areaName || '');
  const subAreaName = trimText(row.districtname || subArea.subAreaName || '');
  const totalPriceWan = toNullableNumber(row.saletotal);
  const unitPrice = toNullableNumber(row.saleprice);
  const floorText = trimText(row.floorState);
  const buildArea = toNullableNumber(row.builtarea || row.builtarea1);
  const innerArea = toNullableNumber(row.innerarea1);
  const houseType = trimText(row.compositeAttribute || `${trimText(row.fang)}室${trimText(row.ting)}厅${trimText(row.wei)}卫`);
  const coverImageUrl = trimText(row.listUrl);
  const imageUrls = Array.isArray(row.imgs)
    ? row.imgs.map((item) => trimText(item)).filter(Boolean).map((item) => (
      item.startsWith('http') ? item : `https://image.daojiale.com:17000/cqimg${item}`
    ))
    : [];

  return {
    listingId: trimText(row.houseid),
    title: trimText(row.housetitle),
    listingUrl: `https://cq.daojiale.com/esf/${trimText(row.houseid)}.html`,
    areaCode: subArea.areaCode,
    areaName,
    subAreaName,
    communityId,
    communityName,
    communityUrl: communityId && !communityId.startsWith('fallback-')
      ? `https://cq.daojiale.com/xiaoqu/${communityId}.html`
      : '',
    longitude: null,
    latitude: null,
    totalPriceWan,
    unitPrice,
    unitPriceText: unitPrice === null ? '' : `${unitPrice}元/m²`,
    houseType,
    buildAreaSqm: buildArea,
    innerAreaSqm: innerArea,
    decoration: trimText(row.housezx),
    orientation: trimText(row.housecx),
    buildingYear: trimText(row.buildage),
    buildingStructure: '',
    propertyFeeText: '',
    usageType: trimText(row.houseuse),
    elevatorText: trimText(row.isLift),
    floorText,
    viewingTime: '',
    statusText: trimText(row.statu),
    metroText: trimText(row.metrname || row.metrstation),
    houseLocationText: subAreaName,
    tagsText: trimText(row.housebq),
    attentionCount: toInt(row.followTotal),
    mainAgentName: '',
    mainAgentPhone: '',
    vrUrl: '',
    videoUrl: trimText(row.coverurl),
    coverImageUrl,
    imageUrlsJson: JSON.stringify(imageUrls),
    imageTitlesJson: JSON.stringify([]),
    saleInfoJson: JSON.stringify(row),
    communityInfoJson: JSON.stringify({
      areaId: row.areaId,
      districtId: row.districtId,
      buildId: row.buildid,
      buildName: row.buildname,
      districtName: row.districtname,
    }),
    detailHtml: null,
    sourceUpdatedHint: trimText(row.upTime || ''),
    sourceUpTime: normalizeSourceDateTime(row.upTime || ''),
    followTotal: toInt(row.followTotal),
    takeLookTotal: toInt(row.takeLookTotal),
  };
}

function normalizeOldBuildItem(row = {}, subArea = {}) {
  const communityId = trimText(row.rrjuId || row.buildid || row.comid || '');
  const communityName = trimText(row.buildname || row.community || '');
  if (!communityId || !communityName) return null;

  const longitude = toNullableNumber(row.px);
  const latitude = toNullableNumber(row.py);
  const avgUnitPrice = toNullableNumber(row.zzsaleprice);
  const avgPriceText = avgUnitPrice === null ? '' : `${avgUnitPrice}元/m²`;

  return {
    communityId,
    communityName,
    areaCode: trimText(subArea.areaCode),
    areaName: trimText(row.areaname || subArea.areaName || ''),
    subAreaName: trimText(row.districtname || subArea.subAreaName || ''),
    communityUrl: `https://cq.daojiale.com/xiaoqu/${communityId}.html`,
    longitude,
    latitude,
    avgPriceText,
    raw: row,
  };
}

function fetchHtml(targetUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        'User-Agent': API_HEADERS['User-Agent'],
        'Accept-Encoding': 'gzip,deflate',
        'Accept-Language': API_HEADERS['Accept-Language'],
        Connection: 'Keep-Alive',
        'Cache-Control': 'no-cache',
      },
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = String(response.headers['content-encoding'] || '').toLowerCase();

        function parseText(nextBuffer) {
          const text = nextBuffer.toString('utf8');
          if (response.statusCode !== 200) {
            reject(new Error(`DJL HTML request failed with status ${response.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          resolve(text);
        }

        if (encoding.includes('gzip')) {
          zlib.gunzip(buffer, (error, decoded) => {
            if (error) {
              reject(error);
              return;
            }
            parseText(decoded);
          });
          return;
        }

        if (encoding.includes('deflate')) {
          zlib.inflate(buffer, (error, decoded) => {
            if (error) {
              reject(error);
              return;
            }
            parseText(decoded);
          });
          return;
        }

        parseText(buffer);
      });
    });

    request.on('error', reject);
    request.end();
  });
}

function parseDetailCoordinates(htmlText = '') {
  const patterns = [
    /map\.centerAndZoom\(new\s+BMap\.Point\('([0-9.]+)'\s*,\s*'([0-9.]+)'\)/i,
    /var\s+point\s*=\s*new\s+BMap\.Point\('([0-9.]+)'\s*,\s*'([0-9.]+)'\)/i,
  ];

  for (const pattern of patterns) {
    const matched = htmlText.match(pattern);
    if (matched) {
      return {
        longitude: toNullableNumber(matched[1]),
        latitude: toNullableNumber(matched[2]),
      };
    }
  }

  return {
    longitude: null,
    latitude: null,
  };
}

function parseDetailCommunityInfo(htmlText = '') {
  const matched = htmlText.match(/<a[^>]+href="(https?:\/\/[^"]*\/xiaoqu\/(\d+)\.html)"[^>]*>[^<]+<\/a>/i);
  if (!matched) {
    return {
      communityId: '',
      communityUrl: '',
    };
  }

  return {
    communityId: trimText(matched[2]),
    communityUrl: trimText(matched[1]),
  };
}

function createFormBody(payload = {}) {
  return Object.entries(payload)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function requestJson(pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = createFormBody(payload);
    const request = https.request({
      hostname: API_HOST,
      path: pathname,
      method: 'POST',
      headers: {
        ...API_HEADERS,
        'Content-Length': Buffer.byteLength(body),
      },
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = String(response.headers['content-encoding'] || '').toLowerCase();

        function parseText(nextBuffer) {
          const text = nextBuffer.toString('utf8');
          if (response.statusCode !== 200) {
            reject(new Error(`DJL API request failed with status ${response.statusCode}: ${text.slice(0, 300)}`));
            return;
          }

          try {
            const payloadJson = JSON.parse(text);
            resolve(payloadJson);
          } catch (error) {
            reject(new Error(`DJL API JSON parse failed: ${error.message}`));
          }
        }

        if (encoding.includes('gzip')) {
          zlib.gunzip(buffer, (error, decoded) => {
            if (error) {
              reject(error);
              return;
            }
            parseText(decoded);
          });
          return;
        }

        if (encoding.includes('deflate')) {
          zlib.inflate(buffer, (error, decoded) => {
            if (error) {
              reject(error);
              return;
            }
            parseText(decoded);
          });
          return;
        }

        parseText(buffer);
      });
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function fetchDistrictBubbles() {
  const payload = await requestJson(`/map/oldMapInfoV1?${API_BASE_QUERY}`, {
    token: '',
    sourceType: '1',
    versionCodes: '142',
    versionName: '4.8.1',
    tipType: '1',
    first: FIXED_DISTRICT_BOUNDS.first,
    second: FIXED_DISTRICT_BOUNDS.second,
    searchData: JSON.stringify(DEFAULT_SEARCH_DATA),
  });
  const items = Array.isArray(payload.data) ? payload.data : [];
  return items
    .map(normalizeDistrictItem)
    .filter((item) => item.areaId && item.areaName && isTargetDistrict(item.areaCode, item.areaName));
}

async function fetchSubAreaBubbles() {
  const payload = await requestJson(`/map/oldMapInfoV1?${API_BASE_QUERY}`, {
    token: '',
    sourceType: '1',
    versionCodes: '142',
    versionName: '4.8.1',
    tipType: '2',
    first: FIXED_SUB_AREA_BOUNDS.first,
    second: FIXED_SUB_AREA_BOUNDS.second,
    searchData: JSON.stringify(DEFAULT_SEARCH_DATA),
  });
  const items = Array.isArray(payload.data) ? payload.data : [];
  return items
    .map(normalizeSubAreaItem)
    .filter((item) => (
      item.areaId
      && item.districtId
      && item.subAreaName
      && isTargetDistrict(item.areaCode, item.areaName)
    ));
}

async function fetchSearchSalePage(subArea, pageNo, extraParameter = {}) {
  const parameter = {
    ...DEFAULT_PARAMETER,
    areaId: subArea.areaId,
    districtId: subArea.districtId,
    ...extraParameter,
  };

  return requestJson(`/searchSale?${API_BASE_QUERY}`, {
    token: '',
    sourceType: '1',
    versionCodes: '142',
    versionName: '4.8.1',
    parameter: JSON.stringify(parameter),
    pageNo: String(pageNo),
    pageSize: String(SEARCH_PAGE_SIZE),
  });
}

async function fetchOldBuildPage(subArea, pageNo) {
  return requestJson(`/searchOldBuild?${API_BASE_QUERY}`, {
    token: '',
    sourceType: '1',
    versionCodes: '142',
    versionName: '4.8.1',
    parameter: JSON.stringify({
      ...DEFAULT_OLD_BUILD_PARAMETER,
      areaId: subArea.areaId,
      districtId: subArea.districtId,
    }),
    pageNo: String(pageNo),
    pageSize: String(SEARCH_PAGE_SIZE),
  });
}

async function fetchSubAreaOldBuilds(subArea) {
  const firstPayload = await fetchOldBuildPage(subArea, 1);
  const data = firstPayload.data || {};
  const totalPages = Math.max(1, toInt(data.totalPages || 1));
  const rows = Array.isArray(data.rows) ? [...data.rows] : [];

  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(120);
    const pagePayload = await fetchOldBuildPage(subArea, page);
    const pageRows = Array.isArray(pagePayload.data?.rows) ? pagePayload.data.rows : [];
    rows.push(...pageRows);
  }

  return rows;
}

async function fetchSubAreaHouses(subArea, options = {}) {
  const saletotal = trimText(options.saleTotalRange);
  const firstPayload = await fetchSearchSalePage(subArea, 1, saletotal ? { saletotal } : {});
  const data = firstPayload.data || {};
  const totalPages = Math.max(1, toInt(data.totalPages || 1));
  const rows = Array.isArray(data.rows) ? [...data.rows] : [];

  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(120);
    const pagePayload = await fetchSearchSalePage(subArea, page, saletotal ? { saletotal } : {});
    const pageRows = Array.isArray(pagePayload.data?.rows) ? pagePayload.data.rows : [];
    rows.push(...pageRows);
  }

  return rows;
}

function pickTopHousesByCommunity(rows = [], subArea, oldBuildMap = new Map()) {
  const communities = new Map();

  rows.forEach((row) => {
    const normalized = normalizeHouseRow(row, subArea);
    if (!normalized.listingId || !normalized.communityId || !normalized.communityName) return;
    const oldBuild = oldBuildMap.get(normalized.communityId);

    const key = normalized.communityId;
    if (!communities.has(key)) {
      communities.set(key, {
        communityId: normalized.communityId,
        communityName: normalized.communityName,
        areaCode: normalized.areaCode,
        areaName: normalized.areaName,
        subAreaName: normalized.subAreaName,
        communityUrl: oldBuild?.communityUrl || normalized.communityUrl,
        longitude: oldBuild?.longitude ?? normalized.longitude,
        latitude: oldBuild?.latitude ?? normalized.latitude,
        avgPriceText: oldBuild?.avgPriceText || subArea.avgPriceText || '',
        sourceListingId: normalized.listingId,
        sourceUrl: normalized.listingUrl,
        houses: [],
      });
    }

    if (oldBuild?.longitude !== null && oldBuild?.longitude !== undefined) normalized.longitude = oldBuild.longitude;
    if (oldBuild?.latitude !== null && oldBuild?.latitude !== undefined) normalized.latitude = oldBuild.latitude;
    communities.get(key).houses.push(normalized);
  });

  oldBuildMap.forEach((oldBuild, communityId) => {
    if (communities.has(communityId)) return;
    communities.set(communityId, {
      communityId: oldBuild.communityId,
      communityName: oldBuild.communityName,
      areaCode: oldBuild.areaCode,
      areaName: oldBuild.areaName,
      subAreaName: oldBuild.subAreaName,
      communityUrl: oldBuild.communityUrl,
      longitude: oldBuild.longitude,
      latitude: oldBuild.latitude,
      avgPriceText: oldBuild.avgPriceText || subArea.avgPriceText || '',
      sourceListingId: '',
      sourceUrl: '',
      houses: [],
    });
  });

  for (const community of communities.values()) {
    community.houses = limitHousesForCommunity(community.houses);
    if (community.houses[0]) {
      community.sourceListingId = community.houses[0].listingId;
      community.sourceUrl = community.houses[0].listingUrl;
    }
  }

  return Array.from(communities.values());
}

async function insertDistrictRows(connection, districts = []) {
  if (districts.length === 0) return;
  await connection.query(`TRUNCATE TABLE \`${DJL_MAP_DISTRICT_TABLE_NAME}\``);

  const sql = `
    INSERT INTO \`${DJL_MAP_DISTRICT_TABLE_NAME}\` (
      area_code,
      area_id,
      area_name,
      display_name,
      sale_count,
      rent_count,
      community_count,
      avg_price_text,
      longitude_bd09,
      latitude_bd09,
      raw_json
    ) VALUES ?
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
  `;

  const values = districts.map((item) => [
    item.areaCode,
    item.areaId,
    item.areaName,
    item.displayName,
    item.saleCount,
    item.rentCount,
    item.communityCount,
    item.avgPriceText,
    item.longitude,
    item.latitude,
    item.rawJson,
  ]);

  for (const chunk of chunkArray(values, DISTRICT_INSERT_CHUNK_SIZE)) {
    await connection.query(sql, [chunk]);
  }
}

function mergeCommunityGroups(communities = []) {
  const mergedCommunities = new Map();
  communities.forEach((community) => {
    const existing = mergedCommunities.get(community.communityId);
    if (!existing) {
      mergedCommunities.set(community.communityId, {
        ...community,
        houses: [...community.houses],
      });
      return;
    }

    const mergedHouseMap = new Map(existing.houses.map((item) => [item.listingId, item]));
    community.houses.forEach((house) => {
      if (!mergedHouseMap.has(house.listingId)) {
        mergedHouseMap.set(house.listingId, house);
      }
    });

    existing.houses = limitHousesForCommunity(Array.from(mergedHouseMap.values()));

    if (!existing.subAreaName && community.subAreaName) existing.subAreaName = community.subAreaName;
    if (!existing.areaName && community.areaName) existing.areaName = community.areaName;
    if (!existing.areaCode && community.areaCode) existing.areaCode = community.areaCode;
    if (!existing.communityUrl && community.communityUrl) existing.communityUrl = community.communityUrl;
    if (existing.longitude === null || existing.longitude === undefined) existing.longitude = community.longitude;
    if (existing.latitude === null || existing.latitude === undefined) existing.latitude = community.latitude;
    if (!existing.avgPriceText && community.avgPriceText) existing.avgPriceText = community.avgPriceText;
    if (!existing.sourceListingId && community.sourceListingId) existing.sourceListingId = community.sourceListingId;
    if (!existing.sourceUrl && community.sourceUrl) existing.sourceUrl = community.sourceUrl;
  });

  return Array.from(mergedCommunities.values());
}

async function enrichCommunityCoordinates(communities = []) {
  const total = communities.length;
  for (let index = 0; index < total; index += 1) {
    const community = communities[index];
    const sourceHouse = Array.isArray(community?.houses) ? community.houses[0] : null;
    if (!sourceHouse?.listingUrl) continue;

    console.log(`[DJL_SYNC] resolve community coordinate ${index + 1}/${total}: ${community.communityName || community.communityId}`);

    try {
      const htmlText = await fetchHtml(sourceHouse.listingUrl);
      const { longitude, latitude } = parseDetailCoordinates(htmlText);
      const { communityId, communityUrl } = parseDetailCommunityInfo(htmlText);

      if (longitude !== null && latitude !== null) {
        community.longitude = longitude;
        community.latitude = latitude;
        community.houses.forEach((house) => {
          house.longitude = longitude;
          house.latitude = latitude;
        });
      }

      if (communityId && String(community.communityId || '').startsWith('fallback-')) {
        community.communityId = communityId;
        if (communityUrl) community.communityUrl = communityUrl;
        community.houses.forEach((house) => {
          house.communityId = communityId;
        });
      } else if (communityUrl && !community.communityUrl) {
        community.communityUrl = communityUrl;
      }
    } catch (error) {
      console.warn(`[DJL_SYNC] resolve community coordinate failed: ${community.communityName || community.communityId}`, error.message || error);
    }

    await sleep(DETAIL_FETCH_DELAY);
  }
}

async function insertRowsInChunks(connection, sql, rows = [], chunkSize = 1) {
  for (const chunk of chunkArray(rows, chunkSize)) {
    await connection.query(sql, [chunk]);
  }
}

async function loadDeletedListingIds(connection) {
  const [rows] = await connection.query(
    "SELECT listing_id FROM `djl_deleted_houses` WHERE TRIM(COALESCE(listing_id, '')) <> ''"
  );
  return new Set(
    rows
      .map((row) => trimText(row.listing_id))
      .filter(Boolean)
  );
}

async function deleteRowsInChunks(connection, tableName, keyName, values = [], chunkSize = 500) {
  let deleted = 0;
  for (const chunk of chunkArray(values, chunkSize)) {
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    const [result] = await connection.query(
      `DELETE FROM \`${tableName}\` WHERE \`${keyName}\` IN (${placeholders})`,
      chunk
    );
    deleted += Number(result.affectedRows || 0);
  }
  return deleted;
}

async function replaceCommunitiesAndHouses(connection, communities = []) {
  const mergedCommunities = mergeCommunityGroups(communities);
  const deletedListingIds = await loadDeletedListingIds(connection);
  const communityRows = [];
  const houseRows = [];
  const freshListingIds = new Set();
  const freshCommunityIds = new Set();

  mergedCommunities.forEach((community) => {
    community.houses = limitHousesForCommunity(community.houses, deletedListingIds);
    if (!community.houses.length) return;
    freshCommunityIds.add(community.communityId);
    community.sourceListingId = community.houses[0]?.listingId || community.sourceListingId;
    community.sourceUrl = community.houses[0]?.listingUrl || community.sourceUrl;
    communityRows.push([
      community.communityId,
      community.communityName,
      community.areaCode,
      community.areaName,
      community.subAreaName,
      community.communityUrl,
      community.longitude,
      community.latitude,
      community.avgPriceText,
      '',
      '',
      '',
      null,
      community.sourceListingId,
      community.sourceUrl,
    ]);

    community.houses.forEach((house) => {
      if (!house.listingId || deletedListingIds.has(house.listingId)) return;
      freshListingIds.add(house.listingId);
      const effectiveCreatedAt = house.sourceUpTime || getChinaDateTimeString();
      houseRows.push([
        house.listingId,
        house.title,
        house.listingUrl,
        house.areaCode,
        house.areaName,
        house.subAreaName,
        house.communityId,
        house.communityName,
        house.longitude,
        house.latitude,
        house.totalPriceWan,
        house.unitPriceText,
        house.houseType,
        house.buildAreaSqm,
        house.decoration,
        house.orientation,
        house.buildingYear,
        house.buildingStructure,
        house.propertyFeeText,
        house.usageType,
        house.elevatorText,
        house.floorText,
        house.metroText,
        house.houseLocationText,
        house.tagsText,
        house.vrUrl,
        house.coverImageUrl,
        house.imageUrlsJson,
        house.communityInfoJson,
        house.sourceUpTime,
        effectiveCreatedAt,
      ]);
    });
  });

  if (communityRows.length > 0) {
    await insertRowsInChunks(
      connection,
      `
        INSERT INTO \`${DJL_COMMUNITY_TABLE_NAME}\` (
          community_id,
          community_name,
          area_code,
          area_name,
          sub_area_name,
          community_url,
          longitude_bd09,
          latitude_bd09,
          community_avg_price_text,
          community_build_year,
          community_building_count,
          community_household_count,
          community_intro,
          source_listing_id,
          source_url
        ) VALUES ?
        ON DUPLICATE KEY UPDATE
          community_name = VALUES(community_name),
          area_code = VALUES(area_code),
          area_name = VALUES(area_name),
          sub_area_name = VALUES(sub_area_name),
          community_url = VALUES(community_url),
          longitude_bd09 = VALUES(longitude_bd09),
          latitude_bd09 = VALUES(latitude_bd09),
          community_avg_price_text = VALUES(community_avg_price_text),
          community_build_year = VALUES(community_build_year),
          community_building_count = VALUES(community_building_count),
          community_household_count = VALUES(community_household_count),
          community_intro = VALUES(community_intro),
          source_listing_id = VALUES(source_listing_id),
          source_url = VALUES(source_url)
      `,
      communityRows,
      COMMUNITY_INSERT_CHUNK_SIZE
    );
  }

  if (houseRows.length > 0) {
    await insertRowsInChunks(
      connection,
      `
        INSERT INTO \`${DJL_HOUSE_DETAIL_TABLE_NAME}\` (
          listing_id,
          title,
          listing_url,
          area_code,
          area_name,
          sub_area_name,
          community_id,
          community_name,
          longitude_bd09,
          latitude_bd09,
          total_price_wan,
          unit_price_text,
          house_type,
          build_area_sqm,
          decoration,
          orientation,
          building_year,
          building_structure,
          property_fee_text,
          usage_type,
          elevator_text,
          floor_text,
          metro_text,
          house_location_text,
          tags_text,
          vr_url,
          cover_image_url,
          image_urls_json,
          community_info_json,
          source_up_time,
          created_at
        ) VALUES ?
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
          community_info_json = VALUES(community_info_json),
          source_up_time = VALUES(source_up_time),
          created_at = VALUES(created_at)
      `,
      houseRows,
      HOUSE_INSERT_CHUNK_SIZE
    );
  }

  const [existingHouseRows] = await connection.query(`SELECT listing_id FROM \`${DJL_HOUSE_DETAIL_TABLE_NAME}\``);
  const staleListingIds = existingHouseRows
    .map((row) => trimText(row.listing_id))
    .filter((listingId) => listingId && !freshListingIds.has(listingId));
  await deleteRowsInChunks(connection, DJL_HOUSE_DETAIL_TABLE_NAME, 'listing_id', staleListingIds);

  const [existingCommunityRows] = await connection.query(`SELECT community_id FROM \`${DJL_COMMUNITY_TABLE_NAME}\``);
  const staleCommunityIds = existingCommunityRows
    .map((row) => trimText(row.community_id))
    .filter((communityId) => communityId && !freshCommunityIds.has(communityId));
  await deleteRowsInChunks(connection, DJL_COMMUNITY_TABLE_NAME, 'community_id', staleCommunityIds);

  return {
    mergedCommunityCount: freshCommunityIds.size,
    insertedHouseCount: houseRows.length,
  };
}

async function createSyncTask(connection, actor) {
  const [result] = await connection.query(
    `
      INSERT INTO \`${DJL_SYNC_TASK_TABLE_NAME}\` (
        task_type,
        status,
        started_at,
        trigger_by_staff_id,
        trigger_by_name
      ) VALUES (?, 'running', NOW(), ?, ?)
    `,
    [TASK_TYPE_FULL_SYNC, Number(actor?.id || 0) || null, trimText(actor?.name || actor?.phone || '')]
  );
  return Number(result.insertId);
}

async function updateSyncTaskSuccess(connection, taskId, summary) {
  await connection.query(
    `
      UPDATE \`${DJL_SYNC_TASK_TABLE_NAME}\`
      SET status = 'success',
          finished_at = NOW(),
          summary = ?
      WHERE id = ?
    `,
    [JSON.stringify(summary), taskId]
  );
}

async function updateSyncTaskFailed(connection, taskId, error) {
  await connection.query(
    `
      UPDATE \`${DJL_SYNC_TASK_TABLE_NAME}\`
      SET status = 'failed',
          finished_at = NOW(),
          error_message = ?
      WHERE id = ?
    `,
    [trimText(error?.message || error), taskId]
  );
}

async function persistDjlFullSyncResult(pool, districts, communityGroups) {
  const connection = await pool.getConnection();
  try {
    try {
      await connection.query('SET SESSION net_write_timeout = 600');
      await connection.query('SET SESSION net_read_timeout = 600');
    } catch {}

    await insertDistrictRows(connection, districts);
    const replaceSummary = await replaceCommunitiesAndHouses(connection, communityGroups);
    const subAreaRows = await rebuildDjlSubAreaCenters(connection);
    return {
      mergedCommunityCount: replaceSummary.mergedCommunityCount,
      insertedHouseCount: replaceSummary.insertedHouseCount,
      rebuiltSubAreaCount: subAreaRows.length,
    };
  } finally {
    connection.release();
  }
}

async function runDjlFullSync(pool) {
  const basicSettings = await loadBasicSettings(pool);
  const saleTotalRange = buildSaleTotalRange(basicSettings);
  const districts = buildTargetDistrictRows(await fetchDistrictBubbles());
  const subAreas = await fetchSubAreaBubbles();
  const communityGroups = [];
  let scannedHouseRows = 0;

  for (const subArea of subAreas) {
    const oldBuildRows = await fetchSubAreaOldBuilds(subArea);
    const oldBuildMap = new Map(
      oldBuildRows
        .map((row) => normalizeOldBuildItem(row, subArea))
        .filter(Boolean)
        .map((item) => [item.communityId, item])
    );
    const rows = await fetchSubAreaHouses(subArea, { saleTotalRange });
    scannedHouseRows += rows.length;
    const pickedCommunities = pickTopHousesByCommunity(rows, subArea, oldBuildMap);
    communityGroups.push(...pickedCommunities);
    await sleep(120);
  }

  await enrichCommunityCoordinates(communityGroups);

  const persisted = await persistDjlFullSyncResult(pool, districts, communityGroups);
  return {
    districtCount: districts.length,
    subAreaCount: persisted.rebuiltSubAreaCount || subAreas.length,
    communityCount: persisted.mergedCommunityCount,
    houseCount: persisted.insertedHouseCount,
    scannedHouseRows,
    saleTotalRange,
    topHouseLimitPerCommunity: TOP_HOUSES_PER_COMMUNITY,
    fixedDistrictBounds: FIXED_DISTRICT_BOUNDS,
    fixedSubAreaBounds: FIXED_SUB_AREA_BOUNDS,
  };
}

async function ensureNoRunningSyncTask(pool) {
  const runningTasks = await pool.query(
    `SELECT id FROM \`${DJL_SYNC_TASK_TABLE_NAME}\` WHERE status IN ('pending', 'running') LIMIT 1`
  );
  if (Array.isArray(runningTasks?.[0]) && runningTasks[0].length > 0) {
    const error = new Error('当前已有抓取任务在执行，请稍后再试');
    error.statusCode = 409;
    throw error;
  }
}

async function executeDjlFullSync(pool, taskId) {
  try {
    const summary = await runDjlFullSync(pool);
    await updateSyncTaskSuccess(pool, taskId, summary);
    return { taskId, summary };
  } catch (error) {
    await updateSyncTaskFailed(pool, taskId, error);
    throw error;
  }
}

async function startDjlFullSync(pool, actor = {}) {
  await ensureNoRunningSyncTask(pool);
  const taskId = await createSyncTask(pool, actor);
  return executeDjlFullSync(pool, taskId);
}

async function enqueueDjlFullSync(pool, actor = {}) {
  await ensureNoRunningSyncTask(pool);
  const taskId = await createSyncTask(pool, actor);
  setImmediate(() => {
    executeDjlFullSync(pool, taskId).catch((error) => {
      console.error('[DJL_SYNC] background sync failed:', error);
    });
  });
  return { taskId, status: 'running' };
}

module.exports = {
  enqueueDjlFullSync,
  startDjlFullSync,
};
