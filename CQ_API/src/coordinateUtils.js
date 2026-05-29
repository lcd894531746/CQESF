const X_PI = Math.PI * 3000.0 / 180.0;

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bd09ToGcj02(longitude, latitude) {
  const bdLng = toNullableNumber(longitude);
  const bdLat = toNullableNumber(latitude);
  if (bdLng === null || bdLat === null) {
    return { longitude: null, latitude: null };
  }

  const x = bdLng - 0.0065;
  const y = bdLat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);

  return {
    longitude: z * Math.cos(theta),
    latitude: z * Math.sin(theta),
  };
}

function convertPointFromBd09(longitude, latitude) {
  const converted = bd09ToGcj02(longitude, latitude);
  return {
    longitude: converted.longitude === null ? null : Number(converted.longitude.toFixed(6)),
    latitude: converted.latitude === null ? null : Number(converted.latitude.toFixed(6)),
  };
}

module.exports = {
  bd09ToGcj02,
  convertPointFromBd09,
};
