export const AUTH_KEY = 'cq_admin_authenticated'
export const AUTH_ROLE_KEY = 'cq_admin_role'
export const AUTH_USER_KEY = 'cq_admin_user'
export const AUTH_TOKEN_KEY = 'cq_admin_token'

export const ROLE_ADMIN = 'admin'
export const ROLE_REVIEWER = 'reviewer'
export const ROLE_UPLOADER = 'uploader'
export const ROLE_SALES = 'sales'

export const ROLE_LEVEL_MAP = {
  [ROLE_ADMIN]: 1,
  [ROLE_REVIEWER]: 2,
  [ROLE_UPLOADER]: 3,
  [ROLE_SALES]: 4,
}

export const ROLE_MAP = {
  管理员: ROLE_ADMIN,
  审核员: ROLE_REVIEWER,
  图片上传专员: ROLE_UPLOADER,
  销售: ROLE_SALES,
  admin: ROLE_ADMIN,
  reviewer: ROLE_REVIEWER,
  uploader: ROLE_UPLOADER,
  sales: ROLE_SALES,
}

export const ROLE_LABEL_MAP = {
  [ROLE_ADMIN]: '管理员',
  [ROLE_REVIEWER]: '审核员',
  [ROLE_UPLOADER]: '图片上传专员',
  [ROLE_SALES]: '销售',
}

export function normalizeRole(role) {
  const raw = String(role || '').trim()
  if (!raw) return ROLE_SALES
  return ROLE_MAP[raw] || raw
}

export function getRoleLevel(role) {
  return ROLE_LEVEL_MAP[normalizeRole(role)] || 999
}

export function hasRoleAtMostLevel(requiredLevel) {
  return getRoleLevel(getAuthRole()) <= Number(requiredLevel || 999)
}

export function isAdmin() {
  return hasRoleAtMostLevel(1)
}

export function isReviewerOrAbove() {
  return hasRoleAtMostLevel(2)
}

export function isUploaderOrAbove() {
  return hasRoleAtMostLevel(3)
}

export function isSales() {
  return normalizeRole(getAuthRole()) === ROLE_SALES
}

export function getRoleLabel(role) {
  return ROLE_LABEL_MAP[normalizeRole(role)] || String(role || '')
}

export function getDefaultRouteByRole(role) {
  const normalizedRole = normalizeRole(role)
  if (normalizedRole === ROLE_ADMIN) return '/people'
  if (normalizedRole === ROLE_REVIEWER) return '/approval-tasks'
  return '/houses'
}

export function setAuthRole(role) {
  window.localStorage.setItem(AUTH_ROLE_KEY, normalizeRole(role))
}

export function setAuthUser(user) {
  const nextUser = user ? Object.assign({}, user, { role: normalizeRole(user.role) }) : null
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextUser))
}

export function setAuthToken(token) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token || '')
}

export function getAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || ''
}

export function getAuthUser() {
  try {
    const user = JSON.parse(window.localStorage.getItem(AUTH_USER_KEY) || 'null')
    return user ? Object.assign({}, user, { role: normalizeRole(user.role) }) : null
  } catch {
    return null
  }
}

export function getAuthRole() {
  return normalizeRole(window.localStorage.getItem(AUTH_ROLE_KEY) || '')
}

export function clearAuthStorage() {
  window.localStorage.removeItem(AUTH_KEY)
  window.localStorage.removeItem(AUTH_ROLE_KEY)
  window.localStorage.removeItem(AUTH_USER_KEY)
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
  window.localStorage.removeItem('cq_authenticated')
  window.localStorage.removeItem('auth_token')
  window.localStorage.removeItem('token')
}
