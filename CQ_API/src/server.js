const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pool = require('./db');
const { port, publicBaseUrl, uploadAbsoluteDir, imageCleanServiceBaseUrl } = require('./config');
const { initializeApplicationSchema } = require('./dbInit');
const { normalizeNumber, formatImageUrl, parseJsonArray, toPublicImageUrl } = require('./utils');
const {
  importDailyDetailCapture,
  importOneDetailCapture,
  resolveDetailCaptureFilePath,
} = require('./ershouImporter');
const {
  importMapDistrictCapture,
  importMapTreeCapture,
  resolveMapDistrictCaptureFilePath,
} = require('./mapImporter');
const { queryMapBubbles, queryMapHouseList, queryMapHouses, queryMapHouseCard } = require('./mapQueryService');
const { queryDetailByListingId } = require('./ershouDetailQueryService');
const { queryDjlHouseList, queryDjlDistrictOptions } = require('./djlHouseQueryService');
const { queryFapaiHouseList, queryFapaiDistrictOptions, exportFapaiHouseWorkbook } = require('./fapaiHouseQueryService');
const { queryDjlMapDistricts, queryDjlMapSubAreas, queryDjlMapCommunities } = require('./djlMapQueryService');
const { listDjlSyncTasks, getLatestRunningDjlSyncTask } = require('./djlSyncQueryService');
const { enqueueDjlFullSync, startDjlFullSync } = require('./djlSyncService');
const { rebuildDjlSubAreaCenters, refreshDjlDistrictMetrics } = require('./djlSubAreaService');
const { queryBeikeCommunityPrice } = require('./beikeCommunityPriceService');
const { getPhoneNumberByCode } = require('./wechatService');

fs.mkdirSync(uploadAbsoluteDir, { recursive: true });

const SYSTEM_STAFF_TABLE = 'system_staff';
const SPECIAL_ASSETS_TABLE = 'special_assets';
const APPROVAL_TASKS_TABLE = 'approval_tasks';
const DJL_DELETED_HOUSES_TABLE = 'djl_deleted_houses';
const WECHAT_USERS_TABLE = 'wechat_users';
const WECHAT_SALES_SHARES_TABLE = 'wechat_sales_shares';
const WECHAT_CUSTOMER_SALES_BINDINGS_TABLE = 'wechat_customer_sales_bindings';
const BK_MAP_HOUSES_TABLE = 'bk_map_house_cards';
const AUTH_VALID_DAYS = 7;
const ROLE_ADMIN = 'admin';
const ROLE_REVIEWER = 'reviewer';
const ROLE_UPLOADER = 'uploader';
const ROLE_SALES = 'sales';
const SYSTEM_ROLE_VALUES = new Set([ROLE_ADMIN, ROLE_REVIEWER, ROLE_UPLOADER, ROLE_SALES]);
const ROLE_LEVEL_MAP = new Map([
  [ROLE_ADMIN, 1],
  [ROLE_REVIEWER, 2],
  [ROLE_UPLOADER, 3],
  [ROLE_SALES, 4],
]);
const STAFF_ROLES = new Set([ROLE_ADMIN, ROLE_REVIEWER, ROLE_UPLOADER, ROLE_SALES]);
const DEFAULT_STAFF_PASSWORD = '123456';
const PASSWORD_SALT = 'cq-resale-house-system-staff';
const ADMIN_TOKEN_EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || process.env.AUTH_TOKEN_SECRET || `${PASSWORD_SALT}:admin-token`;
const IMAGE_PROXY_ALLOWED_HOSTS = new Set([
  'ke-image.ljcdn.com',
  'image1.ljcdn.com',
  'image2.ljcdn.com',
  'image3.ljcdn.com',
  'image4.ljcdn.com',
  'image.daojiale.com',
]);
const IMAGE_CLEAN_ALLOWED_HOSTS = new Set([
  'api.ysfp.com.cn',
  'img.alicdn.com',
  'img10.360buyimg.com',
  'img11.360buyimg.com',
  'img12.360buyimg.com',
]);

function hashPassword(password) {
  return crypto.createHash('sha256').update(`${PASSWORD_SALT}:${password}`).digest('hex');
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signTokenPayload(payloadText) {
  return crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(payloadText).digest('base64url');
}

function createAdminToken(person) {
  const payload = {
    id: person.id,
    phone: person.phone,
    role: person.role,
    exp: Date.now() + ADMIN_TOKEN_EXPIRES_IN_MS,
  };
  const payloadText = base64UrlJson(payload);
  return `${payloadText}.${signTokenPayload(payloadText)}`;
}

function verifyAdminToken(token) {
  const [payloadText, signature] = String(token || '').split('.');
  if (!payloadText || !signature) return null;
  const expectedSignature = signTokenPayload(payloadText);
  try {
    if (
      signature.length !== expectedSignature.length
      || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
    if (!payload?.id || !payload?.phone || !payload?.exp || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readAdminToken(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return String(req.headers['x-admin-token'] || req.query?.token || '').trim();
}

function readWechatShareKey(req) {
  return String(
    req.headers['x-share-key']
    || req.headers['x-sharekey']
    || req.query?.shareKey
    || req.query?.share_key
    || req.body?.shareKey
    || req.body?.share_key
    || ''
  ).trim();
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadAbsoluteDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function parseProxyImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const imageUrl = new URL(raw);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) return null;
    if (!IMAGE_PROXY_ALLOWED_HOSTS.has(imageUrl.hostname)) return null;
    return imageUrl;
  } catch {
    return null;
  }
}

function pipeRemoteImage(imageUrl, res) {
  const client = imageUrl.protocol === 'http:' ? http : https;
  const request = client.get(imageUrl, {
    headers: {
      Referer: 'https://ke.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 10000,
  }, (remote) => {
    if (remote.statusCode && remote.statusCode >= 300 && remote.statusCode < 400 && remote.headers.location) {
      remote.resume();
      const nextUrl = parseProxyImageUrl(new URL(remote.headers.location, imageUrl).toString());
      if (!nextUrl) {
        res.status(400).json({ success: false, message: '图片地址不允许代理' });
        return;
      }
      pipeRemoteImage(nextUrl, res);
      return;
    }

    if (remote.statusCode !== 200) {
      remote.resume();
      res.status(remote.statusCode || 502).json({ success: false, message: '原始图片加载失败' });
      return;
    }

    res.setHeader('Content-Type', remote.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    remote.pipe(res);
  });

  request.on('timeout', () => request.destroy(new Error('image proxy timeout')));
  request.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: '原始图片加载失败' });
    }
  });
}

function buildAuthorizedUntilDate(value) {
  const baseDate = value ? new Date(value) : new Date();
  if (!Number.isFinite(baseDate.getTime())) return null;
  const next = new Date(baseDate.getTime());
  next.setDate(next.getDate() + AUTH_VALID_DAYS);
  return next;
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function formatShareDateKey(date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
  ].join('');
}

function generateRandomToken(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let token = '';
  for (let index = 0; index < length; index += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function buildShareKey(expireAt) {
  return `${formatShareDateKey(expireAt)}_${generateRandomToken(8)}`;
}

function isAuthorizedExpired(value) {
  if (!value) return true;
  const time = new Date(value).getTime();
  return !Number.isFinite(time) || time <= Date.now();
}

function isShareExpired(share) {
  return !share || isAuthorizedExpired(share.expire_at);
}

function isShareInvalid(share) {
  return !share || Number(share.status) === 0 || isShareExpired(share);
}

function toIsoStringOrEmpty(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString();
}

function isEnabledPersonStatus(status) {
  if (status === null || status === undefined || status === '') return true;
  return Number(status) !== 0;
}

function buildStoredImageUrl(fileName) {
  const safeName = String(fileName || '').trim();
  if (!safeName) return '';
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}/uploads/${safeName}`;
  }
  return `/uploads/${safeName}`;
}

function normalizeStaffRole(role) {
  const raw = String(role || '').trim();
  if (!raw) return ROLE_SALES;
  if (raw === ROLE_ADMIN || raw === '管理员' || raw === '管理人员' || raw === 'admin') return ROLE_ADMIN;
  if (raw === ROLE_REVIEWER || raw === '审核员' || raw === 'reviewer') return ROLE_REVIEWER;
  if (raw === ROLE_UPLOADER || raw === '图片上传专员' || raw === 'uploader') return ROLE_UPLOADER;
  if (raw === ROLE_SALES || raw === '销售' || raw === 'sales') return ROLE_SALES;
  return SYSTEM_ROLE_VALUES.has(raw) ? raw : ROLE_SALES;
}

function getRoleLevel(role) {
  return ROLE_LEVEL_MAP.get(normalizeStaffRole(role)) || 999;
}

function hasRoleAtMostLevel(role, requiredLevel) {
  return getRoleLevel(role) <= Number(requiredLevel || 999);
}

function isSalesPerson(row) {
  return Boolean(row && normalizeStaffRole(row.role) === ROLE_SALES && isEnabledPersonStatus(row.status));
}

function isSystemStaff(row) {
  return Boolean(row && isEnabledPersonStatus(row.status));
}

async function requireAdminAuth(req, res, next) {
  return requireRoleLevel(1)(req, res, next);
}

async function requireStaffAuth(req, res, next) {
  const tokenPayload = verifyAdminToken(readAdminToken(req));
  if (!tokenPayload) {
    return res.status(401).json({ success: false, ok: false, message: '请先登录' });
  }

  const staff = await findSystemStaffById(pool, tokenPayload.id);
  if (!staff || staff.phone !== tokenPayload.phone || !isEnabledPersonStatus(staff.status)) {
    return res.status(401).json({ success: false, ok: false, message: '登录已失效，请重新登录' });
  }

  req.adminUser = Object.assign({}, sanitizeSystemStaffForAdmin(staff), {
    role: normalizeStaffRole(staff.role),
    roleLevel: getRoleLevel(staff.role),
  });
  next();
}

function requireRoleLevel(requiredLevel) {
  return async function roleLevelGuard(req, res, next) {
    return requireStaffAuth(req, res, () => {
      if (!hasRoleAtMostLevel(req.adminUser?.role, requiredLevel)) {
        return res.status(403).json({ success: false, ok: false, message: '暂无操作权限' });
      }
      next();
    });
  };
}

const requireLevel1Auth = requireRoleLevel(1);
const requireLevel2Auth = requireRoleLevel(2);

async function allowAdminOrShareAccess(req, res, next) {
  const tokenPayload = verifyAdminToken(readAdminToken(req));
  if (tokenPayload) {
    const staff = await findSystemStaffById(pool, tokenPayload.id);
    if (staff && staff.phone === tokenPayload.phone && isSystemStaff(staff)) {
      req.adminUser = sanitizeSystemStaffForAdmin(staff);
      return next();
    }
  }

  const shareKey = readWechatShareKey(req);
  if (!shareKey) {
    return res.status(403).json({ success: false, ok: false, message: '请通过销售分享进入' });
  }

  const share = await findSalesShareByKey(pool, shareKey);
  if (isShareInvalid(share)) {
    return res.status(403).json({ success: false, ok: false, message: '分享无效，请联系销售' });
  }

  req.wechatShare = share;
  next();
}

function sanitizePersonRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role,
    status: row.status,
    remark: row.remark,
    wechatOpenid: String(row.wechat_openid || ''),
    wechatUnionid: String(row.wechat_unionid || ''),
    wechatBoundAt: toIsoStringOrEmpty(row.wechat_bound_at),
  };
}

function sanitizeSystemStaffForAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: normalizeStaffRole(row.role),
    wechat_openid: row.wechat_openid,
    wechat_unionid: row.wechat_unionid,
    wechat_bound_at: row.wechat_bound_at,
    status: row.status,
    remark: row.remark,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeImageKey(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/shanlan\.xyz/i, '')
    .replace(/^\/+/, '/');
}

function toPublicImageList(value) {
  return parseJsonArray(value)
    .map((item) => toPublicImageUrl(item))
    .filter(Boolean);
}

function diffImageList(source, target) {
  const targetCountMap = new Map();
  target.forEach((item) => {
    const key = normalizeImageKey(item);
    if (!key) return;
    targetCountMap.set(key, (targetCountMap.get(key) || 0) + 1);
  });

  const result = [];
  source.forEach((item) => {
    const key = normalizeImageKey(item);
    if (!key) return;
    const count = targetCountMap.get(key) || 0;
    if (count > 0) {
      targetCountMap.set(key, count - 1);
      return;
    }
    result.push(item);
  });
  return result;
}

function getApprovalRowEffectivePoster(row) {
  const manualPoster = String(row.djl_manual_cover_image_url || '').trim();
  if (manualPoster) return toPublicImageUrl(manualPoster);
  if (Number(row.djl_manual_cover_removed || 0) === 1) return '';
  return toPublicImageUrl(String(row.djl_cover_image_url || '').trim());
}

function getApprovalRowEffectiveGallery(row) {
  const manualGallery = toPublicImageList(row.djl_manual_gallery_images_json);
  if (manualGallery.length > 0) return manualGallery;
  return toPublicImageList(row.djl_image_urls_json);
}

function buildApprovalTaskReviewDetails(row, payload) {
  const actionType = String(row.action_type || '').trim();

  if (actionType === 'bk_house_delete') {
    return {
      summaryTags: ['删除房源'],
      posterChanges: [],
      galleryAdded: [],
      galleryDeleted: [],
    };
  }

  if (actionType === 'bk_house_update_image' || actionType === 'bk_house_update_images') {
    const currentPoster = toPublicImageUrl(payload.currentPosterImageUrl || getApprovalRowEffectivePoster(row));
    const pendingPoster = toPublicImageUrl(payload.posterImageUrl || payload.posterFileName || '');
    const posterChanged = isTruthyFlag(payload.posterChanged);
    const posterRemoved = isTruthyFlag(payload.posterRemoved);
    const currentGallery = Array.isArray(payload.currentGalleryImageUrls) && payload.currentGalleryImageUrls.length > 0
      ? payload.currentGalleryImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
      : getApprovalRowEffectiveGallery(row);
    const nextGallery = Array.isArray(payload.galleryImageUrls)
      ? payload.galleryImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
      : [];
    const galleryAdded = Array.isArray(payload.galleryAddedImageUrls) && payload.galleryAddedImageUrls.length > 0
      ? payload.galleryAddedImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
      : diffImageList(nextGallery, currentGallery);
    const galleryDeleted = Array.isArray(payload.galleryDeletedImageUrls) && payload.galleryDeletedImageUrls.length > 0
      ? payload.galleryDeletedImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
      : diffImageList(currentGallery, nextGallery);
    const summaryTags = [];
    const posterChanges = [];

    if (posterChanged && posterRemoved && currentPoster) {
      summaryTags.push('封面删除');
      posterChanges.push({
        type: 'delete',
        label: '删除当前封面',
        image: currentPoster,
      });
    }

    if (posterChanged && pendingPoster) {
      const isReplace = Boolean(currentPoster) && !posterRemoved;
      summaryTags.push(isReplace ? '封面替换' : '封面上传');
      posterChanges.push({
        type: isReplace ? 'replace' : 'add',
        label: isReplace ? '替换为新封面' : '上传新封面',
        image: pendingPoster,
      });
    }

    if (galleryAdded.length > 0) {
      summaryTags.push(`图集新增${galleryAdded.length}张`);
    }

    if (galleryDeleted.length > 0) {
      summaryTags.push(`图集删除${galleryDeleted.length}张`);
    }

    return {
      summaryTags,
      posterChanges,
      galleryAdded,
      galleryDeleted,
    };
  }

  if (actionType === 'special_asset_create') {
    return {
      summaryTags: ['新增特殊资产'],
      posterChanges: [],
      galleryAdded: [],
      galleryDeleted: [],
    };
  }

  if (actionType === 'special_asset_update') {
    return {
      summaryTags: ['修改特殊资产'],
      posterChanges: [],
      galleryAdded: [],
      galleryDeleted: [],
    };
  }

  if (actionType === 'special_asset_delete') {
    return {
      summaryTags: ['删除特殊资产'],
      posterChanges: [],
      galleryAdded: [],
      galleryDeleted: [],
    };
  }

  return {
    summaryTags: [],
    posterChanges: [],
    galleryAdded: [],
    galleryDeleted: [],
  };
}

function buildApprovalTaskImageState(row, payload) {
  const actionType = String(row.action_type || '').trim();
  if (actionType !== 'bk_house_update_image' && actionType !== 'bk_house_update_images') {
    return null;
  }

  const currentPoster = toPublicImageUrl(payload.currentPosterImageUrl || getApprovalRowEffectivePoster(row));
  const pendingPoster = toPublicImageUrl(payload.posterImageUrl || payload.posterFileName || '');
  const posterRemoved = isTruthyFlag(payload.posterRemoved);
  const currentGallery = Array.isArray(payload.currentGalleryImageUrls) && payload.currentGalleryImageUrls.length > 0
    ? payload.currentGalleryImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
    : getApprovalRowEffectiveGallery(row);
  const nextGallery = Array.isArray(payload.galleryImageUrls)
    ? payload.galleryImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
    : [];
  const pendingDeleted = Array.isArray(payload.galleryDeletedImageUrls) && payload.galleryDeletedImageUrls.length > 0
    ? payload.galleryDeletedImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
    : diffImageList(currentGallery, nextGallery);
  const pendingAdded = Array.isArray(payload.galleryAddedImageUrls) && payload.galleryAddedImageUrls.length > 0
    ? payload.galleryAddedImageUrls.map((item) => toPublicImageUrl(item)).filter(Boolean)
    : diffImageList(nextGallery, currentGallery);

  const deletedGallerySet = new Set(pendingDeleted.map(normalizeImageKey));
  const effectiveGalleryPreview = currentGallery.filter((item) => !deletedGallerySet.has(normalizeImageKey(item)));
  const reviewPosterItems = [];
  if (posterRemoved && currentPoster) {
    reviewPosterItems.push({
      key: `locked-poster-deleted-${currentPoster}`,
      image: currentPoster,
      type: 'deleted',
    });
  }
  if (pendingPoster && pendingPoster !== currentPoster) {
    reviewPosterItems.push({
      key: `locked-poster-added-${pendingPoster}`,
      image: pendingPoster,
      type: 'added',
    });
  }

  return {
    effectivePosterPreview: posterRemoved ? '' : currentPoster,
    effectiveGalleryPreview,
    reviewPosterItems,
    reviewGalleryPreview: [
      ...pendingDeleted.map((image, index) => ({
        key: `locked-deleted-${index}-${image}`,
        image,
        type: 'deleted',
      })),
      ...pendingAdded.map((image, index) => ({
        key: `locked-added-${index}-${image}`,
        image,
        type: 'added',
      })),
    ],
  };
}

function sanitizeApprovalTaskRow(row, options = {}) {
  if (!row) return null;
  const includeReviewImageState = options.includeReviewImageState !== false;
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload || '{}') : (row.payload || {});
  const actionTypeLabelMap = {
    bk_house_update_image: '图片审核',
    bk_house_update_images: '图片审核',
    bk_house_delete: '删除审核',
    special_asset_create: '特殊资产新增',
    special_asset_update: '特殊资产修改',
    special_asset_delete: '特殊资产删除',
  };
  const fallbackTitle = String(
    row.target_title
    || payload.title
    || payload.communityName
    || payload.community_name
    || ''
  ).trim();
  return {
    id: row.id,
    actionType: row.action_type,
    actionTypeLabel: actionTypeLabelMap[String(row.action_type || '').trim()] || String(row.action_type || ''),
    targetType: row.target_type,
    targetId: row.target_id,
    summary: row.summary,
    targetTitle: fallbackTitle,
    payload,
    status: row.status,
    createdByStaffId: row.created_by_staff_id,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone || '',
    createdByRole: normalizeStaffRole(row.created_by_role),
    reviewedByStaffId: row.reviewed_by_staff_id,
    reviewedByName: row.reviewed_by_name,
    reviewedByPhone: row.reviewed_by_phone || '',
    reviewNote: row.review_note || '',
    reviewDetails: buildApprovalTaskReviewDetails(row, payload),
    reviewImageState: includeReviewImageState ? buildApprovalTaskImageState(row, payload) : null,
    createdAt: toIsoStringOrEmpty(row.created_at),
    updatedAt: toIsoStringOrEmpty(row.updated_at),
    reviewedAt: toIsoStringOrEmpty(row.reviewed_at),
  };
}

function buildApprovalTaskFromSql(whereSql = '') {
  return `
      FROM ${APPROVAL_TASKS_TABLE} AS t
      LEFT JOIN ${SYSTEM_STAFF_TABLE} AS creator
        ON creator.id = t.created_by_staff_id
      LEFT JOIN ${SYSTEM_STAFF_TABLE} AS reviewer
        ON reviewer.id = t.reviewed_by_staff_id
      LEFT JOIN \`bk_map_house_cards\` AS map_h
        ON t.target_type = 'bk_house'
       AND t.target_id REGEXP '^[0-9]+$'
       AND map_h.id = CAST(t.target_id AS UNSIGNED)
      LEFT JOIN \`djl_esf_house_detail\` AS djl
        ON t.target_type = 'bk_house'
       AND t.target_id REGEXP '^[0-9]+$'
       AND djl.id = CAST(t.target_id AS UNSIGNED)
      ${whereSql}
      ${whereSql ? 'AND' : 'WHERE'} NOT (
        t.action_type IN ('bk_house_update_image', 'bk_house_update_images')
        AND t.status = 'pending'
        AND djl.id IS NULL
        AND map_h.id IS NULL
      )
  `;
}

async function refreshDjlDerivedTables(connection) {
  await rebuildDjlSubAreaCenters(connection);
  await refreshDjlDistrictMetrics(connection);
}

async function deleteDjlHouseById(connection, houseId, actor = {}, deleteSource = 'manual_admin_delete', remark = '') {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        listing_id,
        community_id,
        title,
        area_code,
        area_name,
        sub_area_name
      FROM \`djl_esf_house_detail\`
      WHERE id = ?
      LIMIT 1
    `,
    [houseId]
  );

  const house = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!house) {
    return { deleted: false };
  }

  await connection.query(
    `
      INSERT INTO \`${DJL_DELETED_HOUSES_TABLE}\`
        (listing_id, source_house_id, community_id, title, area_code, area_name, sub_area_name, deleted_by_staff_id, deleted_by_name, delete_source, remark)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        source_house_id = VALUES(source_house_id),
        community_id = VALUES(community_id),
        title = VALUES(title),
        area_code = VALUES(area_code),
        area_name = VALUES(area_name),
        sub_area_name = VALUES(sub_area_name),
        deleted_by_staff_id = VALUES(deleted_by_staff_id),
        deleted_by_name = VALUES(deleted_by_name),
        delete_source = VALUES(delete_source),
        remark = VALUES(remark)
    `,
    [
      String(house.listing_id || '').trim(),
      Number(house.id || 0) || null,
      String(house.community_id || '').trim(),
      String(house.title || '').trim(),
      String(house.area_code || '').trim(),
      String(house.area_name || '').trim(),
      String(house.sub_area_name || '').trim(),
      Number(actor?.id || 0) || null,
      String(actor?.name || actor?.phone || '').trim(),
      String(deleteSource || 'manual_admin_delete').trim(),
      String(remark || '').trim(),
    ]
  );

  await connection.query('DELETE FROM `djl_esf_house_detail` WHERE id = ?', [houseId]);
  await connection.query(
    `
      DELETE c
      FROM \`djl_community_map_rel\` c
      LEFT JOIN \`djl_esf_house_detail\` h ON h.community_id = c.community_id
      WHERE c.community_id = ?
        AND h.community_id IS NULL
    `,
    [String(house.community_id || '').trim()]
  );
  await refreshDjlDerivedTables(connection);

  return {
    deleted: true,
    houseId: Number(house.id),
    listingId: String(house.listing_id || '').trim(),
  };
}

function buildApprovalTaskSelectSql(whereSql = '') {
  return `SELECT t.*,
            creator.phone AS created_by_phone,
            reviewer.phone AS reviewed_by_phone,
            djl.cover_image_url AS djl_cover_image_url,
            djl.manual_cover_image_url AS djl_manual_cover_image_url,
            djl.manual_cover_removed AS djl_manual_cover_removed,
            djl.image_urls_json AS djl_image_urls_json,
            djl.manual_gallery_images_json AS djl_manual_gallery_images_json,
            CASE
              WHEN t.action_type IN ('bk_house_update_image', 'bk_house_update_images') THEN COALESCE(djl.title, map_h.title, '')
              WHEN t.action_type = 'bk_house_delete' THEN COALESCE(djl.title, map_h.title, '')
              ELSE ''
            END AS target_title
       ${buildApprovalTaskFromSql(whereSql)}`;
}

async function findApprovalTaskViewById(connection, id, options = {}) {
  const [rows] = await connection.query(
    `${buildApprovalTaskSelectSql('WHERE t.id = ?')}
      LIMIT 1`,
    [id]
  );
  return sanitizeApprovalTaskRow(rows[0], options);
}

async function createApprovalTask(connection, params) {
  const payloadText = JSON.stringify(params.payload || {});
  const [result] = await connection.query(
    `INSERT INTO ${APPROVAL_TASKS_TABLE}
      (action_type, target_type, target_id, summary, payload, status, created_by_staff_id, created_by_name, created_by_role)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      String(params.actionType || '').trim(),
      String(params.targetType || '').trim(),
      String(params.targetId || '').trim(),
      String(params.summary || '').trim(),
      payloadText,
      Number(params.createdBy?.id || 0),
      String(params.createdBy?.name || '').trim(),
      normalizeStaffRole(params.createdBy?.role),
    ]
  );
  const [rows] = await connection.query(`SELECT * FROM ${APPROVAL_TASKS_TABLE} WHERE id = ? LIMIT 1`, [result.insertId]);
  return sanitizeApprovalTaskRow(rows[0]);
}

async function findPendingApprovalTask(connection, options = {}) {
  const actionType = String(options.actionType || '').trim();
  const targetType = String(options.targetType || '').trim();
  const targetId = String(options.targetId || '').trim();
  if (!actionType || !targetType || !targetId) return null;

  const [rows] = await connection.query(
    `SELECT *
       FROM ${APPROVAL_TASKS_TABLE}
      WHERE action_type = ?
        AND target_type = ?
        AND target_id = ?
        AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1`,
    [actionType, targetType, targetId]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function closePendingHouseImageApprovalTasks(connection, houseId, reviewer = {}) {
  await connection.query(
    `UPDATE ${APPROVAL_TASKS_TABLE}
        SET status = 'rejected',
            reviewed_by_staff_id = ?,
            reviewed_by_name = ?,
            review_note = CASE
              WHEN TRIM(COALESCE(review_note, '')) = '' THEN '房源已删除，相关图片审核任务已自动关闭'
              ELSE review_note
            END,
            reviewed_at = NOW()
      WHERE action_type IN ('bk_house_update_image', 'bk_house_update_images')
        AND target_type = 'bk_house'
        AND target_id = ?
        AND status = 'pending'`,
    [
      Number(reviewer.id || 0),
      String(reviewer.name || '').trim(),
      String(houseId || ''),
    ]
  );
}

function parsePagination(query) {
  const page = Math.max(parseInt(query?.page || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query?.pageSize || '20', 10) || 20, 1), 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function sanitizeSpecialAssetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    communityName: row.community_name,
    assetDesc: row.asset_desc,
    totalPrice: row.total_price,
    unitPrice: row.unit_price,
    area: row.area,
    bedRoomNum: row.bed_room_num,
    hallNum: row.hall_num,
    orientation: row.orientation,
    floorState: row.floor_state,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    coverImage: row.cover_image,
    galleryImages: parseJsonArray(row.gallery_images),
    status: row.status,
    remark: row.remark,
    createdAt: toIsoStringOrEmpty(row.created_at),
    updatedAt: toIsoStringOrEmpty(row.updated_at),
  };
}

function validateSpecialAssetPayload(body) {
  const title = String(body?.title || '').trim();
  const totalPrice = String(body?.totalPrice || body?.total_price || '').trim();
  const unitPrice = String(body?.unitPrice || body?.unit_price || '').trim();
  const areaText = String(body?.area ?? '').trim();
  const bedRoomText = String(body?.bedRoomNum ?? body?.bed_room_num ?? '').trim();

  if (!title) {
    const error = new Error('资产标题不能为空');
    error.statusCode = 400;
    throw error;
  }

  if (!totalPrice || !unitPrice || !areaText || !bedRoomText) {
    const error = new Error('总价、单价、面积、户型不能为空');
    error.statusCode = 400;
    throw error;
  }

  return {
    title,
    communityName: String(body?.communityName || body?.community_name || '').trim(),
    assetDesc: String(body?.assetDesc || body?.asset_desc || '').trim(),
    totalPrice,
    unitPrice,
    area: normalizeNumber(areaText),
    bedRoomNum: Number(bedRoomText),
    hallNum: body?.hallNum === '' || body?.hallNum === undefined ? null : Number(body.hallNum),
    orientation: String(body?.orientation || '').trim(),
    floorState: String(body?.floorState || body?.floor_state || '').trim(),
    contactName: String(body?.contactName || body?.contact_name || '').trim(),
    contactPhone: String(body?.contactPhone || body?.contact_phone || '').trim(),
    status: body?.status ?? 1,
    remark: String(body?.remark || '').trim(),
  };
}

async function ensureBkHouseDetailRow(connection, houseId) {
  const [rows] = await connection.query(
    `SELECT h.id, h.capture_date, h.house_code, h.title, h.resblock_name, h.resblock_id, d.id AS detail_id
       FROM \`bk_map_house_cards\` AS h
       LEFT JOIN \`bk_ershou_details\` AS d
         ON d.house_code = h.house_code
      WHERE h.id = ?
      LIMIT 1`,
    [houseId]
  );

  if (!rows.length) {
    const error = new Error('房源不存在');
    error.statusCode = 404;
    throw error;
  }

  const house = rows[0];
  if (house.detail_id) return house;

  await connection.query(
    `INSERT INTO \`bk_ershou_details\`
      (capture_date, house_code, title, community_name, community_id, details_imgs)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE house_code = house_code`,
    [
      house.capture_date,
      house.house_code,
      house.title || null,
      house.resblock_name || null,
      house.resblock_id || null,
      JSON.stringify([]),
    ]
  );

  return house;
}

async function loadBkHouseImageState(connection, houseId) {
  const [rows] = await connection.query(
    `SELECT h.id, h.house_code, h.new_cover_pic, d.details_imgs
       FROM \`bk_map_house_cards\` AS h
       LEFT JOIN \`bk_ershou_details\` AS d
         ON d.house_code = h.house_code
      WHERE h.id = ?
      LIMIT 1`,
    [houseId]
  );

  if (!rows.length) {
    const error = new Error('房源不存在');
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
}

async function loadDjlHouseImageState(connection, houseId) {
  const [rows] = await connection.query(
    `SELECT id, cover_image_url, manual_cover_image_url, manual_cover_removed, image_urls_json, manual_gallery_images_json
       FROM \`djl_esf_house_detail\`
      WHERE id = ?
      LIMIT 1`,
    [houseId]
  );

  if (!rows.length) {
    const error = new Error('房源不存在');
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
}

function getDjlEffectivePoster(house = {}) {
  const manualPoster = String(house.manual_cover_image_url || '').trim();
  if (manualPoster) return manualPoster;
  if (Number(house.manual_cover_removed)) return '';
  return String(house.cover_image_url || '').trim();
}

function getDjlEffectiveGallery(house = {}) {
  const manualGallery = parseJsonArray(house.manual_gallery_images_json);
  if (manualGallery.length > 0) return manualGallery;
  return parseJsonArray(house.image_urls_json);
}

function normalizeStringArray(value) {
  return parseJsonArray(value)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function validateBkHousePayload(body) {
  const title = String(body?.title || '').trim();
  const communityName = String(body?.communityName || '').trim();
  const districtName = String(body?.districtName || '').trim();
  const houseDesc = String(body?.houseDesc || '').trim();
  const totalPriceText = String(body?.totalPrice || '').trim();
  const unitPriceText = String(body?.unitPrice || '').trim();

  if (!title) {
    const error = new Error('房源标题不能为空');
    error.statusCode = 400;
    throw error;
  }
  if (!districtName) {
    const error = new Error('区域不能为空');
    error.statusCode = 400;
    throw error;
  }
  if (!totalPriceText) {
    const error = new Error('总价不能为空');
    error.statusCode = 400;
    throw error;
  }

  const totalPriceNumber = Number(totalPriceText);
  if (!Number.isFinite(totalPriceNumber) || totalPriceNumber <= 0) {
    const error = new Error('总价必须是大于 0 的数字');
    error.statusCode = 400;
    throw error;
  }

  return {
    title,
    communityName,
    districtName,
    houseDesc,
    totalPriceText: `${totalPriceNumber}万`,
    unitPriceText,
  };
}

async function listSpecialAssets(req, res) {
  const { page, pageSize, offset } = parsePagination(req.query);
  const keyword = String(req.query?.keyword || req.query?.title || '').trim();
  const status = req.query?.status === undefined || req.query?.status === ''
    ? null
    : Number(req.query.status);
  const where = [];
  const params = [];

  if (keyword) {
    where.push('(title LIKE ? OR community_name LIKE ? OR asset_desc LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  if (status === 0 || status === 1) {
    where.push('status = ?');
    params.push(status);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${SPECIAL_ASSETS_TABLE} ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const [rows] = await pool.query(
    `SELECT *
       FROM ${SPECIAL_ASSETS_TABLE}
       ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({
    success: true,
    data: {
      page,
      pageSize,
      total,
      totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      items: rows.map(sanitizeSpecialAssetRow),
    },
  });
}

async function getSpecialAsset(req, res) {
  const [rows] = await pool.query(`SELECT * FROM ${SPECIAL_ASSETS_TABLE} WHERE id = ? LIMIT 1`, [req.params.id]);
  if (!rows.length) {
    return res.status(404).json({ success: false, message: '特殊资产不存在' });
  }
  res.json({ success: true, data: sanitizeSpecialAssetRow(rows[0]) });
}

async function createSpecialAsset(req, res) {
  const actor = req.adminUser || null;
  const actorLevel = getRoleLevel(actor?.role);
  if (actorLevel > 3) {
    return res.status(403).json({ success: false, message: '暂无操作权限' });
  }

  const payload = validateSpecialAssetPayload(req.body);
  const coverFile = req.files?.cover?.[0];
  const galleryFiles = req.files?.gallery || [];
  const coverImage = coverFile ? formatImageUrl(req, coverFile.filename) : '';
  const galleryImages = galleryFiles.map((file) => formatImageUrl(req, file.filename));

  if (actorLevel === 3) {
    const task = await createApprovalTask(pool, {
      actionType: 'special_asset_create',
      targetType: 'special_asset',
      targetId: '',
      summary: `申请新增特殊资产：${payload.title}`,
      payload: Object.assign({}, payload, { coverImage, galleryImages }),
      createdBy: actor,
    });
    return res.json({ success: true, pending: true, data: task, message: '已提交审核，等待审核员或管理员处理' });
  }

  const [result] = await pool.query(
    `INSERT INTO ${SPECIAL_ASSETS_TABLE}
       (title, community_name, asset_desc, total_price, unit_price, area, bed_room_num, hall_num,
        orientation, floor_state, contact_name, contact_phone, cover_image, gallery_images, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.title,
      payload.communityName,
      payload.assetDesc,
      payload.totalPrice,
      payload.unitPrice,
      payload.area,
      Number.isFinite(payload.bedRoomNum) ? payload.bedRoomNum : null,
      Number.isFinite(payload.hallNum) ? payload.hallNum : null,
      payload.orientation,
      payload.floorState,
      payload.contactName,
      payload.contactPhone,
      coverImage,
      JSON.stringify(galleryImages),
      payload.status,
      payload.remark,
    ]
  );

  const [rows] = await pool.query(`SELECT * FROM ${SPECIAL_ASSETS_TABLE} WHERE id = ?`, [result.insertId]);
  res.json({ success: true, data: sanitizeSpecialAssetRow(rows[0]), message: '特殊资产已新增' });
}

async function updateSpecialAsset(req, res) {
  const actor = req.adminUser || null;
  const actorLevel = getRoleLevel(actor?.role);
  if (actorLevel > 3) {
    return res.status(403).json({ success: false, message: '暂无操作权限' });
  }

  const payload = validateSpecialAssetPayload(req.body);
  const [currentRows] = await pool.query(`SELECT * FROM ${SPECIAL_ASSETS_TABLE} WHERE id = ? LIMIT 1`, [req.params.id]);
  if (!currentRows.length) {
    return res.status(404).json({ success: false, message: '特殊资产不存在' });
  }

  const current = currentRows[0];
  const coverFile = req.files?.cover?.[0];
  const galleryFiles = req.files?.gallery || [];
  const existingGallery = parseJsonArray(req.body?.existingGalleryImages || req.body?.existing_gallery_images || current.gallery_images);
  const coverImage = coverFile
    ? formatImageUrl(req, coverFile.filename)
    : String(req.body?.coverImage || req.body?.cover_image || current.cover_image || '');
  const galleryImages = [
    ...existingGallery,
    ...galleryFiles.map((file) => formatImageUrl(req, file.filename)),
  ];

  if (actorLevel === 3) {
    const task = await createApprovalTask(pool, {
      actionType: 'special_asset_update',
      targetType: 'special_asset',
      targetId: String(req.params.id),
      summary: `申请修改特殊资产：${payload.title}`,
      payload: Object.assign({ id: Number(req.params.id) }, payload, { coverImage, galleryImages }),
      createdBy: actor,
    });
    return res.json({ success: true, pending: true, data: task, message: '已提交审核，等待审核员或管理员处理' });
  }

  await pool.query(
    `UPDATE ${SPECIAL_ASSETS_TABLE}
        SET title = ?, community_name = ?, asset_desc = ?, total_price = ?, unit_price = ?,
            area = ?, bed_room_num = ?, hall_num = ?, orientation = ?, floor_state = ?,
            contact_name = ?, contact_phone = ?, cover_image = ?, gallery_images = ?, status = ?, remark = ?
      WHERE id = ?`,
    [
      payload.title,
      payload.communityName,
      payload.assetDesc,
      payload.totalPrice,
      payload.unitPrice,
      payload.area,
      Number.isFinite(payload.bedRoomNum) ? payload.bedRoomNum : null,
      Number.isFinite(payload.hallNum) ? payload.hallNum : null,
      payload.orientation,
      payload.floorState,
      payload.contactName,
      payload.contactPhone,
      coverImage,
      JSON.stringify(galleryImages),
      payload.status,
      payload.remark,
      req.params.id,
    ]
  );

  const [rows] = await pool.query(`SELECT * FROM ${SPECIAL_ASSETS_TABLE} WHERE id = ?`, [req.params.id]);
  res.json({ success: true, data: sanitizeSpecialAssetRow(rows[0]), message: '特殊资产已更新' });
}

async function deleteSpecialAsset(req, res) {
  const actor = req.adminUser || null;
  const actorLevel = getRoleLevel(actor?.role);
  if (actorLevel > 3) {
    return res.status(403).json({ success: false, message: '暂无操作权限' });
  }

  if (actorLevel === 3) {
    const task = await createApprovalTask(pool, {
      actionType: 'special_asset_delete',
      targetType: 'special_asset',
      targetId: String(req.params.id),
      summary: `申请删除特殊资产 #${req.params.id}`,
      payload: { id: Number(req.params.id) },
      createdBy: actor,
    });
    return res.json({ success: true, pending: true, data: task, message: '已提交审核，等待审核员或管理员处理' });
  }

  const [result] = await pool.query(`DELETE FROM ${SPECIAL_ASSETS_TABLE} WHERE id = ?`, [req.params.id]);
  if (!result.affectedRows) {
    return res.status(404).json({ success: false, message: '特殊资产不存在' });
  }
  res.json({ success: true, message: '特殊资产已删除' });
}

async function createBkHouse(req, res) {
  const actor = req.adminUser || null;
  const actorLevel = getRoleLevel(actor?.role);
  if (actorLevel > 1) {
    return res.status(403).json({ success: false, message: '仅管理员可新增房屋' });
  }

  const payload = validateBkHousePayload(req.body);
  const coverFile = req.files?.cover?.[0];
  const coverImage = coverFile ? formatImageUrl(req, coverFile.filename) : '';
  const [dateRows] = await pool.query(
    `SELECT DATE_FORMAT(MAX(capture_date), '%Y-%m-%d') AS captureDate FROM \`${BK_MAP_HOUSES_TABLE}\``
  );
  const captureDate = dateRows[0]?.captureDate || new Date().toISOString().slice(0, 10);

  const [codeRows] = await pool.query(
    `SELECT house_code FROM \`${BK_MAP_HOUSES_TABLE}\` WHERE house_code LIKE 'manual-%' ORDER BY id DESC LIMIT 1`
  );
  const lastCode = String(codeRows[0]?.house_code || '');
  const lastMatch = lastCode.match(/manual-(\d+)$/);
  const nextSequence = lastMatch ? Number(lastMatch[1]) + 1 : 1;
  const houseCode = `manual-${String(nextSequence).padStart(6, '0')}`;

  const [result] = await pool.query(
    `INSERT INTO \`${BK_MAP_HOUSES_TABLE}\`
      (capture_date, district_name, resblock_id, resblock_name, house_code, title, house_desc,
       cover_pic, new_cover_pic, price_str, unit_price_str, action_url, card_type,
       item_index, total, page, page_size, has_more, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      captureDate,
      payload.districtName,
      '',
      payload.communityName,
      houseCode,
      payload.title,
      payload.houseDesc,
      coverImage,
      coverImage,
      payload.totalPriceText,
      payload.unitPriceText,
      '',
      'manual',
      999999,
      1,
      1,
      20,
      0,
    ]
  );

  res.json({
    success: true,
    data: {
      id: Number(result.insertId),
      houseCode,
    },
    message: '房源新增成功',
  });
}

async function findApprovalTaskById(connection, id) {
  const [rows] = await connection.query(`SELECT * FROM ${APPROVAL_TASKS_TABLE} WHERE id = ? LIMIT 1`, [id]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function listApprovalTasks(req, res) {
  const status = String(req.query?.status || '').trim();
  const title = String(req.query?.title || '').trim();
  const createdByName = String(req.query?.createdByName || req.query?.created_by_name || '').trim();
  const createdAtFrom = String(req.query?.createdAtFrom || req.query?.created_at_from || '').trim();
  const createdAtTo = String(req.query?.createdAtTo || req.query?.created_at_to || '').trim();
  const { page, pageSize, offset } = parsePagination(req.query);
  const where = [];
  const params = [];

  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }

  if (title) {
    where.push(`(
      djl.title LIKE ?
      OR map_h.title LIKE ?
      OR t.summary LIKE ?
      OR JSON_UNQUOTE(JSON_EXTRACT(t.payload, '$.title')) LIKE ?
      OR JSON_UNQUOTE(JSON_EXTRACT(t.payload, '$.communityName')) LIKE ?
      OR JSON_UNQUOTE(JSON_EXTRACT(t.payload, '$.community_name')) LIKE ?
    )`);
    params.push(`%${title}%`, `%${title}%`, `%${title}%`, `%${title}%`, `%${title}%`, `%${title}%`);
  }

  if (createdByName) {
    where.push('(t.created_by_name LIKE ? OR creator.phone LIKE ?)');
    params.push(`%${createdByName}%`, `%${createdByName}%`);
  }

  if (createdAtFrom) {
    where.push('t.created_at >= ?');
    params.push(`${createdAtFrom} 00:00:00`);
  }

  if (createdAtTo) {
    where.push('t.created_at <= ?');
    params.push(`${createdAtTo} 23:59:59`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
      ${buildApprovalTaskFromSql(whereSql)}`,
    params
  );
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `${buildApprovalTaskSelectSql(whereSql)}
      ORDER BY
        CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END ASC,
        t.id DESC
      LIMIT ?
      OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({
    success: true,
    result: {
      page,
      pageSize,
      total,
      totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      items: rows.map((row) => sanitizeApprovalTaskRow(row, { includeReviewImageState: false })),
    },
  });
}

function parseCleanImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const imageUrl = new URL(raw);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) return null;
    if (!IMAGE_CLEAN_ALLOWED_HOSTS.has(imageUrl.hostname)) return null;
    return imageUrl;
  } catch {
    return null;
  }
}

function pipeCleanedImage(targetImageUrl, res) {
  let cleanServiceUrl;
  try {
    cleanServiceUrl = new URL('/api/v1/clean_image', imageCleanServiceBaseUrl.endsWith('/') ? imageCleanServiceBaseUrl : `${imageCleanServiceBaseUrl}/`);
    cleanServiceUrl.searchParams.set('url', targetImageUrl.toString());
  } catch {
    res.status(500).json({ success: false, message: '图片清洗服务地址配置错误' });
    return;
  }

  const client = cleanServiceUrl.protocol === 'http:' ? http : https;
  const request = client.get(cleanServiceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 20000,
  }, (remote) => {
    if (remote.statusCode !== 200) {
      const chunks = [];
      remote.on('data', (chunk) => chunks.push(chunk));
      remote.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!res.headersSent) {
          res.status(remote.statusCode || 502).json({
            success: false,
            message: '图片清洗服务处理失败',
            detail: text.slice(0, 300),
          });
        }
      });
      return;
    }

    res.setHeader('Content-Type', remote.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    remote.pipe(res);
  });

  request.on('timeout', () => request.destroy(new Error('image clean timeout')));
  request.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: '图片清洗服务不可用' });
    }
  });
}

async function getApprovalTask(req, res) {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: '审核任务ID不能为空' });
  }

  const task = await findApprovalTaskViewById(pool, id);
  if (!task) {
    return res.status(404).json({ success: false, message: '审核任务不存在' });
  }

  res.json({
    success: true,
    data: task,
  });
}

async function executeApprovalTask(connection, task) {
  const payload = typeof task.payload === 'string' ? JSON.parse(task.payload || '{}') : (task.payload || {});

  if (task.action_type === 'special_asset_create') {
    const [result] = await connection.query(
      `INSERT INTO ${SPECIAL_ASSETS_TABLE}
         (title, community_name, asset_desc, total_price, unit_price, area, bed_room_num, hall_num,
          orientation, floor_state, contact_name, contact_phone, cover_image, gallery_images, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(payload.title || '').trim(),
        String(payload.communityName || '').trim(),
        String(payload.assetDesc || '').trim(),
        String(payload.totalPrice || '').trim(),
        String(payload.unitPrice || '').trim(),
        normalizeNumber(payload.area),
        Number.isFinite(Number(payload.bedRoomNum)) ? Number(payload.bedRoomNum) : null,
        Number.isFinite(Number(payload.hallNum)) ? Number(payload.hallNum) : null,
        String(payload.orientation || '').trim(),
        String(payload.floorState || '').trim(),
        String(payload.contactName || '').trim(),
        String(payload.contactPhone || '').trim(),
        String(payload.coverImage || '').trim(),
        JSON.stringify(Array.isArray(payload.galleryImages) ? payload.galleryImages : []),
        Number(payload.status ?? 1),
        String(payload.remark || '').trim(),
      ]
    );
    return { targetId: result.insertId };
  }

  if (task.action_type === 'special_asset_update') {
    await connection.query(
      `UPDATE ${SPECIAL_ASSETS_TABLE}
          SET title = ?, community_name = ?, asset_desc = ?, total_price = ?, unit_price = ?,
              area = ?, bed_room_num = ?, hall_num = ?, orientation = ?, floor_state = ?,
              contact_name = ?, contact_phone = ?, cover_image = ?, gallery_images = ?, status = ?, remark = ?
        WHERE id = ?`,
      [
        String(payload.title || '').trim(),
        String(payload.communityName || '').trim(),
        String(payload.assetDesc || '').trim(),
        String(payload.totalPrice || '').trim(),
        String(payload.unitPrice || '').trim(),
        normalizeNumber(payload.area),
        Number.isFinite(Number(payload.bedRoomNum)) ? Number(payload.bedRoomNum) : null,
        Number.isFinite(Number(payload.hallNum)) ? Number(payload.hallNum) : null,
        String(payload.orientation || '').trim(),
        String(payload.floorState || '').trim(),
        String(payload.contactName || '').trim(),
        String(payload.contactPhone || '').trim(),
        String(payload.coverImage || '').trim(),
        JSON.stringify(Array.isArray(payload.galleryImages) ? payload.galleryImages : []),
        Number(payload.status ?? 1),
        String(payload.remark || '').trim(),
        Number(payload.id || task.target_id),
      ]
    );
    return { targetId: Number(payload.id || task.target_id) };
  }

  if (task.action_type === 'special_asset_delete') {
    await connection.query(`DELETE FROM ${SPECIAL_ASSETS_TABLE} WHERE id = ?`, [Number(payload.id || task.target_id)]);
    return { targetId: Number(payload.id || task.target_id) };
  }

  if (task.action_type === 'bk_house_delete') {
    await deleteDjlHouseById(
      connection,
      Number(payload.id || task.target_id),
      {
        id: task.reviewed_by_staff_id,
        name: task.reviewed_by_name,
      },
      'manual_admin_delete',
      String(task.review_note || '').trim()
    );
    await closePendingHouseImageApprovalTasks(connection, String(payload.id || task.target_id), {
      id: task.reviewed_by_staff_id,
      name: task.reviewed_by_name,
    });
    return { targetId: Number(payload.id || task.target_id) };
  }

  if (task.action_type === 'bk_house_update_image' || task.action_type === 'bk_house_update_images') {
    const houseId = Number(payload.id || task.target_id);
    const nextPoster = String(payload.posterImageUrl || '').trim();
    const posterChanged = isTruthyFlag(payload.posterChanged);
    const posterRemoved = isTruthyFlag(payload.posterRemoved);
    const nextGallery = normalizeStringArray(payload.galleryImageUrls);
    const currentHouse = await loadDjlHouseImageState(connection, houseId);

    const nextManualPoster = posterChanged
      ? (nextPoster || '')
      : String(currentHouse.manual_cover_image_url || '').trim();
    const nextManualPosterRemoved = posterChanged
      ? Number(!nextPoster && posterRemoved)
      : Number(currentHouse.manual_cover_removed || 0);

    await connection.query(
      `UPDATE \`djl_esf_house_detail\`
           SET manual_cover_image_url = ?,
               manual_cover_removed = ?,
               manual_gallery_images_json = ?
         WHERE id = ?`,
      [nextManualPoster, nextManualPosterRemoved, JSON.stringify(nextGallery), houseId]
    );
    return { targetId: houseId };
  }

  const error = new Error(`未知审核任务类型：${task.action_type}`);
  error.statusCode = 400;
  throw error;
}

async function reviewApprovalTask(req, res, nextStatus) {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: '审核任务ID不能为空' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const task = await findApprovalTaskById(connection, id);
    if (!task) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: '审核任务不存在' });
    }

    if (task.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: '该审核任务已处理' });
    }

    let executionResult = null;
    if (nextStatus === 'approved') {
      executionResult = await executeApprovalTask(connection, task);
    }

    await connection.query(
      `UPDATE ${APPROVAL_TASKS_TABLE}
          SET status = ?, reviewed_by_staff_id = ?, reviewed_by_name = ?, review_note = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [
        nextStatus,
        Number(req.adminUser?.id || 0),
        String(req.adminUser?.name || '').trim(),
        String(req.body?.reviewNote || req.body?.note || '').trim(),
        id,
      ]
    );

    await connection.commit();
    const latestTask = await findApprovalTaskViewById(connection, id);
    res.json({
      success: true,
      data: {
        task: latestTask,
        executionResult,
      },
      message: nextStatus === 'approved' ? '审核已通过' : '审核已驳回',
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function approveApprovalTask(req, res) {
  return reviewApprovalTask(req, res, 'approved');
}

async function rejectApprovalTask(req, res) {
  return reviewApprovalTask(req, res, 'rejected');
}

async function findSystemStaffByWechatOpenid(connection, openid) {
  const [rows] = await connection.query(
    `SELECT id, name, phone, role, status, remark, wechat_openid, wechat_unionid, wechat_bound_at
       FROM ${SYSTEM_STAFF_TABLE}
      WHERE wechat_openid = ?
      ORDER BY id DESC
      LIMIT 1`,
    [openid]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function findSystemStaffByPhone(connection, phone) {
  const [rows] = await connection.query(
    `SELECT id, name, phone, role, status, remark, wechat_openid, wechat_unionid, wechat_bound_at
       FROM ${SYSTEM_STAFF_TABLE}
      WHERE phone = ?
      ORDER BY id DESC
      LIMIT 1`,
    [phone]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function findSystemStaffById(connection, id) {
  const [rows] = await connection.query(
    `SELECT id, name, phone, role, status, remark, wechat_openid, wechat_unionid, wechat_bound_at
       FROM ${SYSTEM_STAFF_TABLE}
      WHERE id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [id]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function buildWechatPhoneProfileWithShareKey(connection, phone) {
  const currentPerson = await findSystemStaffByPhone(connection, phone);
  const binding = await findCustomerSalesBinding(connection, phone);
  const bindingShare = binding?.share_key ? await findSalesShareByKey(connection, binding.share_key) : null;
  const boundSalesPerson = binding?.sales_openid
    ? await findSystemStaffByPhone(connection, binding.sales_openid)
    : null;
  const matchedPerson = currentPerson ? sanitizePersonRow(currentPerson) : null;
  const salesPerson = boundSalesPerson ? sanitizePersonRow(boundSalesPerson) : null;
  const currentPersonIsStaff = isSystemStaff(currentPerson);
  const currentPersonIsSales = isSalesPerson(currentPerson);
  const bindingExpired = binding
    ? !binding.sales_openid || isShareInvalid(bindingShare)
    : true;
  const accessGranted = currentPersonIsStaff || Boolean(binding && !bindingExpired && binding.sales_openid);
  let accessMessage = '';

  if (currentPersonIsSales) {
    accessMessage = '销售身份已识别';
  } else if (currentPersonIsStaff) {
    accessMessage = '内部人员身份已识别';
  } else if (!binding || !binding.sales_openid) {
    accessMessage = '请通过销售分享进入';
  } else if (bindingExpired) {
    accessMessage = '分享已过期，请联系销售';
  } else if (salesPerson?.name) {
    accessMessage = `已绑定销售：${salesPerson.name}`;
  } else {
    accessMessage = '已绑定销售';
  }

  return {
    openid: phone,
    unionid: '',
    phoneNumber: phone,
    matchedPerson,
    salesPerson,
    isSales: currentPersonIsSales,
    canShareMiniProgram: currentPersonIsStaff,
    accessGranted,
    accessMessage,
    authorizedUntil: currentPersonIsSales ? '' : toIsoStringOrEmpty(bindingShare?.expire_at),
    shareAction: 'none',
    binding: binding ? {
      id: binding.id,
      openid: binding.openid,
      unionid: binding.unionid,
      salesOpenid: binding.sales_openid,
      salesPersonId: binding.sales_person_id,
      shareKey: binding.share_key,
      boundAt: toIsoStringOrEmpty(binding.bound_at),
      authorizedUntil: toIsoStringOrEmpty(bindingShare?.expire_at),
      expired: Boolean(bindingExpired),
    } : null,
    share: null,
  };
}

async function processCustomerShareAccess(connection, phone, shareKey) {
  const baseProfile = await buildWechatPhoneProfileWithShareKey(connection, phone);

  const currentStaff = await findSystemStaffByPhone(connection, phone);
  if (baseProfile.canShareMiniProgram || isSystemStaff(currentStaff)) {
    return {
      accessGranted: true,
      accessMessage: baseProfile.accessMessage,
      shareAction: 'none',
      share: null,
      profile: baseProfile,
    };
  }

  if (!shareKey) {
    return {
      accessGranted: Boolean(baseProfile.accessGranted),
      accessMessage: baseProfile.accessMessage || '\u8bf7\u901a\u8fc7\u9500\u552e\u5206\u4eab\u8fdb\u5165',
      shareAction: 'none',
      share: null,
      profile: baseProfile,
    };
  }

  const currentShare = await findSalesShareByKey(connection, shareKey);
  if (isShareInvalid(currentShare)) {
    return {
      accessGranted: false,
      accessMessage: '\u5206\u4eab\u65e0\u6548\uff0c\u8bf7\u8054\u7cfb\u9500\u552e',
      shareAction: 'invalid',
      share: sanitizeShareRow(currentShare),
    };
  }

  const sharePhone = String(currentShare.sales_openid || '').trim();
  const salesPerson = currentShare.sales_person_id
    ? await findSystemStaffById(connection, currentShare.sales_person_id)
    : await findSystemStaffByPhone(connection, sharePhone);
  if (!sharePhone || !isSystemStaff(salesPerson)) {
    return {
      accessGranted: false,
      accessMessage: '\u5206\u4eab\u65e0\u6548\uff0c\u8bf7\u8054\u7cfb\u9500\u552e',
      shareAction: 'invalid',
      share: sanitizeShareRow(currentShare),
    };
  }

  if (phone === sharePhone) {
    return {
      accessGranted: false,
      accessMessage: '\u4e0d\u80fd\u7ed1\u5b9a\u81ea\u5df1\u7684\u5206\u4eab',
      shareAction: 'invalid',
      share: sanitizeShareRow(currentShare),
    };
  }

  const currentBinding = await findCustomerSalesBinding(connection, phone);
  const oldShare = currentBinding?.share_key ? await findSalesShareByKey(connection, currentBinding.share_key) : null;
  const currentBindingExpired = currentBinding
    ? !currentBinding.sales_openid || isShareInvalid(oldShare)
    : true;

  let shareAction = 'none';
  let accessMessage = '';
  let shouldBind = false;

  if (
    currentBinding
    && !currentBindingExpired
    && currentBinding.sales_openid
    && currentBinding.sales_openid !== sharePhone
  ) {
    shareAction = 'invalid';
    accessMessage = '\u5f53\u524d\u7528\u6237\u5df2\u7ed1\u5b9a\u9500\u552e';
  } else if (
    currentBinding
    && !currentBindingExpired
    && currentBinding.sales_openid === sharePhone
  ) {
    shareAction = 'already_bound';
    accessMessage = '\u5df2\u5728\u6709\u6548\u671f\u5185';
  } else {
    shouldBind = true;
    shareAction = currentBinding?.sales_openid ? 'rebound' : 'bound';
    accessMessage = shareAction === 'rebound' ? '\u5df2\u91cd\u65b0\u7ed1\u5b9a\u5f53\u524d\u9500\u552e' : '\u5df2\u7ed1\u5b9a\u5f53\u524d\u9500\u552e';
  }

  if (shouldBind) {
    await upsertCustomerSalesBinding(connection, {
      openid: phone,
      unionid: '',
      salesOpenid: sharePhone,
      salesPersonId: salesPerson.id,
      shareKey,
      boundAt: new Date(),
    });
  }

  const profile = await buildWechatPhoneProfileWithShareKey(connection, phone);
  const accessGranted = shareAction === 'invalid'
    ? false
    : Boolean(profile.accessGranted);

  return {
    accessGranted,
    accessMessage: accessMessage || profile.accessMessage,
    shareAction,
    share: sanitizeShareRow(currentShare),
    profile,
  };
}

async function findWechatUser(connection, openid) {
  const [rows] = await connection.query(
    `SELECT id, openid, unionid, sales_openid, sales_person_id, bound_at, authorized_until, last_login_at
       FROM ${WECHAT_USERS_TABLE}
      WHERE openid = ?
      ORDER BY id DESC
      LIMIT 1`,
    [openid]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function findSalesShareByKey(connection, shareKey) {
  const [rows] = await connection.query(
    `SELECT id, share_key, sales_openid, sales_person_id, expire_at, status, created_at, updated_at
       FROM ${WECHAT_SALES_SHARES_TABLE}
      WHERE share_key = ?
      LIMIT 1`,
    [shareKey]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function findCustomerSalesBinding(connection, openid) {
  const [rows] = await connection.query(
    `SELECT id, openid, unionid, sales_openid, sales_person_id, share_key, bound_at
       FROM ${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}
      WHERE openid = ?
      ORDER BY id DESC
      LIMIT 1`,
    [openid]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function createSalesShareRecord(connection, salesPerson, salesOpenid) {
  const createdAt = new Date();
  const expireAt = buildAuthorizedUntilDate(createdAt);
  let shareKey = buildShareKey(expireAt);

  for (let retry = 0; retry < 3; retry += 1) {
    try {
      await connection.query(
        `INSERT INTO ${WECHAT_SALES_SHARES_TABLE}
           (share_key, sales_openid, sales_person_id, expire_at)
         VALUES (?, ?, ?, ?)`,
        [shareKey, salesOpenid, salesPerson.id, expireAt]
      );
      break;
    } catch (error) {
      if (retry >= 2 || error.code !== 'ER_DUP_ENTRY') throw error;
      shareKey = buildShareKey(expireAt);
    }
  }

  return findSalesShareByKey(connection, shareKey);
}

async function upsertCustomerSalesBinding(connection, params) {
  const payload = {
    openid: params.openid,
    unionid: params.unionid || '',
    salesOpenid: params.salesOpenid,
    salesPersonId: params.salesPersonId ?? null,
    shareKey: params.shareKey,
    boundAt: params.boundAt || new Date(),
  };

  await connection.query(
    `INSERT INTO ${WECHAT_CUSTOMER_SALES_BINDINGS_TABLE}
       (openid, unionid, sales_openid, sales_person_id, share_key, bound_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unionid = VALUES(unionid),
       sales_openid = VALUES(sales_openid),
       sales_person_id = VALUES(sales_person_id),
       share_key = VALUES(share_key),
       bound_at = VALUES(bound_at),
       raw_json = VALUES(raw_json)`,
    [
      payload.openid,
      payload.unionid,
      payload.salesOpenid,
      payload.salesPersonId,
      payload.shareKey,
      payload.boundAt,
      JSON.stringify(payload),
    ]
  );

  await connection.query(
    `INSERT INTO ${WECHAT_USERS_TABLE}
       (openid, unionid, sales_openid, sales_person_id, bound_at, last_login_at, raw_json)
     VALUES (?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       unionid = VALUES(unionid),
       sales_openid = VALUES(sales_openid),
       sales_person_id = VALUES(sales_person_id),
       bound_at = VALUES(bound_at),
       last_login_at = VALUES(last_login_at),
       raw_json = VALUES(raw_json)`,
    [
      payload.openid,
      payload.unionid,
      payload.salesOpenid,
      payload.salesPersonId,
      payload.boundAt,
      JSON.stringify(payload),
    ]
  );
}

function sanitizeShareRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shareKey: String(row.share_key || ''),
    salesOpenid: String(row.sales_openid || ''),
    salesPersonId: row.sales_person_id,
    expireAt: toIsoStringOrEmpty(row.expire_at),
    status: row.status,
    expired: isShareExpired(row),
  };
}

async function upsertWechatUser(connection, params) {
  const openid = String(params?.openid || '').trim();
  if (!openid) return null;

  const unionid = String(params?.unionid || '').trim();
  const salesOpenid = String(params?.salesOpenid || '').trim();
  const payload = {
    openid,
    unionid,
    salesOpenid,
    source: 'wechat_login',
    loggedAt: new Date().toISOString(),
  };

  const [result] = await connection.query(
    `INSERT INTO ${WECHAT_USERS_TABLE}
       (openid, unionid, sales_openid, sales_person_id, bound_at, authorized_until, last_login_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       unionid = VALUES(unionid),
       sales_openid = VALUES(sales_openid),
       sales_person_id = VALUES(sales_person_id),
       bound_at = VALUES(bound_at),
       authorized_until = VALUES(authorized_until),
       last_login_at = VALUES(last_login_at),
       raw_json = VALUES(raw_json)`,
    [
      openid,
      unionid,
      salesOpenid,
      params?.salesPersonId ?? null,
      params?.boundAt || null,
      params?.authorizedUntil || null,
      JSON.stringify(payload),
    ]
  );

  return {
    id: result.insertId || null,
    openid,
    unionid,
    salesOpenid,
  };
}

async function buildWechatLoginProfile(connection, openid, unionid) {
  const currentPerson = await findSystemStaffByWechatOpenid(connection, openid);
  const binding = await findWechatUser(connection, openid);
  const boundSalesPerson = binding?.sales_openid
    ? await findSystemStaffByWechatOpenid(connection, binding.sales_openid)
    : null;
  const matchedPerson = currentPerson ? sanitizePersonRow(currentPerson) : null;
  const salesPerson = boundSalesPerson ? sanitizePersonRow(boundSalesPerson) : null;
  const currentPersonIsStaff = isSystemStaff(currentPerson);
  const currentPersonIsSales = isSalesPerson(currentPerson);
  const authorizedUntilDate = binding?.authorized_until || null;
  const bindingExpired = binding
    ? !binding.sales_openid || isAuthorizedExpired(authorizedUntilDate)
    : true;
  const accessGranted = currentPersonIsStaff || Boolean(binding && !bindingExpired && binding.sales_openid);
  let accessMessage = '';

  if (currentPersonIsStaff) {
    accessMessage = currentPersonIsSales ? '销售身份已识别' : '内部人员身份已识别';
  } else if (!binding || !binding.sales_openid) {
    accessMessage = '请联系销售';
  } else if (bindingExpired) {
    accessMessage = '已过7天有效期，请联系销售';
  } else if (salesPerson?.name) {
    accessMessage = `已绑定销售：${salesPerson.name}`;
  } else {
    accessMessage = '已绑定销售';
  }

  return {
    openid,
    unionid: String(unionid || ''),
    matchedPerson,
    salesPerson,
    phoneNumber: matchedPerson?.phone || '',
    isSales: currentPersonIsSales,
    canShareMiniProgram: currentPersonIsStaff,
    accessGranted,
    accessMessage,
    authorizedUntil: currentPersonIsStaff ? '' : toIsoStringOrEmpty(authorizedUntilDate),
    shareAction: 'none',
    binding: binding ? {
      id: binding.id,
      openid: binding.openid,
      unionid: binding.unionid,
      salesOpenid: binding.sales_openid,
      salesPersonId: binding.sales_person_id,
      boundAt: toIsoStringOrEmpty(binding.bound_at),
      authorizedUntil: toIsoStringOrEmpty(authorizedUntilDate),
      expired: Boolean(bindingExpired),
    } : null,
    share: null,
  };
}

async function buildWechatLoginProfileWithShareKey(connection, openid, unionid) {
  const currentPerson = await findSystemStaffByWechatOpenid(connection, openid);
  const binding = await findCustomerSalesBinding(connection, openid);
  const fallbackUser = binding ? null : await findWechatUser(connection, openid);
  const bindingShare = binding?.share_key ? await findSalesShareByKey(connection, binding.share_key) : null;
  const boundSalesPerson = binding?.sales_openid
    ? await findSystemStaffByWechatOpenid(connection, binding.sales_openid)
    : null;
  const matchedPerson = currentPerson ? sanitizePersonRow(currentPerson) : null;
  const salesPerson = boundSalesPerson ? sanitizePersonRow(boundSalesPerson) : null;
  const currentPersonIsStaff = isSystemStaff(currentPerson);
  const currentPersonIsSales = isSalesPerson(currentPerson);
  const bindingExpired = binding
    ? !binding.sales_openid || isShareInvalid(bindingShare)
    : true;
  const accessGranted = currentPersonIsStaff || Boolean(binding && !bindingExpired && binding.sales_openid);
  let accessMessage = '';

  if (currentPersonIsStaff) {
    accessMessage = currentPersonIsSales ? '销售身份已识别' : '内部人员身份已识别';
  } else if (!binding || !binding.sales_openid) {
    accessMessage = fallbackUser?.sales_openid ? '请通过销售新的分享链接进入' : '请联系销售';
  } else if (bindingExpired) {
    accessMessage = '分享已过期，请联系销售人员';
  } else if (salesPerson?.name) {
    accessMessage = `已绑定销售：${salesPerson.name}`;
  } else {
    accessMessage = '已绑定销售';
  }

  return {
    openid,
    unionid: String(unionid || ''),
    matchedPerson,
    salesPerson,
    phoneNumber: matchedPerson?.phone || '',
    isSales: currentPersonIsSales,
    canShareMiniProgram: currentPersonIsStaff,
    accessGranted,
    accessMessage,
    authorizedUntil: currentPersonIsStaff ? '' : toIsoStringOrEmpty(bindingShare?.expire_at),
    shareAction: 'none',
    binding: binding ? {
      id: binding.id,
      openid: binding.openid,
      unionid: binding.unionid,
      salesOpenid: binding.sales_openid,
      salesPersonId: binding.sales_person_id,
      shareKey: binding.share_key,
      boundAt: toIsoStringOrEmpty(binding.bound_at),
      authorizedUntil: toIsoStringOrEmpty(bindingShare?.expire_at),
      expired: Boolean(bindingExpired),
    } : null,
  };
}

function validateSystemStaffPayload(body) {
  const name = String(body?.name || '').trim();
  const phone = String(body?.phone || '').trim();
  const role = normalizeStaffRole(body?.role);

  if (!name || !phone || !role) {
    const error = new Error('姓名、手机号、角色不能为空');
    error.statusCode = 400;
    throw error;
  }

  if (!STAFF_ROLES.has(role)) {
    const error = new Error('角色不合法');
    error.statusCode = 400;
    throw error;
  }

  return {
    name,
    phone,
    role,
    password: String(body?.password || '').trim(),
    wechatOpenid: String(body?.wechatOpenid || '').trim(),
    wechatUnionid: String(body?.wechatUnionid || '').trim(),
    status: body?.status ?? 1,
    remark: String(body?.remark || '').trim(),
  };
}

async function assertSystemStaffPhoneAvailable(connection, phone, excludeId = 0) {
  const [rows] = await connection.query(
    `SELECT id
       FROM ${SYSTEM_STAFF_TABLE}
      WHERE phone = ?
        AND id <> ?
      LIMIT 1`,
    [phone, Number(excludeId) || 0]
  );
  if (Array.isArray(rows) && rows.length > 0) {
    const error = new Error('手机号已存在，请更换手机号');
    error.statusCode = 409;
    throw error;
  }
}

async function listSystemStaff(req, res) {
  const [rows] = await pool.query(
    `SELECT id, name, phone, role, wechat_openid, wechat_unionid, wechat_bound_at, status, remark, created_at, updated_at
       FROM ${SYSTEM_STAFF_TABLE}
       ORDER BY id DESC`
  );
  res.json({ success: true, data: rows.map(sanitizeSystemStaffForAdmin) });
}

async function createSystemStaff(req, res) {
  const payload = validateSystemStaffPayload(req.body);
  await assertSystemStaffPhoneAvailable(pool, payload.phone);
  const passwordHash = hashPassword(payload.password || DEFAULT_STAFF_PASSWORD);
  const [result] = await pool.query(
    `INSERT INTO ${SYSTEM_STAFF_TABLE} (name, phone, role, password_hash, wechat_openid, wechat_unionid, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.name,
      payload.phone,
      payload.role,
      passwordHash,
      payload.wechatOpenid,
      payload.wechatUnionid,
      payload.status,
      payload.remark,
    ]
  );

  const [rows] = await pool.query(`SELECT * FROM ${SYSTEM_STAFF_TABLE} WHERE id = ?`, [result.insertId]);
  res.json({ success: true, data: sanitizeSystemStaffForAdmin(rows[0]), message: '新增成功' });
}

async function updateSystemStaff(req, res) {
  const { id } = req.params;
  const payload = validateSystemStaffPayload(req.body);
  await assertSystemStaffPhoneAvailable(pool, payload.phone, id);
  const [result] = await pool.query(
    `UPDATE ${SYSTEM_STAFF_TABLE}
       SET name = ?, phone = ?, role = ?, wechat_openid = ?, wechat_unionid = ?, status = ?, remark = ?
     WHERE id = ?`,
    [
      payload.name,
      payload.phone,
      payload.role,
      payload.wechatOpenid,
      payload.wechatUnionid,
      payload.status,
      payload.remark,
      id,
    ]
  );

  if (!result.affectedRows) {
    return res.status(404).json({ success: false, message: '系统人员不存在' });
  }

  const [rows] = await pool.query(`SELECT * FROM ${SYSTEM_STAFF_TABLE} WHERE id = ?`, [id]);
  res.json({ success: true, data: sanitizeSystemStaffForAdmin(rows[0]), message: '更新成功' });
}

async function deleteSystemStaff(req, res) {
  const [result] = await pool.query(`DELETE FROM ${SYSTEM_STAFF_TABLE} WHERE id = ?`, [req.params.id]);

  if (!result.affectedRows) {
    return res.status(404).json({ success: false, message: '系统人员不存在' });
  }

  res.json({ success: true, message: '删除成功' });
}

async function loginSystemStaff(req, res) {
  const phone = String(req.body?.phone || req.body?.account || req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!phone || !password) {
    return res.status(400).json({ success: false, message: '请输入手机号和密码' });
  }

  const [rows] = await pool.query(
    `SELECT id, name, phone, role, status, remark, password_hash, created_at, updated_at
       FROM ${SYSTEM_STAFF_TABLE}
      WHERE phone = ?
      ORDER BY id DESC
      LIMIT 1`,
    [phone]
  );
  const person = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  if (!person || person.password_hash !== hashPassword(password)) {
    return res.status(401).json({ success: false, message: '手机号或密码错误' });
  }

  if (!isEnabledPersonStatus(person.status)) {
    return res.status(403).json({ success: false, message: '账号已停用' });
  }

  const token = createAdminToken(person);
  res.json({
    success: true,
    data: {
      ...sanitizeSystemStaffForAdmin(person),
      token,
    },
    token,
    message: '登录成功',
  });
}

async function updateSystemStaffPassword(req, res) {
  const id = Number(req.params.id || req.body?.id || req.body?.staffId);
  const password = String(req.body?.password || '').trim();

  if (!id) {
    return res.status(400).json({ success: false, message: '人员ID不能为空' });
  }

  if (!password) {
    return res.status(400).json({ success: false, message: '新密码不能为空' });
  }

  const actor = req.adminUser || null;
  const actorLevel = getRoleLevel(actor?.role);
  const isSelfUpdate = Number(actor?.id || 0) === id;
  if (!(actorLevel <= 1 || (actorLevel <= 2 && isSelfUpdate))) {
    return res.status(403).json({ success: false, message: '暂无操作权限' });
  }

  const [result] = await pool.query(
    `UPDATE ${SYSTEM_STAFF_TABLE}
        SET password_hash = ?
      WHERE id = ?`,
    [hashPassword(password), id]
  );

  if (!result.affectedRows) {
    return res.status(404).json({ success: false, message: '系统人员不存在' });
  }

  res.json({ success: true, message: '密码已修改' });
}

async function createApp() {
  await initializeApplicationSchema(pool);

  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));
  app.use('/uploads', express.static(uploadAbsoluteDir));

  app.get('/health', asyncHandler(async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  }));

  app.get('/api/health', asyncHandler(async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ success: true, message: '服务正常' });
  }));

  app.get('/api/image-proxy', requireStaffAuth, (req, res) => {
    const imageUrl = parseProxyImageUrl(req.query?.url);
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: '图片地址不允许代理' });
    }
    pipeRemoteImage(imageUrl, res);
  });

  app.get('/api/image/clean', (req, res) => {
    const imageUrl = parseCleanImageUrl(req.query?.url);
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: '图片地址不允许清洗' });
    }
    pipeCleanedImage(imageUrl, res);
  });

  app.post('/api/wechat/bind-staff-phone', asyncHandler(async (req, res) => {
    const openid = String(req.body?.openid || '').trim();
    const phoneCode = String(req.body?.code || req.body?.phoneCode || '').trim();
    const shareKey = String(req.body?.shareKey || req.body?.share_key || '').trim();

    if (!phoneCode) {
      return res.status(400).json({ success: false, message: '手机号授权 code 不能为空' });
    }

    const phoneInfo = await getPhoneNumberByCode(phoneCode);
    const phone = String(phoneInfo.phoneNumber || phoneInfo.purePhoneNumber || '').trim();
    if (!phone) {
      return res.status(502).json({ success: false, message: '未获取到微信手机号' });
    }

    const staff = await findSystemStaffByPhone(pool, phone);
    if (staff && !isSystemStaff(staff)) {
      return res.status(403).json({ success: false, message: '该内部人员已停用' });
    }

    if (staff && openid) {
      await pool.query(
        `UPDATE ${SYSTEM_STAFF_TABLE}
            SET wechat_openid = ?, wechat_bound_at = NOW()
          WHERE id = ?`,
        [openid, staff.id]
      );
    }

    if (isSystemStaff(staff)) {
      const profile = await buildWechatPhoneProfileWithShareKey(pool, phone);
      if (profile.matchedPerson) {
        const share = await createSalesShareRecord(pool, profile.matchedPerson, phone);
        profile.share = sanitizeShareRow(share);
      }
      return res.json({
        success: true,
        data: {
          ...profile,
          phoneNumber: phone,
          accessGranted: true,
          accessMessage: profile.accessMessage || '内部人员身份已识别',
        },
        message: '手机号绑定成功',
      });
    }

    if (shareKey) {
      const shareResult = await processCustomerShareAccess(pool, phone, shareKey);
      const profile = shareResult.profile || await buildWechatPhoneProfileWithShareKey(pool, phone);
      return res.json({
        success: true,
        data: {
          ...profile,
          phoneNumber: phone,
          accessGranted: shareResult.accessGranted,
          accessMessage: shareResult.accessMessage || profile.accessMessage,
          shareAction: shareResult.shareAction,
          share: shareResult.share || profile.share || null,
        },
        message: '手机号绑定成功',
      });
    }

    const profile = await buildWechatPhoneProfileWithShareKey(pool, phone);
    res.json({
      success: true,
      data: {
        ...profile,
        phoneNumber: phone,
        accessGranted: Boolean(profile.accessGranted),
        accessMessage: profile.accessMessage || '请通过销售分享进入',
      },
      message: '手机号绑定成功',
    });
  }));

  app.post('/api/wechat/create-share', asyncHandler(async (req, res) => {
    const phone = String(req.body?.phoneNumber || req.body?.phone || req.body?.openid || req.body?.salesOpenid || '').trim();
    if (!phone) {
      return res.status(400).json({ success: false, message: '手机号不能为空' });
    }

    const salesPerson = await findSystemStaffByPhone(pool, phone);
    if (!isSystemStaff(salesPerson)) {
      return res.status(403).json({ success: false, message: '只有内部人员才能创建分享' });
    }

    const share = await createSalesShareRecord(pool, salesPerson, phone);
    res.json({
      success: true,
      data: {
        ...sanitizeShareRow(share),
        salesPerson: sanitizePersonRow(salesPerson),
      },
    });
  }));

  app.post('/api/wechat/bind-sales-openid', asyncHandler(async (req, res) => {
    const phone = String(req.body?.phoneNumber || req.body?.phone || req.body?.openid || '').trim();
    const shareKey = String(req.body?.shareKey || req.body?.share_key || '').trim();

    if (!phone) {
      return res.status(400).json({ success: false, message: '手机号不能为空' });
    }

    const shareResult = await processCustomerShareAccess(pool, phone, shareKey);
    const profile = shareResult.profile || await buildWechatPhoneProfileWithShareKey(pool, phone);

    res.json({
      success: true,
      data: {
        ...profile,
        phoneNumber: phone,
        accessGranted: shareResult.accessGranted,
        accessMessage: shareResult.accessMessage || profile.accessMessage,
        shareAction: shareResult.shareAction,
        share: shareResult.share || profile.share || null,
      },
    });
  }));

  app.post('/api/wechat/phone-profile', asyncHandler(async (req, res) => {
    const phone = String(req.body?.phoneNumber || req.body?.phone || req.body?.openid || '').trim();
    const shareKey = String(req.body?.shareKey || req.body?.share_key || '').trim();

    if (!phone) {
      return res.status(400).json({ success: false, message: '手机号不能为空' });
    }

    if (shareKey) {
      const shareResult = await processCustomerShareAccess(pool, phone, shareKey);
      const profile = shareResult.profile || await buildWechatPhoneProfileWithShareKey(pool, phone);
      return res.json({
        success: true,
        data: {
          ...profile,
          phoneNumber: phone,
          accessGranted: shareResult.accessGranted,
          accessMessage: shareResult.accessMessage || profile.accessMessage,
          shareAction: shareResult.shareAction,
          share: shareResult.share || profile.share || null,
        },
      });
    }

    const profile = await buildWechatPhoneProfileWithShareKey(pool, phone);
    res.json({
      success: true,
      data: {
        ...profile,
        phoneNumber: phone,
        accessGranted: Boolean(profile.accessGranted),
        accessMessage: profile.accessMessage,
      },
    });
  }));

  app.get('/api/system-staff', requireLevel1Auth, asyncHandler(listSystemStaff));
  app.get('/api/system-staff/list', requireLevel1Auth, asyncHandler(listSystemStaff));
  app.post('/api/system-staff/login', asyncHandler(loginSystemStaff));
  app.post('/api/system-staff/create', requireLevel1Auth, asyncHandler(createSystemStaff));
  app.put('/api/system-staff/password/:id', requireStaffAuth, asyncHandler(updateSystemStaffPassword));
  app.put('/api/system-staff/update/:id', requireLevel1Auth, asyncHandler(updateSystemStaff));
  app.delete('/api/system-staff/delete/:id', requireLevel1Auth, asyncHandler(deleteSystemStaff));
  app.post('/api/system-staff', requireLevel1Auth, asyncHandler(createSystemStaff));
  app.put('/api/system-staff/:id/password', requireStaffAuth, asyncHandler(updateSystemStaffPassword));
  app.put('/api/system-staff/:id', requireLevel1Auth, asyncHandler(updateSystemStaff));
  app.delete('/api/system-staff/:id', requireLevel1Auth, asyncHandler(deleteSystemStaff));

  app.get('/api/people', requireLevel1Auth, asyncHandler(listSystemStaff));
  app.get('/api/people/list', requireLevel1Auth, asyncHandler(listSystemStaff));
  app.post('/api/people/login', asyncHandler(loginSystemStaff));
  app.post('/api/people/create', requireLevel1Auth, asyncHandler(createSystemStaff));
  app.put('/api/people/password/:id', requireStaffAuth, asyncHandler(updateSystemStaffPassword));
  app.put('/api/people/update/:id', requireLevel1Auth, asyncHandler(updateSystemStaff));
  app.delete('/api/people/delete/:id', requireLevel1Auth, asyncHandler(deleteSystemStaff));
  app.post('/api/people', requireLevel1Auth, asyncHandler(createSystemStaff));
  app.put('/api/people/:id/password', requireStaffAuth, asyncHandler(updateSystemStaffPassword));
  app.put('/api/people/:id', requireLevel1Auth, asyncHandler(updateSystemStaff));
  app.delete('/api/people/:id', requireLevel1Auth, asyncHandler(deleteSystemStaff));

  app.get('/api/approval-tasks', requireLevel2Auth, asyncHandler(listApprovalTasks));
  app.get('/api/approval-tasks/:id', requireLevel2Auth, asyncHandler(getApprovalTask));
  app.post('/api/approval-tasks/:id/approve', requireLevel2Auth, asyncHandler(approveApprovalTask));
  app.post('/api/approval-tasks/:id/reject', requireLevel2Auth, asyncHandler(rejectApprovalTask));

  app.get('/api/special-assets', allowAdminOrShareAccess, asyncHandler(listSpecialAssets));
  app.get('/api/special-assets/:id', allowAdminOrShareAccess, asyncHandler(getSpecialAsset));
  app.post('/api/special-assets', requireStaffAuth, upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'gallery', maxCount: 12 },
  ]), asyncHandler(createSpecialAsset));
  app.put('/api/special-assets/:id', requireStaffAuth, upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'gallery', maxCount: 12 },
  ]), asyncHandler(updateSpecialAsset));
  app.delete('/api/special-assets/:id', requireStaffAuth, asyncHandler(deleteSpecialAsset));

  app.get('/api/basic-settings', allowAdminOrShareAccess, asyncHandler(async (_, res) => {
    const [rows] = await pool.query(
      `SELECT id, min_house_price, max_house_price, interest_rate, fapai_intro, low_down_payment_intro, updated_at
         FROM basic_settings
        WHERE id = 1`
    );

    res.json({
      success: true,
      data: rows[0] || {
        id: 1,
        min_house_price: 0,
        max_house_price: 150,
        interest_rate: 3.15,
        fapai_intro: '',
        low_down_payment_intro: '',
      },
    });
  }));

  app.put('/api/basic-settings', requireLevel1Auth, asyncHandler(async (req, res) => {
    const minHousePrice = normalizeNumber(req.body.min_house_price);
    const maxHousePrice = normalizeNumber(req.body.max_house_price);
    const interestRate = normalizeNumber(req.body.interest_rate);
    const fapaiIntro = String(req.body?.fapai_intro || '').trim();
    const lowDownPaymentIntro = String(req.body?.low_down_payment_intro || '').trim();

    if (minHousePrice === null || maxHousePrice === null || interestRate === null) {
      return res.status(400).json({ success: false, message: '房屋价格范围和利率必须是数字' });
    }

    if (minHousePrice < 0 || maxHousePrice < 0 || interestRate < 0) {
      return res.status(400).json({ success: false, message: '房屋价格范围和利率不能小于 0' });
    }

    if (minHousePrice > maxHousePrice) {
      return res.status(400).json({ success: false, message: '最低房屋价格不能大于最高房屋价格' });
    }

    await pool.query(
      `INSERT INTO basic_settings (id, min_house_price, max_house_price, interest_rate, fapai_intro, low_down_payment_intro)
       VALUES (1, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         min_house_price = VALUES(min_house_price),
         max_house_price = VALUES(max_house_price),
         interest_rate = VALUES(interest_rate),
         fapai_intro = VALUES(fapai_intro),
         low_down_payment_intro = VALUES(low_down_payment_intro)`,
      [minHousePrice, maxHousePrice, interestRate, fapaiIntro, lowDownPaymentIntro]
    );

    const [rows] = await pool.query('SELECT * FROM basic_settings WHERE id = 1');
    res.json({ success: true, data: rows[0], message: '保存成功' });
  }));
  app.get('/api/bk/ershou/details/import-default-file', (req, res) => {
    res.json({
      ok: true,
      filePath: resolveDetailCaptureFilePath({ date: req.query.date }),
    });
  });

  app.post('/api/bk/ershou/details/import-daily', requireAdminAuth, asyncHandler(async (req, res) => {
    const result = await importDailyDetailCapture(pool, {
      date: req.body?.date,
      filePath: req.body?.filePath,
      replaceExisting: req.body?.replaceExisting,
    });
    res.json({ ok: true, result });
  }));

  app.post('/api/bk/ershou/details/import-payload', requireAdminAuth, asyncHandler(async (req, res) => {
    const result = await importDailyDetailCapture(pool, {
      payload: req.body?.payload,
      sourceFileName: req.body?.sourceFileName,
      replaceExisting: req.body?.replaceExisting,
    });
    res.json({ ok: true, result });
  }));

  app.post('/api/bk/ershou/details/import-one', requireAdminAuth, asyncHandler(async (req, res) => {
    const result = await importOneDetailCapture(pool, {
      captureDate: req.body?.captureDate,
      item: req.body?.item,
    });
    res.json({ ok: true, result });
  }));

  app.get('/api/bk/map/districts/import-default-file', (req, res) => {
    res.json({
      ok: true,
      filePath: resolveMapDistrictCaptureFilePath({ date: req.query.date }),
    });
  });

  app.post('/api/bk/map/districts/import-daily', requireAdminAuth, asyncHandler(async (req, res) => {
    const result = await importMapDistrictCapture(pool, {
      date: req.body?.date,
      filePath: req.body?.filePath,
      replaceExisting: req.body?.replaceExisting,
    });
    res.json({ ok: true, result });
  }));

  app.post('/api/bk/map/districts/import-payload', requireAdminAuth, asyncHandler(async (req, res) => {
    const result = await importMapDistrictCapture(pool, {
      payload: req.body?.payload,
      sourceFileName: req.body?.sourceFileName,
      replaceExisting: req.body?.replaceExisting,
    });
    res.json({ ok: true, result });
  }));

  app.post('/api/bk/map/tree/import-payload', requireAdminAuth, asyncHandler(async (req, res) => {
    const result = await importMapTreeCapture(pool, {
      payload: req.body?.payload,
      replaceExisting: req.body?.replaceExisting,
    });
    res.json({ ok: true, result });
  }));

  app.post('/api/bk/map/tree/import-daily', requireAdminAuth, asyncHandler(async (req, res) => {
    const result = await importMapTreeCapture(pool, {
      filePath: req.body?.filePath,
      replaceExisting: req.body?.replaceExisting,
    });
    res.json({ ok: true, result });
  }));

  app.get('/api/djl/map/districts', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const items = await queryDjlMapDistricts(pool);
    res.json({
      ok: true,
      result: {
        items,
        itemCount: items.length,
      },
    });
  }));

  app.get('/api/djl/map/sub-areas', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const items = await queryDjlMapSubAreas(pool, {
      areaCode: req.query.areaCode,
    });
    res.json({
      ok: true,
      result: {
        items,
        itemCount: items.length,
      },
    });
  }));

  app.get('/api/djl/map/communities', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const items = await queryDjlMapCommunities(pool, {
      areaCode: req.query.areaCode,
      subAreaName: req.query.subAreaName,
    });
    res.json({
      ok: true,
      result: {
        items,
        itemCount: items.length,
      },
    });
  }));

  app.get('/api/djl/sync/tasks', requireRoleLevel(1), asyncHandler(async (req, res) => {
    const result = await listDjlSyncTasks(pool, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
    });
    const runningTask = await getLatestRunningDjlSyncTask(pool);
    res.json({ ok: true, result, runningTask });
  }));

  app.get('/api/fapai-houses/district-options', requireRoleLevel(3), asyncHandler(async (req, res) => {
    const items = await queryFapaiDistrictOptions(pool);
    res.json({
      ok: true,
      result: {
        items,
        itemCount: items.length,
      },
    });
  }));

  app.get('/api/fapai-houses', requireRoleLevel(3), asyncHandler(async (req, res) => {
    const result = await queryFapaiHouseList(pool, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      includeTotal: req.query.includeTotal,
      title: req.query.title,
      districtId: req.query.districtId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json({ ok: true, result });
  }));

  app.get('/api/fapai-houses/export', requireRoleLevel(3), asyncHandler(async (req, res) => {
    const result = await exportFapaiHouseWorkbook(pool);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.end(Buffer.from(result.buffer));
  }));

  app.post('/api/djl/sync/run', requireRoleLevel(1), asyncHandler(async (req, res) => {
    const actor = req.adminUser || null;
    const result = await enqueueDjlFullSync(pool, actor || {});
    res.json({
      success: true,
      data: result,
      message: '到家了抓取同步任务已启动',
    });
  }));

  app.get('/api/bk/community/price', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const result = await queryBeikeCommunityPrice({
      communityName: req.query.communityName || req.query.name,
      resblockId: req.query.resblockId,
      houseCode: req.query.houseCode,
      live: req.query.live,
      hookSeconds: req.query.hookSeconds,
    });
    res.json({ ok: true, result });
  }));

  app.get('/api/bk/map/districts', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const items = await queryDjlMapDistricts(pool);
    res.json({
      ok: true,
      result: {
        items: items.map((item) => ({ district_name: item.areaName || item.displayName || '' })),
        itemCount: items.length,
      },
    });
  }));

  app.get('/api/bk/map/bubbles', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const groupType = String(req.query.groupType || 'district').trim();
    let result;

    if (groupType === 'district') {
      const items = await queryDjlMapDistricts(pool);
      result = {
        captureDate: null,
        groupType: 'district',
        parentId: null,
        itemCount: items.length,
        items: items.map((item) => ({
          captureDate: null,
          groupType: 'district',
          parentGroupType: null,
          parentId: null,
          entityId: item.areaCode,
          entityType: 'district',
          bubbleId: item.areaCode,
          name: item.displayName || item.areaName,
          fullSpell: null,
          price: item.avgTotalPriceWan || null,
          priceStr: item.priceText || '',
          priceUnit: '万',
          desc: item.priceText || '',
          bubbleDesc: `${Number(item.houseCount || 0)}套`,
          longitude: item.longitude,
          latitude: item.latitude,
        })),
      };
    } else if (groupType === 'bizcircle') {
      const areaCode = String(req.query.parentId || req.query.parentAltId || '').trim();
      const items = areaCode ? await queryDjlMapSubAreas(pool, { areaCode }) : [];
      result = {
        captureDate: null,
        groupType: 'bizcircle',
        parentId: areaCode || null,
        itemCount: items.length,
        items: items.map((item) => ({
          captureDate: null,
          groupType: 'bizcircle',
          parentGroupType: 'district',
          parentId: areaCode || null,
          entityId: item.areaCode,
          entityType: 'sub_area',
          bubbleId: item.subAreaName,
          name: item.subAreaName,
          fullSpell: null,
          price: item.avgTotalPriceWan || null,
          priceStr: item.priceText || '',
          priceUnit: '万',
          desc: item.priceText || '',
          bubbleDesc: `${Number(item.houseCount || 0)}套`,
          longitude: item.longitude,
          latitude: item.latitude,
        })),
      };
    } else if (groupType === 'community') {
      const areaCode = String(req.query.parentId || '').trim();
      const subAreaName = String(req.query.parentAltId || '').trim();
      const items = (areaCode && subAreaName)
        ? await queryDjlMapCommunities(pool, { areaCode, subAreaName })
        : [];
      result = {
        captureDate: null,
        groupType: 'community',
        parentId: subAreaName || null,
        itemCount: items.length,
        items: items.map((item) => ({
          captureDate: null,
          groupType: 'community',
          parentGroupType: 'bizcircle',
          parentId: subAreaName || null,
          entityId: item.communityId,
          entityType: 'community',
          bubbleId: item.communityId,
          name: item.communityName,
          fullSpell: null,
          price: item.avgTotalPriceWan || null,
          priceStr: item.priceText || '',
          priceUnit: '万',
          desc: item.priceText || '',
          bubbleDesc: `${Number(item.houseCount || 0)}套`,
          longitude: item.longitude,
          latitude: item.latitude,
        })),
      };
    } else {
      result = await queryMapBubbles(pool, {
        date: req.query.date,
        groupType: req.query.groupType,
        parentId: Object.prototype.hasOwnProperty.call(req.query, 'parentId') ? req.query.parentId : undefined,
        parentAltId: Object.prototype.hasOwnProperty.call(req.query, 'parentAltId') ? req.query.parentAltId : undefined,
      });
    }
    res.json({ ok: true, result });
  }));

  app.get('/api/bk/map/houses', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const communityId = String(req.query.resblockId || req.query.resblockAltId || '').trim();
    let result;
    if (communityId) {
      const listResult = await queryDjlHouseList(pool, {
        page: 1,
        pageSize: 500,
        communityId,
        includeTotal: false,
      });
      const items = (listResult.items || []).map((item, index) => ({
        id: item.id,
        captureDate: item.captureDate || null,
        resblockId: item.communityId || communityId,
        resblockName: item.communityName || '',
        houseCode: item.houseCode || '',
        title: item.title || '',
        desc: item.listingDesc || '',
        buildAreaSqm: item.buildAreaSqm ?? null,
        originalCoverPic: item.originalCoverPic || '',
        coverPic: item.coverPic || '',
        posterImage: item.posterImage || '',
        priceStr: item.totalPriceText ? `${item.totalPriceText}${item.totalPriceUnit || '万'}` : '',
        unitPriceStr: item.unitPriceText || '',
        actionUrl: item.actionUrl || '',
        cardType: item.cardType || 'ershou',
        itemIndex: index,
        total: listResult.total || 0,
        longitude: item.longitude,
        latitude: item.latitude,
      }));
      result = {
        captureDate: null,
        resblockId: communityId,
        resblockName: items[0] ? items[0].resblockName : '',
        total: Number(listResult.total || 0),
        itemCount: items.length,
        items,
      };
    } else {
      result = await queryMapHouses(pool, {
        date: req.query.date,
        resblockId: req.query.resblockId,
        resblockAltId: Object.prototype.hasOwnProperty.call(req.query, 'resblockAltId') ? req.query.resblockAltId : undefined,
      });
    }
    res.json({ ok: true, result });
  }));

  app.get('/api/bk/ershou/district-options', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const items = await queryDjlDistrictOptions(pool);
    res.json({
      ok: true,
      result: {
        items,
        itemCount: items.length,
      },
    });
  }));

  app.get('/api/bk/map/house-card', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const result = await queryMapHouseCard(pool, {
      date: req.query.date,
      id: req.query.id,
      houseCode: req.query.houseCode,
    });
    res.json({ ok: true, result });
  }));

  app.get('/api/bk/ershou/list', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const result = await queryDjlHouseList(pool, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      includeTotal: req.query.includeTotal,
      title: req.query.title,
      districtName: req.query.districtName,
      areaCode: req.query.areaCode,
      subAreaName: req.query.subAreaName,
      communityId: req.query.communityId,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      minArea: req.query.minArea,
      maxArea: req.query.maxArea,
    });
    res.json({ ok: true, result });
  }));

  app.post('/api/bk/ershou/list', requireStaffAuth, upload.fields([
    { name: 'cover', maxCount: 1 },
  ]), asyncHandler(createBkHouse));

  app.delete('/api/bk/ershou/list/:id', requireStaffAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const actor = req.adminUser || null;
    const actorLevel = getRoleLevel(actor?.role);

    if (actorLevel > 3) {
      return res.status(403).json({ success: false, message: '暂无操作权限' });
    }

    if (actorLevel === 3) {
      const pendingDeleteTask = await findPendingApprovalTask(pool, {
        actionType: 'bk_house_delete',
        targetType: 'bk_house',
        targetId: String(id),
      });
      if (pendingDeleteTask) {
        return res.status(400).json({ success: false, message: '该房源已有删除审核中，请勿重复提交' });
      }

      const task = await createApprovalTask(pool, {
        actionType: 'bk_house_delete',
        targetType: 'bk_house',
        targetId: String(id),
        summary: `申请删除房源 #${id}`,
        payload: { id: Number(id) },
        createdBy: actor,
      });
      return res.json({ success: true, pending: true, data: task, message: '已提交审核，等待审核员或管理员处理' });
    }

    const deleteResult = await deleteDjlHouseById(pool, Number(id), actor || {}, 'manual_admin_delete', '');
    if (!deleteResult.deleted) {
      return res.status(404).json({ success: false, message: '房源不存在或已删除' });
    }

    await closePendingHouseImageApprovalTasks(pool, String(id), actor || {});

    res.json({ success: true, data: { id: Number(id) }, message: '房源已删除' });
  }));

  app.post('/api/bk/ershou/list/:id/images', requireStaffAuth, upload.fields([
    { name: 'poster', maxCount: 1 },
    { name: 'gallery', maxCount: 12 },
  ]), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const actor = req.adminUser || null;
    const actorLevel = getRoleLevel(actor?.role);

    if (actorLevel > 3) {
      return res.status(403).json({ success: false, message: '暂无操作权限' });
    }

    const currentHouse = await loadDjlHouseImageState(pool, Number(id));
    const originalPoster = String(currentHouse.cover_image_url || '').trim();
    const currentPoster = getDjlEffectivePoster(currentHouse);
    const currentGallery = getDjlEffectiveGallery(currentHouse);
    const existingGalleryImages = normalizeStringArray(req.body?.existingGalleryImages);
    const hasExistingGalleryPayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'existingGalleryImages');
    const baseGallery = hasExistingGalleryPayload ? existingGalleryImages : currentGallery;
    const posterFile = req.files?.poster?.[0];
    const posterRemoved = isTruthyFlag(req.body?.posterRemoved);
    const posterChanged = isTruthyFlag(req.body?.posterChanged) || Boolean(posterFile) || posterRemoved;
    const galleryFiles = req.files?.gallery || [];
    const nextPoster = posterFile
      ? formatImageUrl(req, posterFile.filename)
      : (posterRemoved ? '' : currentPoster);
    const nextGallery = [
      ...baseGallery,
      ...galleryFiles.map((file) => formatImageUrl(req, file.filename)),
    ];
    const isGalleryUnchanged = JSON.stringify(nextGallery) === JSON.stringify(currentGallery);
    const isPosterUnchanged = !posterChanged || nextPoster === currentPoster;

    if (isPosterUnchanged && isGalleryUnchanged) {
      return res.status(400).json({ success: false, message: '请先调整图片后再提交审核' });
    }

    if (actorLevel === 3) {
      const pendingDeleteTask = await findPendingApprovalTask(pool, {
        actionType: 'bk_house_delete',
        targetType: 'bk_house',
        targetId: String(id),
      });
      if (pendingDeleteTask) {
        return res.status(400).json({ success: false, message: '该房源已有删除审核中，暂不能提交图片审核' });
      }

      const pendingImageTask = await findPendingApprovalTask(pool, {
        actionType: 'bk_house_update_images',
        targetType: 'bk_house',
        targetId: String(id),
      });
      if (pendingImageTask) {
        return res.status(400).json({ success: false, message: '该房源已有图片审核中，请等待审核完成后再提交' });
      }

      const task = await createApprovalTask(pool, {
        actionType: 'bk_house_update_images',
        targetType: 'bk_house',
        targetId: String(id),
        summary: `申请更新房源图片 #${id}`,
        payload: {
          id: Number(id),
          currentPosterImageUrl: currentPoster,
          currentGalleryImageUrls: currentGallery,
          posterChanged,
          posterRemoved,
          posterFileName: posterFile?.filename || '',
          posterImageUrl: nextPoster,
          galleryAddedImageUrls: diffImageList(nextGallery, currentGallery),
          galleryDeletedImageUrls: diffImageList(currentGallery, nextGallery),
          galleryFileNames: galleryFiles.map((file) => file.filename),
          galleryImageUrls: nextGallery,
        },
        createdBy: actor,
      });
      return res.json({ success: true, pending: true, data: task, message: '已提交审核，等待审核员或管理员处理' });
    }

    const nextManualPoster = posterChanged
      ? (nextPoster || '')
      : String(currentHouse.manual_cover_image_url || '').trim();
    const nextManualPosterRemoved = posterChanged
      ? Number(!nextPoster && posterRemoved)
      : Number(currentHouse.manual_cover_removed || 0);

    await pool.query(
      `UPDATE \`djl_esf_house_detail\`
       SET manual_cover_image_url = ?,
           manual_cover_removed = ?,
           manual_gallery_images_json = ?
       WHERE id = ?`,
      [nextManualPoster, nextManualPosterRemoved, JSON.stringify(nextGallery), id]
    );

    const savedHouse = await loadDjlHouseImageState(pool, Number(id));
    const savedManualGallery = parseJsonArray(savedHouse.manual_gallery_images_json);
    const savedPoster = getDjlEffectivePoster(savedHouse);

    res.json({
      success: true,
      data: {
        id: Number(id),
        posterImage: savedPoster,
        originalCoverPic: originalPoster,
        galleryImages: savedManualGallery.length > 0 ? savedManualGallery : parseJsonArray(savedHouse.image_urls_json),
      },
      message: '图片更新成功',
    });
  }));

  app.get('/api/bk/ershou/details/item', allowAdminOrShareAccess, asyncHandler(async (req, res) => {
    const result = await queryDetailByListingId(pool, req.query.id);
    res.json({ ok: true, result });
  }));

  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      ok: false,
      success: false,
      message: error.message || String(error),
      error: error.message || String(error),
    });
  });

  return app;
}

async function start() {
  const app = await createApp();
  app.listen(port, () => {
    console.log(`CQ API listening on http://127.0.0.1:${port}`);
  });

  if (!process.env.WECHAT_APP_ID && !process.env.WX_APP_ID && !process.env.MP_APP_ID) {
    console.warn('[wechat-login] missing appid: set WECHAT_APP_ID / WX_APP_ID / MP_APP_ID in CQ_API/.env');
  }
  if (!process.env.WECHAT_APP_SECRET && !process.env.WX_APP_SECRET && !process.env.MP_APP_SECRET) {
    console.warn('[wechat-login] missing secret: set WECHAT_APP_SECRET / WX_APP_SECRET / MP_APP_SECRET in CQ_API/.env');
  }
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

