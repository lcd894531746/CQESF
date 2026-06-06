import { requestBasicSettings, requestBindSalesOpenid, requestHouseList, requestServiceTel } from '../../services/house'
import { parseAreaRange, parsePriceRange, splitColumns } from '../../utils/house-filters.js'
import { cleanYinshanImageUrl } from '../../utils/clean-image'
import { canWechatShare, consumeShareParams, syncWechatShareMenu } from '../../utils/wechat-access'
import { requestBindStaffPhone, requestPhoneProfile } from '../../services/house'
import { requestCreateWechatShare } from '../../services/house'

type HouseListQuery = import('../../services/house').HouseListQuery

type YinshanRow = {
  id: number
  sourceId?: number | null
  title: string
  communityName?: string | null
  coverPic: string
  area: number
  layout: string | null
  orientation: string | null
  startingPrice: number
  marketPrice: number
  districtId: number | null
  address: string | null
  detailAddress: string | null
  auctionTime: string | null
  status: number | null
  isFinish: number | null
  auctionMode?: number | string | null
}

type HouseItem = {
  id: number
  sourceId?: number | null
  communityNameText: string
  auctionModeBadge: string
  position: string
  areaText: string
  layoutText: string
  orientationText: string
  startingPriceText: string
  marketPriceText: string
  auctionStatusText: string
  auctionStatusType: 'upcoming' | 'running' | 'finished' | 'unknown'
  auctionTimeText: string
  image: string
  district: string
  areaValue: number
  priceValue: number
}

type WechatTestResult = {
  openid: string
  unionid: string
  phoneNumber?: string
  isSales?: boolean
  canShareMiniProgram?: boolean
  accessGranted?: boolean
  accessMessage?: string
  authorizedUntil?: string
  shareAction?: 'none' | 'bound' | 'rebound' | 'already_bound' | 'invalid' | 'expired'
  matchedPerson?: {
    id?: number
    name?: string
  } | null
  salesPerson?: {
    id?: number
    name?: string
  } | null
  binding?: {
    salesOpenid?: string
    shareKey?: string
    authorizedUntil?: string
  } | null
  share?: {
    shareKey?: string
    salesOpenid?: string
    expireAt?: string
  } | null
}

type LegalDocumentType = 'agreement' | 'privacy'

const FALLBACK_DISTRICTS = ['不限', '大渡口', '渝中', '江北区', '渝北区', '九龙坡', '沙坪坝', '巴南', '南岸']
const DISTRICT_ID_BY_NAME: Record<string, number> = {
  大渡口: 18048,
  渝中: 18051,
  江北区: 18050,
  渝北区: 18055,
  九龙坡: 18054,
  沙坪坝: 18064,
  巴南: 18063,
  南岸: 18062,
}
const DEFAULT_CITY_NAME = '重庆市区'
const DEFAULT_HOUSE_TYPE_ID = 2
const DEFAULT_PAGE_SIZE = 10
const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'
const CURRENT_SHARE_STORAGE_KEY = 'current_wechat_share'

function pickFirstImage(urls?: string | null): string {
  if (!urls) return ''
  const first = urls
    .split(',')
    .map((item) => item.trim())
    .find(Boolean) || ''
  return cleanYinshanImageUrl(first)
}

function parseDistrict(row: YinshanRow, districtMap: Map<number, string>): string {
  if (row.districtId !== null && row.districtId !== undefined) {
    const district = districtMap.get(row.districtId)
    if (district) return district
  }
  const matched = row.address
    ? row.address.match(/(江北区?|渝北区?|两江新区|大渡口区?|渝中区?|九龙坡区?|沙坪坝区?|巴南区?|南岸区?)/)
    : null
  if (!matched) return '不限'
  const district = matched[1].replace(/区$/, '')
  return district === '两江新区' ? '渝北区' : district
}

function parseAuctionStatus(row: YinshanRow): {
  text: string
  type: 'upcoming' | 'running' | 'finished' | 'unknown'
} {
  const status = Number(row.status)
  if (status === 0) return { text: '未起拍', type: 'upcoming' }
  if (status === 1) return { text: '竞拍中', type: 'running' }
  if (status === 2) return { text: '已成交', type: 'finished' }
  if (status === 3) return { text: '已结束', type: 'finished' }
  return { text: '状态未知', type: 'unknown' }
}

function normalizeYinshanRows(rows: YinshanRow[], districtMap: Map<number, string>): HouseItem[] {
  return rows.map((row) => {
    const district = parseDistrict(row, districtMap)
    const areaValue = Number(row.area || 0)
    const priceValue = Number(row.startingPrice || 0)
    const marketPriceValue = Number(row.marketPrice || 0)
    const auctionStatus = parseAuctionStatus(row)
    const layoutText = row.layout && row.layout !== '-' ? row.layout : ''
    const orientationText = row.orientation && row.orientation !== '-' ? row.orientation : ''
    const auctionMode = Number(row.auctionMode || 0)
    const auctionModeBadge = auctionMode === 1
      ? '/assets/icons/yipai.png'
      : auctionMode === 2
        ? '/assets/icons/erpai.png'
        : auctionMode === 3
          ? '/assets/icons/bianmai.png'
          : String(row.title || '').includes('一拍')
            ? '/assets/icons/yipai.png'
            : String(row.title || '').includes('二拍')
              ? '/assets/icons/erpai.png'
              : String(row.title || '').includes('变卖')
                ? '/assets/icons/bianmai.png'
                : ''

    return {
      id: row.id,
      sourceId: row.sourceId ?? row.id,
      communityNameText: row.communityName || row.title || '未知小区',
      auctionModeBadge,
      position: row.detailAddress || row.title || `${district}房源`,
      areaText: `${areaValue || '-'}㎡`,
      layoutText,
      orientationText,
      startingPriceText: `${priceValue || '-'}万`,
      marketPriceText: `${marketPriceValue || '-'}万`,
      auctionStatusText: auctionStatus.text,
      auctionStatusType: auctionStatus.type,
      auctionTimeText: row.auctionTime || '-',
      image: pickFirstImage(row.coverPic),
      district,
      areaValue,
      priceValue,
    }
  })
}

function buildDistrictOptions(regionNames: string[]): string[] {
  const cleanedNames = regionNames
    .map((name) => (name || '').trim())
    .filter((name) => Boolean(name) && name !== '不限')
  const result = ['不限']
  cleanedNames.forEach((name) => {
    if (result.indexOf(name) < 0) result.push(name)
  })
  return result
}

function toCountText(value?: string | number): string {
  if (value === null || value === undefined || value === '') return '--'
  return String(value)
}

function getRouteOptions(): Record<string, string> {
  const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
  const lastPage = pages[pages.length - 1]
  return (lastPage && lastPage.options) || {}
}

function readWechatLoginCache(): WechatTestResult | null {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    if (!cached) return null
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const phoneNumber = String(source?.phoneNumber || source?.matchedPerson?.phone || '').trim()
    if (!phoneNumber) return null
    const accessGranted = hasWechatAccess(source)
    return {
      openid: phoneNumber,
      unionid: String((source && source.unionid) || '').trim(),
      phoneNumber,
      isSales: Boolean(source?.isSales),
      canShareMiniProgram: Boolean(source?.canShareMiniProgram),
      accessGranted,
      accessMessage: String(source?.accessMessage || '').trim(),
      authorizedUntil: String(source?.authorizedUntil || '').trim(),
      shareAction: source?.shareAction || 'none',
      matchedPerson: source?.matchedPerson || null,
      salesPerson: source?.salesPerson || null,
      binding: source?.binding || null,
      share: source?.share || null,
    }
  } catch (error) {
    console.warn('read wechat login cache failed:', error)
    return null
  }
}

function saveWechatLoginCache(result: WechatTestResult) {
  const phoneNumber = String(result.phoneNumber || result.matchedPerson?.phone || result.openid || '').trim()
  if (!phoneNumber) return
  const accessGranted = hasWechatAccess(result)
  wx.setStorageSync(WECHAT_LOGIN_STORAGE_KEY, {
    openid: phoneNumber,
    unionid: '',
    phoneNumber,
    isSales: Boolean(result.isSales),
    canShareMiniProgram: Boolean(result.canShareMiniProgram),
    accessGranted,
    accessMessage: String(result.accessMessage || ''),
    authorizedUntil: String(result.authorizedUntil || ''),
    shareAction: result.shareAction || 'none',
    matchedPerson: result.matchedPerson || null,
    salesPerson: result.salesPerson || null,
    binding: result.binding || null,
    share: result.share || null,
  })
}

function clearWechatLoginCache() {
  try {
    wx.removeStorageSync(WECHAT_LOGIN_STORAGE_KEY)
  } catch (error) {
    console.warn('clear wechat login cache failed:', error)
  }
}

function saveCurrentShareCache(share: { shareKey?: string; salesOpenid?: string; expireAt?: string } | null) {
  if (!share?.shareKey) return
  try {
    wx.setStorageSync(CURRENT_SHARE_STORAGE_KEY, share)
  } catch (error) {
    console.warn('save current share cache failed:', error)
  }
}

function readCurrentShareKey(): string {
  try {
    const cached = wx.getStorageSync(CURRENT_SHARE_STORAGE_KEY)
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const expireAt = source?.expireAt ? new Date(source.expireAt).getTime() : 0
    if (!expireAt || expireAt <= Date.now()) return ''
    return String(source?.shareKey || '').trim()
  } catch (error) {
    console.warn('read current share key failed:', error)
    return ''
  }
}

function hasWechatAccess(profile?: Partial<WechatTestResult> | null): boolean {
  if (canWechatShare(profile) || profile?.accessGranted) return true
  const role = String(profile?.matchedPerson?.role || '').trim()
  return role === '销售' || role === '管理员'
}

function showNoAccessToast(message?: string) {
  wx.showToast({
    title: message || '请通过销售分享进入',
    icon: 'none',
  })
}

Page({
  data: {
    mapLongitude: 106.551556,
    mapLatitude: 29.563009,
    mapScale: 12,
    mapMarkers: [
      {
        id: 1,
        longitude: 106.551556,
        latitude: 29.563009,
        width: 24,
        height: 24,
      },
    ],
    pageNo: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: true,
    isLoadingMore: false,
    keyword: '',
    filterOptions: {
      area: FALLBACK_DISTRICTS.slice(),
      layout: ['面积', '50㎡以下', '50-70㎡', '70-90㎡', '90-120㎡', '120-150㎡', '150㎡以上'],
      rent: ['价格', '50万以下', '50-70万', '70-80万', '80-100万', '100-110万', '110-130万', '130-150万', '150万以上'],
    },
    filterIndex: {
      area: 0,
      layout: 0,
      rent: 0,
    },
    feedLeft: [] as HouseItem[],
    feedRight: [] as HouseItem[],
    auctionStats: {
      todayIncreaseCount: '--',
      auctioningCount: '--',
      comeAuctioningCount: '--',
    },
    wechatTestLoading: false,
    wechatTestError: '',
    wechatTestStatusText: '',
    wechatTestResult: {
      openid: '',
      unionid: '',
      isSales: false,
      canShareMiniProgram: false,
      accessGranted: false,
      accessMessage: '',
      authorizedUntil: '',
      shareAction: 'none',
      matchedPerson: null,
        salesPerson: null,
        binding: null,
        share: null,
      phoneNumber: '',
    } as WechatTestResult,
    sharedShareKey: '',
    currentShareKey: '',
    salesName: '',
    showPhoneAuthDialog: false,
    introText: '',
  },

  onLoad(_query: Record<string, string>) {
    const districtList = buildDistrictOptions(FALLBACK_DISTRICTS)
    ;(this as any)._districtMap = new Map<number, string>(
      Object.entries(DISTRICT_ID_BY_NAME).map(([name, id]) => [id, name])
    )
    ;(this as any)._districtNameToIdMap = new Map<string, number>(
      Object.entries(DISTRICT_ID_BY_NAME)
    )
    ;(this as any)._visiblePool = [] as HouseItem[]

    const routeOptions = getRouteOptions()
    const { shareKey: sharedShareKey } = consumeShareParams(routeOptions)

    this.setData({
      filterOptions: Object.assign({}, this.data.filterOptions, { area: districtList }),
      sharedShareKey,
    })

    const cachedWechatLogin = readWechatLoginCache()
    if (cachedWechatLogin && this.hasCachedPhone(cachedWechatLogin)) {
      this.applyWechatProfile(cachedWechatLogin, '宸蹭粠缂撳瓨璇诲彇寰俊韬唤')
      void this.bootstrapWechatAccess(cachedWechatLogin, sharedShareKey)
    } else {
      clearWechatLoginCache()
      this.setData({
        wechatTestStatusText: '需要获取手机号',
        showPhoneAuthDialog: false,
      })
      setTimeout(() => {
        this.syncTabBarSelected()
      }, 0)
      return
    }

    this.loadAuctionStats()
    this.loadBasicSettings()
    if (hasWechatAccess(cachedWechatLogin)) this.refreshByFilter()
    setTimeout(() => {
      this.syncTabBarSelected()
    }, 0)

  },

  async loadBasicSettings() {
    try {
      const settings = await requestBasicSettings()
      this.setData({
        introText: String(settings.fapai_intro || '').trim(),
      })
    } catch (error) {
      this.setData({ introText: '' })
    }
  },

  onShow() {
    const { shareKey: sharedShareKey } = consumeShareParams()
    if (sharedShareKey) {
      this.setData({ sharedShareKey })
      const profile = this.data.wechatTestResult
      if (this.hasCachedPhone(profile)) {
        void this.bindSalesOpenidIfNeeded(profile, false)
      }
    }
    this.syncTabBarSelected()
    this.updateShareMenu()
    this.updatePhoneAuthDialog(undefined, false)
  },

  buildWechatStatusText(profile: WechatTestResult) {
    if (profile.accessMessage) return profile.accessMessage
    if (profile.canShareMiniProgram) return '销售身份已识别，可直接分享小程序'
    if (profile.salesPerson?.name) return `已绑定销售：${profile.salesPerson.name}`
    if (profile.binding?.salesOpenid) return '已绑定销售'
    return '微信身份已获取，等待绑定销售'
  },

  hasCachedPhone(profile?: Partial<WechatTestResult> | null) {
    return Boolean(String(profile?.phoneNumber || profile?.matchedPerson?.phone || '').trim())
  },

  updatePhoneAuthDialog(profile?: WechatTestResult, forceShow = false) {
    const dataProfile = this.data.wechatTestResult
    const currentProfile = profile || (this.hasCachedPhone(dataProfile) ? dataProfile : readWechatLoginCache())
    if (this.hasCachedPhone(currentProfile)) {
      if (this.data.showPhoneAuthDialog) this.setData({ showPhoneAuthDialog: false })
      return
    }
    if (forceShow) this.setData({ showPhoneAuthDialog: true })
  },

  promptPhoneAuth(statusText = '请先授权手机号后再查询房源') {
    this.setData({
      wechatTestStatusText: statusText,
      showPhoneAuthDialog: true,
    })
  },

  ensurePhoneAuth(statusText?: string) {
    if (this.hasCachedPhone(this.data.wechatTestResult) || this.hasCachedPhone(readWechatLoginCache())) {
      return true
    }
    this.promptPhoneAuth(statusText)
    return false
  },

  applyWechatProfile(profile: WechatTestResult, statusText?: string) {
    const hadAccess = hasWechatAccess(this.data.wechatTestResult)
    const hasAccess = hasWechatAccess(profile)
    const salesName = String(profile.matchedPerson?.name || profile.salesPerson?.name || '')
    saveWechatLoginCache(profile)
    this.setData({
      wechatTestLoading: false,
      wechatTestError: '',
      wechatTestResult: {
        phoneNumber: String(profile.phoneNumber || profile.matchedPerson?.phone || ''),
        openid: String(profile.phoneNumber || profile.matchedPerson?.phone || profile.openid || ''),
        unionid: '',
        isSales: Boolean(profile.isSales),
        canShareMiniProgram: Boolean(profile.canShareMiniProgram),
        accessGranted: hasAccess,
        accessMessage: String(profile.accessMessage || ''),
        authorizedUntil: String(profile.authorizedUntil || ''),
        shareAction: profile.shareAction || 'none',
        matchedPerson: profile.matchedPerson || null,
        salesPerson: profile.salesPerson || null,
        binding: profile.binding || null,
        share: profile.share || null,
      },
      wechatTestStatusText: statusText || this.buildWechatStatusText(profile),
      salesName,
    })
    this.updatePhoneAuthDialog(profile)
    this.updateShareMenu()
    if (profile.share?.shareKey) {
      saveCurrentShareCache(profile.share)
      this.setData({ currentShareKey: String(profile.share.shareKey || '') })
    }
    if (!hadAccess && hasAccess) {
      this.refreshByFilter()
    } else if (hadAccess && !hasAccess) {
      this.setData({
        feedLeft: [],
        feedRight: [],
        hasMore: false,
        isLoadingMore: false,
      })
    }
  },

  async bootstrapWechatAccess(cachedProfile: WechatTestResult, shareKey: string) {
    const phone = String(cachedProfile.phoneNumber || cachedProfile.openid || '').trim()
    let profile = cachedProfile
    try {
      if (phone) {
        const refreshed = await requestPhoneProfile({
          phoneNumber: phone,
          shareKey: shareKey || undefined,
        })
        profile = refreshed as WechatTestResult
      }
    } catch (error) {
      console.warn('refresh wechat access profile failed:', error)
    }
    this.applyWechatProfile(profile, '已从缓存读取微信身份')
    await this.bindSalesOpenidIfNeeded(profile, false)
    this.loadAuctionStats()
    this.refreshByFilter()
    setTimeout(() => {
      this.syncTabBarSelected()
    }, 0)
  },

  async bindSalesOpenidIfNeeded(profile: WechatTestResult, showToast = false) {
    const currentPhone = String(profile.phoneNumber || profile.openid || '').trim()
    const shareKey = String(this.data.sharedShareKey || '').trim()
    if (!currentPhone || !shareKey) return
    if (profile.canShareMiniProgram) return
    const staffRole = String(profile.matchedPerson?.role || '').trim()
    if (staffRole === '销售' || staffRole === '管理员') return

    const boundProfile = await requestBindSalesOpenid({
      phoneNumber: currentPhone,
      shareKey,
    })
    this.applyWechatProfile(boundProfile, this.buildWechatStatusText(boundProfile))
    if (showToast) {
      const title = boundProfile.shareAction === 'invalid'
        ? (boundProfile.accessMessage || '分享无效')
        : boundProfile.shareAction === 'expired'
          ? (boundProfile.accessMessage || '分享已过期，请联系销售')
        : boundProfile.shareAction === 'rebound'
          ? '已重新绑定销售'
          : boundProfile.shareAction === 'already_bound'
            ? '已在有效期内'
            : '已绑定销售'
      wx.showToast({ title, icon: boundProfile.shareAction === 'invalid' || boundProfile.shareAction === 'expired' ? 'none' : 'success' })
    }
  },

  async ensureCurrentShareKey(profile: WechatTestResult) {
    const currentPhone = String(profile.phoneNumber || profile.openid || '').trim()
    if (!canWechatShare(profile) || !currentPhone) return ''
    if (profile.share?.shareKey) {
      saveCurrentShareCache(profile.share)
      this.setData({ currentShareKey: String(profile.share.shareKey || '') })
      return String(profile.share.shareKey || '')
    }
    try {
      const share = await requestCreateWechatShare({ phoneNumber: currentPhone })
      saveCurrentShareCache(share)
      this.setData({ currentShareKey: String(share.shareKey || '') })
      return String(share.shareKey || '')
    } catch (error) {
      console.warn('create wechat share failed:', error)
      return ''
    }
  },

  onRejectPhoneAuth() {
    this.setData({ showPhoneAuthDialog: false })
    wx.exitMiniProgram({
      fail: () => {
        wx.showToast({ title: '已拒绝授权', icon: 'none' })
      },
    })
  },

  onOpenLegalDocument(e: WechatMiniprogram.CustomEvent<{ type?: LegalDocumentType }>) {
    const type = String(e.currentTarget.dataset.type || '').trim() as LegalDocumentType
    wx.navigateTo({ url: type === 'privacy' ? '/pages/privacy/index' : '/pages/agreement/index' })
  },

  updateShareMenu() {
    syncWechatShareMenu(this.data.wechatTestResult)
  },

  async loadAuctionStats() {
    try {
      const data = await requestServiceTel(DEFAULT_CITY_NAME)
      this.setData({
        auctionStats: {
          todayIncreaseCount: toCountText(data.todayIncreaseCount),
          auctioningCount: toCountText(data.auctioningCount),
          comeAuctioningCount: toCountText(data.comeAuctioningCount),
        },
      })
    } catch (error) {
      console.error('service tel request failed:', error)
    }
  },

  syncTabBarSelected() {
    const tabBar = (this as any).getTabBar ? (this as any).getTabBar() : null
    if (tabBar && tabBar.setSelected) tabBar.setSelected(0)
  },

  refreshByFilter() {
    ;(this as any)._visiblePool = []
    this.setData({ pageNo: 1, hasMore: true, feedLeft: [], feedRight: [] })
    this.loadMore(true)
  },

  buildQueryContext(pageNo: number) {
    const { area, layout, rent } = this.data.filterIndex
    const selectedDistrict = this.data.filterOptions.area[area]
    const areaRange = layout > 0 ? parseAreaRange(this.data.filterOptions.layout[layout]) : {}
    const priceRange = rent > 0 ? parsePriceRange(this.data.filterOptions.rent[rent]) : {}
    const districtNameToIdMap = (this as any)._districtNameToIdMap as Map<string, number>
    const keyword = this.data.keyword.trim()
    const districtId = area > 0 && districtNameToIdMap ? districtNameToIdMap.get(selectedDistrict) : undefined

    const query: HouseListQuery = {
      pageNum: pageNo,
      pageSize: this.data.pageSize,
      cityName: DEFAULT_CITY_NAME,
      houseTypeId: DEFAULT_HOUSE_TYPE_ID,
    }

    if (keyword) query.searchName = keyword
    if (area > 0) {
      query.districtName = selectedDistrict
      if (districtId) query.districtId = districtId
    }
    if (areaRange.minArea !== undefined) query.minArea = areaRange.minArea
    if (areaRange.maxArea !== undefined) query.maxArea = areaRange.maxArea
    if (priceRange.minPrice !== undefined) query.minStartingPrice = priceRange.minPrice
    if (priceRange.maxPrice !== undefined) query.maxStartingPrice = priceRange.maxPrice

    return { query }
  },

  applyListResult(list: HouseItem[], total: number, pageNo: number, reset: boolean) {
    const visiblePool = reset
      ? list
      : (((this as any)._visiblePool as HouseItem[]) || []).concat(list)
    ;(this as any)._visiblePool = visiblePool
    const { left, right } = splitColumns(visiblePool)
    this.setData({
      feedLeft: left,
      feedRight: right,
      pageNo: pageNo + 1,
      hasMore: visiblePool.length < total,
      isLoadingMore: false,
    })
  },

  fetchHouseList(pageNo: number): Promise<{ rows: YinshanRow[]; total: number }> {
    const { query } = this.buildQueryContext(pageNo) as { query: HouseListQuery }
    return requestHouseList(query) as Promise<{ rows: YinshanRow[]; total: number }>
  },

  async loadMore(reset = false) {
    if (!hasWechatAccess(this.data.wechatTestResult)) {
      this.setData({
        feedLeft: [],
        feedRight: [],
        hasMore: false,
        isLoadingMore: false,
      })
      return
    }
    if (!this.data.hasMore || this.data.isLoadingMore) return

    this.setData({ isLoadingMore: true })
    const pageNo = reset ? 1 : this.data.pageNo
    try {
      const { rows, total } = await this.fetchHouseList(pageNo)
      const districtMap = (this as any)._districtMap as Map<number, string>
      const list = normalizeYinshanRows(rows, districtMap)
      this.applyListResult(list, total, pageNo, reset)
    } catch (error) {
      this.setData({ isLoadingMore: false })
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
    }
  },

  onLoadMore() {
    this.loadMore()
  },

  onHouseTap(e: WechatMiniprogram.CustomEvent<{ id: string | number }>) {
    if (!this.ensurePhoneAuth('请先授权手机号后再查看房源详情')) return
    if (!hasWechatAccess(this.data.wechatTestResult)) {
      showNoAccessToast(this.data.wechatTestResult.accessMessage)
      return
    }
    const id = Number(e.currentTarget.dataset.id)
    const sourceId = Number((e.currentTarget.dataset as { sourceid?: string | number }).sourceid || 0)
    if (!id) return
    wx.navigateTo({
      url: `/pages/housedetail/index?id=${id}&sourceId=${sourceId || id}`,
    })
  },

  onMapEntryTap() {
    if (!this.ensurePhoneAuth('请先授权手机号后再使用地图找房')) return
    if (!hasWechatAccess(this.data.wechatTestResult)) {
      showNoAccessToast(this.data.wechatTestResult.accessMessage)
      return
    }
    wx.navigateTo({
      url: '/pages/maphouse/index',
    })
  },

  onStatCardTap(e: WechatMiniprogram.CustomEvent<{ type: string | number }>) {
    if (!this.ensurePhoneAuth('请先授权手机号后再查看房源列表')) return
    if (!hasWechatAccess(this.data.wechatTestResult)) {
      showNoAccessToast(this.data.wechatTestResult.accessMessage)
      return
    }
    const type = Number(e.currentTarget.dataset.type || 1)
    wx.navigateTo({
      url: `/pages/auctionlist/index?type=${type}&cityName=${encodeURIComponent(DEFAULT_CITY_NAME)}`,
    })
  },

  onAreaFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.area': Number(e.detail.value) })
    this.refreshByFilter()
  },

  onLayoutFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.layout': Number(e.detail.value) })
    this.refreshByFilter()
  },

  onRentFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.rent': Number(e.detail.value) })
    this.refreshByFilter()
  },

  onKeywordInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keyword: e.detail.value || '' })
  },

  onSearchConfirm() {
    if (!this.ensurePhoneAuth()) return
    this.refreshByFilter()
  },

  onSearchTap() {
    if (!this.ensurePhoneAuth()) return
    this.refreshByFilter()
  },

  async onBindStaffPhone(e: WechatMiniprogram.ButtonGetPhoneNumber) {
    const code = String(e.detail?.code || '').trim()
    if (!code) {
      wx.showToast({ title: '需要授权手机号', icon: 'none' })
      this.onRejectPhoneAuth()
      return
    }
    try {
      const profile = await requestBindStaffPhone({
        code,
        shareKey: String(this.data.sharedShareKey || '').trim() || undefined,
      })
      const wechatProfile = profile as WechatTestResult
      this.applyWechatProfile(wechatProfile, this.buildWechatStatusText(wechatProfile))
      await this.ensureCurrentShareKey(wechatProfile)
      await this.bindSalesOpenidIfNeeded(wechatProfile, false)
      this.loadAuctionStats()
      this.refreshByFilter()
      const granted = hasWechatAccess(this.data.wechatTestResult)
      const shareAction = this.data.wechatTestResult.shareAction
      const deniedTitle = shareAction === 'invalid'
        ? (this.data.wechatTestResult.accessMessage || '分享无效')
        : shareAction === 'expired'
          ? (this.data.wechatTestResult.accessMessage || '分享已过期，请联系销售')
          : (this.data.wechatTestResult.accessMessage || '请通过销售分享进入')
      wx.showToast({
        title: granted ? '手机号绑定成功' : deniedTitle,
        icon: granted ? 'success' : 'none',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '手机号绑定失败'
      wx.showToast({ title: message, icon: 'none' })
      if (message === '需要授权手机号') this.onRejectPhoneAuth()
    }
  },

  onShareAppMessage() {
    const profile = this.data.wechatTestResult as WechatTestResult
    if (!canWechatShare(profile)) {
      return {
        title: '\u200B',
        path: '/pages/index/index',
      }
    }

    const shareKey = encodeURIComponent(String(this.data.currentShareKey || profile.share?.shareKey || readCurrentShareKey() || ''))
    const sharePath = shareKey
      ? `/pages/index/index?shareKey=${shareKey}`
      : '/pages/index/index'
    const title = '\u200B'

    return {
      title,
      path: sharePath,
      promise: requestCreateWechatShare({ phoneNumber: String(profile.phoneNumber || profile.openid || '') }).then((share) => {
        saveCurrentShareCache(share)
        const freshShareKey = encodeURIComponent(String(share.shareKey || ''))
        return {
          title,
          path: freshShareKey
            ? `/pages/index/index?shareKey=${freshShareKey}`
            : sharePath,
        }
      }).catch(() => ({ title, path: sharePath })),
    } as any
  },

  onShareTimeline() {
    const profile = this.data.wechatTestResult as WechatTestResult
    if (!canWechatShare(profile)) {
      return {
        title: '\u200B',
        query: '',
      }
    }

    const shareKey = encodeURIComponent(String(this.data.currentShareKey || profile.share?.shareKey || readCurrentShareKey() || ''))
    const query = shareKey ? `shareKey=${shareKey}` : ''
    const title = '\u200B'

    return {
      title,
      query,
      promise: requestCreateWechatShare({ phoneNumber: String(profile.phoneNumber || profile.openid || '') }).then((share) => {
        saveCurrentShareCache(share)
        const freshShareKey = encodeURIComponent(String(share.shareKey || ''))
        return {
          title,
          query: freshShareKey ? `shareKey=${freshShareKey}` : query,
        }
      }).catch(() => ({ title, query })),
    } as any
  },
})
