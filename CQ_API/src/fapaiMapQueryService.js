const { queryDjlMapDistricts, queryDjlMapSubAreas } = require('./djlMapQueryService');
const { convertPointFromBd09 } = require('./coordinateUtils');

const FP_TABLE_NAME = 'fp_house_listings';
const DJL_COMMUNITY_TABLE_NAME = 'djl_community_map_rel';
const COMMUNITY_ID_SEPARATOR = '||';
const UNMATCHED_SUB_AREA_NAME = '其他';
const NEAREST_COMMUNITY_MAX_DISTANCE_METERS = 1500;
const CACHE_TTL_MS = 60 * 1000;

let cachedIndex = null;
let cachedAt = 0;

function trimText(value) {
  return String(value || '').trim();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractDistrictName(value) {
  const raw = trimText(value);
  if (!raw) return '';
  const parts = raw
    .split(/[，,]/)
    .map((item) => trimText(item))
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : raw;
}

function buildCommunityId(areaCode, subAreaName, communityName) {
  return [trimText(areaCode), trimText(subAreaName), trimText(communityName)].join(COMMUNITY_ID_SEPARATOR);
}

function parseCommunityId(communityId) {
  const parts = trimText(communityId).split(COMMUNITY_ID_SEPARATOR);
  return {
    areaCode: trimText(parts[0]),
    subAreaName: trimText(parts[1]),
    communityName: trimText(parts.slice(2).join(COMMUNITY_ID_SEPARATOR)),
  };
}

function averageCoordinate(points = []) {
  const validPoints = points.filter((item) => item && item.longitude !== null && item.latitude !== null);
  if (!validPoints.length) {
    return { longitude: null, latitude: null };
  }
  const longitude = validPoints.reduce((sum, item) => sum + Number(item.longitude), 0) / validPoints.length;
  const latitude = validPoints.reduce((sum, item) => sum + Number(item.latitude), 0) / validPoints.length;
  return {
    longitude: Number(longitude.toFixed(6)),
    latitude: Number(latitude.toFixed(6)),
  };
}

function haversineDistance(longitude1, latitude1, longitude2, latitude2) {
  const lon1 = toNumberOrNull(longitude1);
  const lat1 = toNumberOrNull(latitude1);
  const lon2 = toNumberOrNull(longitude2);
  const lat2 = toNumberOrNull(latitude2);
  if (lon1 === null || lat1 === null || lon2 === null || lat2 === null) return null;

  const earthRadius = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function inferAreaCodeFromDistrictName(districtName) {
  const normalized = trimText(districtName);
  if (!normalized) return '';
  if (normalized.includes('渝中')) return 'a1';
  if (normalized.includes('南岸')) return 'a4';
  if (normalized.includes('大渡口')) return 'a6';
  if (normalized.includes('九龙坡')) return 'a5';
  if (normalized.includes('沙坪坝')) return 'a2';
  if (normalized.includes('巴南')) return 'a8';
  if (normalized.includes('江北') || normalized.includes('北碚') || normalized.includes('渝北') || normalized.includes('两江')) {
    return 'a7';
  }
  return '';
}

async function buildDistrictMetaMap(pool) {
  const rows = await queryDjlMapDistricts(pool);
  const map = new Map();
  rows.forEach((item, index) => {
    const areaCode = trimText(item.areaCode);
    if (!areaCode) return;
    map.set(areaCode, {
      areaCode,
      areaName: trimText(item.areaName),
      displayName: trimText(item.displayName || item.areaName),
      longitude: toNumberOrNull(item.longitude),
      latitude: toNumberOrNull(item.latitude),
      sortOrder: index,
    });
  });
  return {
    districtMetaMap: map,
    districtRows: rows,
  };
}

async function buildSubAreaCenterMap(pool, districtRows = []) {
  const subAreaCenterMap = new Map();
  const areaCodes = districtRows
    .map((item) => trimText(item.areaCode))
    .filter(Boolean);

  const groupedRows = await Promise.all(
    areaCodes.map(async (areaCode) => queryDjlMapSubAreas(pool, { areaCode }))
  );

  groupedRows.flat().forEach((row) => {
    const areaCode = trimText(row.areaCode);
    const subAreaName = trimText(row.subAreaName);
    if (!areaCode || !subAreaName) return;
    subAreaCenterMap.set(`${areaCode}${COMMUNITY_ID_SEPARATOR}${subAreaName}`, {
      areaCode,
      areaName: trimText(row.areaName),
      subAreaName,
      longitude: toNumberOrNull(row.longitude),
      latitude: toNumberOrNull(row.latitude),
    });
  });

  return subAreaCenterMap;
}

function pickNearestCandidate(candidates, longitude, latitude, distanceLimit = null) {
  const lon = toNumberOrNull(longitude);
  const lat = toNumberOrNull(latitude);
  if (!Array.isArray(candidates) || !candidates.length) return null;
  if (lon === null || lat === null) return candidates[0] || null;

  let matched = null;
  let minDistance = null;
  candidates.forEach((item) => {
    const distance = haversineDistance(lon, lat, item.longitude, item.latitude);
    if (distance === null) return;
    if (minDistance === null || distance < minDistance) {
      minDistance = distance;
      matched = item;
    }
  });

  if (distanceLimit !== null && minDistance !== null && minDistance > distanceLimit) {
    return null;
  }
  return matched || candidates[0] || null;
}

function createPriceText(houseCount) {
  return `${Number(houseCount || 0)}套`;
}

async function buildFapaiMapIndex(pool) {
  const { districtMetaMap, districtRows } = await buildDistrictMetaMap(pool);
  const subAreaCenterMap = await buildSubAreaCenterMap(pool, districtRows);

  const [communityRows, houseRows] = await Promise.all([
    pool.query(
      `
        SELECT
          community_name,
          area_code,
          area_name,
          sub_area_name,
          longitude_bd09,
          latitude_bd09
        FROM \`${DJL_COMMUNITY_TABLE_NAME}\`
        WHERE TRIM(COALESCE(community_name, '')) <> ''
      `
    ),
    pool.query(
      `
        SELECT
          id,
          source_id,
          title,
          community_name,
          cover_pic,
          district_area_code,
          district_whole_name,
          detail_address,
          area,
          layout,
          orientation,
          starting_price,
          market_price,
          auction_time,
          auction_status_text,
          longitude,
          latitude
        FROM \`${FP_TABLE_NAME}\`
        WHERE TRIM(COALESCE(community_name, '')) <> ''
        ORDER BY auction_time ASC, source_id DESC
      `
    ),
  ]);

  const djlCommunities = (communityRows[0] || []).map((row) => {
    const point = convertPointFromBd09(row.longitude_bd09, row.latitude_bd09);
    return {
      communityName: trimText(row.community_name),
      areaCode: trimText(row.area_code),
      areaName: trimText(row.area_name),
      subAreaName: trimText(row.sub_area_name),
      longitude: toNumberOrNull(point.longitude),
      latitude: toNumberOrNull(point.latitude),
    };
  });

  const exactCommunityMap = new Map();
  djlCommunities.forEach((row) => {
    const key = trimText(row.communityName);
    if (!key) return;
    const list = exactCommunityMap.get(key) || [];
    list.push(row);
    exactCommunityMap.set(key, list);
  });

  const districtGroups = new Map();
  const subAreaGroups = new Map();
  const communityGroups = new Map();
  const housesByCommunityId = new Map();

  (houseRows[0] || []).forEach((row) => {
    const communityName = trimText(row.community_name);
    if (!communityName) return;

    const houseLongitude = toNumberOrNull(row.longitude);
    const houseLatitude = toNumberOrNull(row.latitude);
    const districtName = extractDistrictName(row.district_whole_name);
    const exactCandidates = exactCommunityMap.get(communityName) || [];

    let matchedCommunity = pickNearestCandidate(exactCandidates, houseLongitude, houseLatitude, null);
    if (!matchedCommunity && houseLongitude !== null && houseLatitude !== null) {
      matchedCommunity = pickNearestCandidate(
        djlCommunities,
        houseLongitude,
        houseLatitude,
        NEAREST_COMMUNITY_MAX_DISTANCE_METERS
      );
    }

    const inferredAreaCode = matchedCommunity?.areaCode || inferAreaCodeFromDistrictName(districtName);
    const districtMeta = districtMetaMap.get(inferredAreaCode) || null;
    const areaCode = inferredAreaCode || '';
    const areaName = matchedCommunity?.areaName || districtMeta?.areaName || districtName;
    const subAreaName = matchedCommunity?.subAreaName || UNMATCHED_SUB_AREA_NAME;
    const communityId = buildCommunityId(areaCode, subAreaName, communityName);

    const houseItem = {
      id: Number(row.id || 0),
      sourceId: row.source_id === null || row.source_id === undefined ? null : Number(row.source_id),
      title: trimText(row.title),
      communityId,
      communityName,
      coverPic: trimText(row.cover_pic),
      areaCode,
      areaName,
      subAreaName,
      detailAddress: trimText(row.detail_address),
      area: toNumberOrNull(row.area),
      layout: trimText(row.layout),
      orientation: trimText(row.orientation),
      startingPrice: toNumberOrNull(row.starting_price),
      marketPrice: toNumberOrNull(row.market_price),
      auctionTime: row.auction_time || null,
      auctionStatusText: trimText(row.auction_status_text),
      longitude: houseLongitude,
      latitude: houseLatitude,
    };

    if (!housesByCommunityId.has(communityId)) {
      housesByCommunityId.set(communityId, []);
    }
    housesByCommunityId.get(communityId).push(houseItem);

    const communityGroup = communityGroups.get(communityId) || {
      communityId,
      communityName,
      areaCode,
      areaName,
      subAreaName,
      houseCount: 0,
      coordinates: [],
      fallbackPoint: matchedCommunity
        ? { longitude: matchedCommunity.longitude, latitude: matchedCommunity.latitude }
        : null,
    };
    communityGroup.houseCount += 1;
    if (houseLongitude !== null && houseLatitude !== null) {
      communityGroup.coordinates.push({ longitude: houseLongitude, latitude: houseLatitude });
    }
    if (!communityGroup.fallbackPoint && matchedCommunity) {
      communityGroup.fallbackPoint = { longitude: matchedCommunity.longitude, latitude: matchedCommunity.latitude };
    }
    communityGroups.set(communityId, communityGroup);

    const subAreaKey = `${areaCode}${COMMUNITY_ID_SEPARATOR}${subAreaName}`;
    const subAreaGroup = subAreaGroups.get(subAreaKey) || {
      areaCode,
      areaName,
      subAreaName,
      houseCount: 0,
      communityIds: new Set(),
    };
    subAreaGroup.houseCount += 1;
    subAreaGroup.communityIds.add(communityId);
    subAreaGroups.set(subAreaKey, subAreaGroup);

    if (!areaCode) return;
    const districtGroup = districtGroups.get(areaCode) || {
      areaCode,
      areaName: districtMeta?.areaName || areaName,
      displayName: districtMeta?.displayName || areaName,
      houseCount: 0,
      communityIds: new Set(),
      subAreaKeys: new Set(),
      longitude: districtMeta?.longitude ?? null,
      latitude: districtMeta?.latitude ?? null,
      sortOrder: districtMeta?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    };
    districtGroup.houseCount += 1;
    districtGroup.communityIds.add(communityId);
    districtGroup.subAreaKeys.add(subAreaKey);
    districtGroups.set(areaCode, districtGroup);
  });

  const normalizedCommunityRows = Array.from(communityGroups.values()).map((group) => {
    const averaged = averageCoordinate(group.coordinates);
    const point = averaged.longitude !== null && averaged.latitude !== null
      ? averaged
      : (group.fallbackPoint || { longitude: null, latitude: null });
    return {
      communityId: group.communityId,
      communityName: group.communityName,
      areaCode: group.areaCode,
      areaName: group.areaName,
      subAreaName: group.subAreaName,
      longitude: point.longitude,
      latitude: point.latitude,
      houseCount: group.houseCount,
      priceText: createPriceText(group.houseCount),
    };
  });

  const communityMap = new Map(normalizedCommunityRows.map((item) => [item.communityId, item]));

  const normalizedSubAreaRows = Array.from(subAreaGroups.values()).map((group) => {
    const childCommunities = Array.from(group.communityIds)
      .map((communityId) => communityMap.get(communityId))
      .filter(Boolean);
    const averaged = averageCoordinate(childCommunities);
    const fallbackPoint = subAreaCenterMap.get(`${group.areaCode}${COMMUNITY_ID_SEPARATOR}${group.subAreaName}`);
    const districtMeta = districtMetaMap.get(group.areaCode) || null;
    const longitude = fallbackPoint?.longitude ?? averaged.longitude ?? districtMeta?.longitude ?? null;
    const latitude = fallbackPoint?.latitude ?? averaged.latitude ?? districtMeta?.latitude ?? null;
    return {
      areaCode: group.areaCode,
      areaName: group.areaName,
      subAreaName: group.subAreaName,
      longitude,
      latitude,
      houseCount: group.houseCount,
      communityCount: group.communityIds.size,
      priceText: createPriceText(group.houseCount),
    };
  });

  const subAreaMap = new Map(
    normalizedSubAreaRows.map((item) => [`${item.areaCode}${COMMUNITY_ID_SEPARATOR}${item.subAreaName}`, item])
  );

  const normalizedDistrictRows = Array.from(districtGroups.values())
    .map((group) => {
      const districtMeta = districtMetaMap.get(group.areaCode) || null;
      const childSubAreas = Array.from(group.subAreaKeys)
        .map((key) => subAreaMap.get(key))
        .filter(Boolean);
      const averaged = averageCoordinate(childSubAreas);
      return {
        areaCode: group.areaCode,
        areaName: group.areaName,
        displayName: group.displayName,
        longitude: districtMeta?.longitude ?? group.longitude ?? averaged.longitude ?? null,
        latitude: districtMeta?.latitude ?? group.latitude ?? averaged.latitude ?? null,
        houseCount: group.houseCount,
        communityCount: group.communityIds.size,
        subAreaCount: group.subAreaKeys.size,
        priceText: createPriceText(group.houseCount),
        sortOrder: group.sortOrder,
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder || right.houseCount - left.houseCount);

  normalizedSubAreaRows.sort((left, right) => (
    (districtMetaMap.get(left.areaCode)?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      - (districtMetaMap.get(right.areaCode)?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || right.houseCount - left.houseCount
      || left.subAreaName.localeCompare(right.subAreaName, 'zh-CN')
  ));

  normalizedCommunityRows.sort((left, right) => (
    (districtMetaMap.get(left.areaCode)?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      - (districtMetaMap.get(right.areaCode)?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || right.houseCount - left.houseCount
      || left.communityName.localeCompare(right.communityName, 'zh-CN')
  ));

  housesByCommunityId.forEach((items) => {
    items.sort((left, right) => {
      const leftTime = left.auctionTime ? new Date(left.auctionTime).getTime() : 0;
      const rightTime = right.auctionTime ? new Date(right.auctionTime).getTime() : 0;
      return leftTime - rightTime || (right.sourceId || 0) - (left.sourceId || 0);
    });
  });

  return {
    districts: normalizedDistrictRows,
    subAreas: normalizedSubAreaRows,
    communities: normalizedCommunityRows,
    housesByCommunityId,
  };
}

async function getFapaiMapIndex(pool, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  if (!forceRefresh && cachedIndex && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return cachedIndex;
  }

  cachedIndex = await buildFapaiMapIndex(pool);
  cachedAt = Date.now();
  return cachedIndex;
}

async function queryFapaiMapDistricts(pool) {
  const index = await getFapaiMapIndex(pool);
  return index.districts;
}

async function queryFapaiMapSubAreas(pool, options = {}) {
  const areaCode = trimText(options.areaCode);
  if (!areaCode) {
    const error = new Error('areaCode is required');
    error.statusCode = 400;
    throw error;
  }
  const index = await getFapaiMapIndex(pool);
  return index.subAreas.filter((item) => item.areaCode === areaCode);
}

async function queryFapaiMapCommunities(pool, options = {}) {
  const areaCode = trimText(options.areaCode);
  const subAreaName = trimText(options.subAreaName);
  if (!areaCode || !subAreaName) {
    const error = new Error('areaCode and subAreaName are required');
    error.statusCode = 400;
    throw error;
  }
  const index = await getFapaiMapIndex(pool);
  return index.communities.filter((item) => item.areaCode === areaCode && item.subAreaName === subAreaName);
}

async function queryFapaiMapHouses(pool, options = {}) {
  const communityId = trimText(options.communityId);
  if (!communityId) {
    const error = new Error('communityId is required');
    error.statusCode = 400;
    throw error;
  }

  const { areaCode, subAreaName, communityName } = parseCommunityId(communityId);
  const index = await getFapaiMapIndex(pool);
  const items = (index.housesByCommunityId.get(communityId) || []).map((item) => ({
    ...item,
    areaCode,
    subAreaName,
    communityName: item.communityName || communityName,
  }));

  return {
    communityId,
    communityName,
    areaCode,
    subAreaName,
    total: items.length,
    items,
  };
}

module.exports = {
  queryFapaiMapDistricts,
  queryFapaiMapSubAreas,
  queryFapaiMapCommunities,
  queryFapaiMapHouses,
};
