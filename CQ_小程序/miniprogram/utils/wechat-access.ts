type WechatLoginData = import('../services/house').WechatLoginData

export const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'
const CURRENT_SHARE_STORAGE_KEY = 'current_wechat_share'
let sessionShareKey = ''

export function clearWechatSessionCache() {
  sessionShareKey = ''
  try {
    wx.removeStorageSync(WECHAT_LOGIN_STORAGE_KEY)
  } catch (error) {
    console.warn('clear wechat login cache failed:', error)
  }
  try {
    wx.removeStorageSync(CURRENT_SHARE_STORAGE_KEY)
  } catch (error) {
    console.warn('clear wechat share cache failed:', error)
  }
}

function isInternalStaffRole(role?: string | null): boolean {
  const normalized = String(role || '').trim()
  return normalized === '销售' || normalized === '管理员'
}

export function canWechatShare(profile?: Partial<WechatLoginData> | null): boolean {
  if (!profile) return false
  if (profile.canShareMiniProgram) return true
  return Boolean(profile.matchedPerson)
}

function hasValidBinding(profile?: Partial<WechatLoginData> | null): boolean {
  if (!profile?.binding?.salesOpenid) return false
  if (!profile.salesPerson && !profile.binding.salesPersonId) return false
  if (profile.binding.expired) return false
  const authorizedUntil = String(profile.binding.authorizedUntil || '').trim()
  if (!authorizedUntil) return true
  const expireAt = new Date(authorizedUntil).getTime()
  return Number.isFinite(expireAt) && expireAt > Date.now()
}

export function syncWechatShareMenu(profile?: Partial<WechatLoginData> | null) {
  if (canWechatShare(profile || readWechatLoginCache())) {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
    })
    return
  }
  wx.hideShareMenu({
    menus: ['shareAppMessage', 'shareTimeline'],
  })
}

export function hasWechatAccess(profile?: Partial<WechatLoginData> | null): boolean {
  if (!profile) return false
  if (profile.canShareMiniProgram) return true
  if (profile.matchedPerson) return true
  return hasValidBinding(profile)
}

export function readWechatLoginCache(): WechatLoginData | null {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    if (!cached) return null
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const openid = String(source?.openid || '').trim()
    const phoneNumber = String(source?.phoneNumber || source?.matchedPerson?.phone || '').trim()
    if (!openid) return null
    const profile = Object.assign({}, source, {
      openid,
      unionid: String(source?.unionid || '').trim(),
      phoneNumber,
    }) as WechatLoginData
    profile.accessGranted = hasWechatAccess(profile)
    return profile
  } catch (error) {
    console.warn('read wechat login cache failed:', error)
    return null
  }
}

export function rememberWechatShareKey(shareKey?: string | null) {
  const normalized = String(shareKey || '').trim()
  if (normalized) sessionShareKey = normalized
}

function readShareKeyFromValue(value: unknown): string {
  const source = value as {
    share?: { shareKey?: string }
    binding?: { shareKey?: string }
    shareKey?: string
  } | null
  return String(source?.share?.shareKey || source?.binding?.shareKey || source?.shareKey || '').trim()
}

export function readWechatAccessShareKey(): string {
  if (sessionShareKey) return sessionShareKey
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const shareKey = readShareKeyFromValue(source)
    if (shareKey) {
      rememberWechatShareKey(shareKey)
      return shareKey
    }
  } catch (error) {
    console.warn('read wechat access share key from login cache failed:', error)
  }
  try {
    const cached = wx.getStorageSync(CURRENT_SHARE_STORAGE_KEY)
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const expireAt = source?.expireAt ? new Date(source.expireAt).getTime() : 0
    const shareKey = String(source?.shareKey || '').trim()
    if (shareKey && (!expireAt || expireAt > Date.now())) {
      rememberWechatShareKey(shareKey)
      return shareKey
    }
  } catch (error) {
    console.warn('read wechat access share key from share cache failed:', error)
  }
  return ''
}

export function saveWechatLoginCache(profile: WechatLoginData) {
  const openid = String(profile.openid || '').trim()
  const phoneNumber = String(profile.phoneNumber || profile.matchedPerson?.phone || '').trim()
  if (!openid) return
  rememberWechatShareKey(profile.share?.shareKey || profile.binding?.shareKey)
  wx.setStorageSync(WECHAT_LOGIN_STORAGE_KEY, Object.assign({}, profile, {
    openid,
    unionid: String(profile.unionid || '').trim(),
    phoneNumber,
    accessGranted: hasWechatAccess(profile),
  }))
}

export function resolveShareParams(routeOptions: Record<string, string> = {}): {
  shareKey: string
} {
  const shareKey = String(routeOptions.shareKey || '').trim()
  if (shareKey) {
    rememberWechatShareKey(shareKey)
    return { shareKey }
  }

  const entryShareParams = getApp<IAppOption>().globalData.entryShareParams || {}
  const entryShareKey = String(entryShareParams.shareKey || '').trim()
  rememberWechatShareKey(entryShareKey)
  return { shareKey: entryShareKey }
}

function clearEntryShareParams() {
  getApp<IAppOption>().globalData.entryShareParams = {
    shareKey: '',
  }
}

export function consumeShareParams(routeOptions: Record<string, string> = {}): {
  shareKey: string
} {
  const params = resolveShareParams(routeOptions)
  clearEntryShareParams()
  return params
}

export function showNoAccessToast(message?: string) {
  let title = message || ''
  if (!title) {
    const profile = readWechatLoginCache()
    title = profile?.accessMessage || '请通过内部人员分享进入'
  }
  wx.showToast({ title, icon: 'none' })
}

export function buildAccessToastTitle(profile: Partial<WechatLoginData>, granted: boolean): string {
  if (granted) return '微信身份识别成功'
  if (profile.shareAction === 'invalid') return profile.accessMessage || '分享无效'
  if (profile.shareAction === 'expired') return profile.accessMessage || '分享已过期，请联系内部人员'
  return profile.accessMessage || '请通过内部人员分享进入'
}
