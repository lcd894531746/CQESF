const { parseJsonArray, toPublicImageUrl } = require('./utils');
const { convertPointFromBd09 } = require('./coordinateUtils');

const DJL_DETAIL_TABLE_NAME = 'djl_esf_house_detail';

function toRequiredPositiveInt(value, fieldName) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    const error = new Error(`Invalid ${fieldName}: ${value}`);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function parseJsonField(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function parseCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildImageList(row) {
  const manualGallery = parseJsonArray(row.manualGalleryImagesJson).map((item) => toPublicImageUrl(item)).filter(Boolean);
  const originalGallery = parseJsonArray(row.imageUrlsJson).map((item) => toPublicImageUrl(item)).filter(Boolean);
  const effectiveCover = row.manualCoverImageUrl
    ? row.manualCoverImageUrl
    : (row.manualCoverRemoved ? '' : row.coverImageUrl);
  const coverImage = toPublicImageUrl(effectiveCover || '');
  const source = manualGallery.length > 0 ? manualGallery : originalGallery;
  const images = coverImage ? [coverImage, ...source] : source;
  return images.filter((item, index) => item && images.indexOf(item) === index);
}

function mapDetailRow(row) {
  const point = convertPointFromBd09(row.longitude, row.latitude);
  return {
    listingId: row.listingId,
    detailId: row.listingId,
    captureDate: row.updatedAt,
    houseCode: row.houseCode,
    route: row.listingUrl,
    title: row.title,
    price: row.totalPriceWan === null || row.totalPriceWan === undefined ? '' : String(row.totalPriceWan),
    unitPrice: row.unitPriceText,
    area: row.buildAreaSqm === null || row.buildAreaSqm === undefined ? '' : String(row.buildAreaSqm),
    bedRoomNum: row.bedRoomNum,
    hallNum: row.hallNum,
    orientation: row.orientation,
    floorState: row.floorText,
    propertyType: row.propertyType,
    buildYear: row.buildingYear,
    houseUse: row.usageType,
    buildingType: row.buildingStructure,
    orientationText: row.orientation,
    hasElevatorText: row.elevatorText,
    communityName: row.communityName,
    communityId: row.communityId,
    cityId: '',
    mUrl: row.listingUrl,
    galleryImages: buildImageList(row),
    dynamic: null,
    resources: {
      vr: normalizeText(row.vrUrl) ? [{ coverUrl: toPublicImageUrl(row.vrUrl) }] : [],
      photos: buildImageList(row).map((imageUrl) => ({ imageUrl })),
      floorPlans: [],
    },
    communityInfo: parseJsonField(row.communityInfoJson),
    marketTrend: null,
    sameCommunityForSale: null,
    sameCommunityTrades: null,
    commute: null,
    surroundings: null,
    communityComment: null,
    triggers: null,
    routeInfo: null,
    longitude: point.longitude,
    latitude: point.latitude,
    httpCount: null,
    decoration: row.decoration,
    buildingYear: row.buildingYear,
    buildingStructure: row.buildingStructure,
    elevatorText: row.elevatorText,
    floorText: row.floorText,
    metroText: row.metroText,
    houseLocationText: row.houseLocationText,
    tagsText: row.tagsText,
    propertyFeeText: row.propertyFeeText,
    usageType: row.usageType,
    viewingTime: '',
    statusText: '',
    mainAgentName: '',
    mainAgentPhone: '',
    coverImage: toPublicImageUrl(
      row.manualCoverImageUrl
        ? row.manualCoverImageUrl
        : (row.manualCoverRemoved ? '' : row.coverImageUrl || '')
    ),
  };
}

async function queryDetailByListingId(pool, listingIdValue) {
  const listingId = toRequiredPositiveInt(listingIdValue, 'id');

  const [rows] = await pool.query(
    `
      SELECT
        id AS listingId,
        listing_id AS houseCode,
        title,
        listing_url AS listingUrl,
        community_id AS communityId,
        community_name AS communityName,
        longitude_bd09 AS longitude,
        latitude_bd09 AS latitude,
        total_price_wan AS totalPriceWan,
        unit_price_text AS unitPriceText,
        house_type AS houseType,
        build_area_sqm AS buildAreaSqm,
        decoration,
        orientation,
        building_year AS buildingYear,
        building_structure AS buildingStructure,
        property_fee_text AS propertyFeeText,
        usage_type AS usageType,
        elevator_text AS elevatorText,
        floor_text AS floorText,
        metro_text AS metroText,
        house_location_text AS houseLocationText,
        tags_text AS tagsText,
        vr_url AS vrUrl,
        cover_image_url AS coverImageUrl,
        manual_cover_image_url AS manualCoverImageUrl,
        manual_cover_removed AS manualCoverRemoved,
        image_urls_json AS imageUrlsJson,
        manual_gallery_images_json AS manualGalleryImagesJson,
        community_info_json AS communityInfoJson,
        DATE_FORMAT(updated_at, '%Y-%m-%d') AS updatedAt
      FROM \`${DJL_DETAIL_TABLE_NAME}\`
      WHERE id = ?
      LIMIT 1
    `,
    [listingId]
  );

  if (!rows.length) {
    const error = new Error(`Listing not found for id: ${listingId}`);
    error.statusCode = 404;
    throw error;
  }

  const row = rows[0];
  const houseTypeParts = normalizeText(row.houseType)
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  const layoutText = houseTypeParts[0] || '';
  const layoutMatch = layoutText.match(/(\d+)室/);
  const hallMatch = layoutText.match(/(\d+)厅/);
  row.bedRoomNum = layoutMatch ? Number(layoutMatch[1]) : null;
  row.hallNum = hallMatch ? Number(hallMatch[1]) : null;
  row.propertyType = layoutText;

  return mapDetailRow(row);
}

module.exports = {
  queryDetailByListingId,
};
