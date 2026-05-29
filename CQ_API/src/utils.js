const { publicBaseUrl } = require('./config');

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? null : numberValue;
}

function formatImageUrl(req, fileName) {
  if (!fileName) {
    return '';
  }

  return `/uploads/${fileName}`;
}

function toPublicImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = raw.replace(/^http:\/\/shanlan\.xyz(?=\/)/i, 'https://shanlan.xyz');
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith('/')) {
    if (publicBaseUrl) {
      return `${publicBaseUrl.replace(/\/$/, '')}${normalized}`;
    }
    return normalized;
  }

  const safePath = normalized.replace(/^uploads\//i, '');
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}/uploads/${safePath}`;
  }
  return `/uploads/${safePath}`;
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  return [];
}

function normalizeImageArray(value) {
  return parseJsonArray(value)
    .map((item) => toPublicImageUrl(item))
    .filter(Boolean);
}

module.exports = {
  normalizeNumber,
  formatImageUrl,
  parseJsonArray,
  toPublicImageUrl,
  normalizeImageArray,
};
