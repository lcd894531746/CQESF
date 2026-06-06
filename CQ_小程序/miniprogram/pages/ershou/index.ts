import { parseAreaRange, splitColumns } from '../../utils/house-filters.js'
import { canWechatShare, consumeShareParams, hasWechatAccess, syncWechatShareMenu } from '../../utils/wechat-access'
import {
  requestBasicSettings,
  requestBindSalesOpenid,
  requestBindStaffPhone,
  requestCreateWechatShare,
  requestErshouListings,
} from '../../services/house'
import { cleanYinshanImageUrl, cleanYinshanImageUrls } from '../../utils/clean-image'

type ErshouListingsQuery = import('../../services/house').ErshouListingsQuery
type ErshouListingsRow = import('../../services/house').ErshouListingsRow
type WechatLoginData = import('../../services/house').WechatLoginData

type InfoItem = {
  label: string
  value: string
}

type ErshouDetailCache = {
  id: string
  houseCode: string
  title: string
  position: string
  images: string[]
  hasImages: boolean
  totalPriceText: string
  unitPriceText: string
  downPaymentText: string
  monthlyPaymentText: string
  layoutText: string
  areaText: string
  orientationText: string
  infoList: InfoItem[]
  contactName: string
  contactPhone: string
  longitude: number | null
  latitude: number | null
}

type ErshouItem = {
  id: string
  houseCode: string
  title: string
  position: string
  image: string
  hasImage: boolean
  isNewToday: boolean
  areaText: string
  layoutText: string
  orientationText: string
  totalPriceText: string
  unitPriceText: string
  downPaymentText: string
  monthlyPaymentText: string
  downPaymentValueText: string
  downPaymentUnitText: string
  monthlyPaymentValueText: string
  monthlyPaymentUnitText: string
  areaValue: number
  detailPayload: ErshouDetailCache
}

type WechatLoginProfile = WechatLoginData
type LegalDocumentType = 'agreement' | 'privacy'

const DEFAULT_PAGE_SIZE = 10
const MIN_DOWN_PAYMENT_RATIO = 0.03
const MAX_DOWN_PAYMENT_RATIO = 0.05
const DEFAULT_MORTGAGE_YEARS = 30
const DEFAULT_ANNUAL_INTEREST_RATE = 3.15
const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'
const CURRENT_SHARE_STORAGE_KEY = 'current_wechat_share'
const ERSHOU_DETAIL_CACHE_KEY = 'ershou_detail_cache'
const DISTRICT_OPTIONS = ['不限', '大渡口', '渝中', '九龙坡', '沙坪坝', '巴南', '南岸', '两江新区']
const DISTRICT_NAMES = DISTRICT_OPTIONS.slice(1)
const MIN_PRICE_FILTER_OPTIONS = ['最低', '50万', '60万', '70万', '80万', '90万', '100万', '110万', '120万']
const MAX_PRICE_FILTER_OPTIONS = ['最高', '50万', '60万', '70万', '80万', '90万', '100万', '110万', '120万']

function parsePriceFilterValue(value?: string): number | null {
  const matched = String(value || '').match(/(\d+)/)
  if (!matched) return null
  const parsed = Number(matched[1])
  return Number.isFinite(parsed) ? parsed : null
}

function readWechatLoginCache(): WechatLoginProfile | null {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    if (!cached) return null
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const phoneNumber = String(source?.phoneNumber || source?.matchedPerson?.phone || '').trim()
    if (!phoneNumber) return null
    return {
      openid: phoneNumber,
      unionid: String(source?.unionid || '').trim(),
      phoneNumber,
      isSales: Boolean(source?.isSales),
      canShareMiniProgram: Boolean(source?.canShareMiniProgram),
      accessGranted: hasWechatAccess(source),
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

function saveWechatLoginCache(profile: WechatLoginProfile) {
  const phoneNumber = String(profile.phoneNumber || profile.matchedPerson?.phone || profile.openid || '').trim()
  if (!phoneNumber) return
  wx.setStorageSync(WECHAT_LOGIN_STORAGE_KEY, Object.assign({}, profile, {
    openid: phoneNumber,
    unionid: '',
    phoneNumber,
    accessGranted: hasWechatAccess(profile),
  }))
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

function showNoAccessToast(message?: string) {
  wx.showToast({
    title: message || '暂无权限',
    icon: 'none',
  })
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function formatWan(value: number): string {
  const rounded = roundToOneDecimal(value)
  return Number.isInteger(rounded) ? String(rounded.toFixed(0)) : String(rounded.toFixed(1))
}

function formatRangeText(minValue: number, maxValue: number, unit: string): string {
  if (minValue <= 0 && maxValue <= 0) return '-'
  if (Math.abs(minValue - maxValue) < 0.0001) {
    return unit === '万' ? `${formatWan(minValue)}${unit}` : `${Math.round(minValue)}${unit}`
  }
  return unit === '万'
    ? `${formatWan(minValue)}-${formatWan(maxValue)}${unit}`
    : `${Math.round(minValue)}-${Math.round(maxValue)}${unit}`
}

function calculateMonthlyPayment(loanAmountYuan: number, annualInterestRate: number): number {
  if (!loanAmountYuan) return 0
  const totalMonths = DEFAULT_MORTGAGE_YEARS * 12
  const yearlyRate = Number(annualInterestRate || 0) / 100
  const monthlyRate = yearlyRate / 12
  if (!monthlyRate || !totalMonths) {
    return Math.round(loanAmountYuan / totalMonths)
  }
  const factor = Math.pow(1 + monthlyRate, totalMonths)
  const payment = (loanAmountYuan * monthlyRate * factor) / (factor - 1)
  return Math.round(payment)
}

function calculateDownPaymentRange(priceValue: number): { minValue: number; maxValue: number } {
  return {
    minValue: roundToOneDecimal(priceValue * MIN_DOWN_PAYMENT_RATIO),
    maxValue: roundToOneDecimal(priceValue * MAX_DOWN_PAYMENT_RATIO),
  }
}

function calculateMonthlyPaymentRange(priceValue: number, annualInterestRate: number): { minValue: number; maxValue: number } {
  const minLoanAmountYuan = priceValue * (1 - MAX_DOWN_PAYMENT_RATIO) * 10000
  const maxLoanAmountYuan = priceValue * (1 - MIN_DOWN_PAYMENT_RATIO) * 10000
  const minValue = calculateMonthlyPayment(minLoanAmountYuan, annualInterestRate)
  const maxValue = calculateMonthlyPayment(maxLoanAmountYuan, annualInterestRate)
  return {
    minValue: Math.min(minValue, maxValue),
    maxValue: Math.max(minValue, maxValue),
  }
}

function parseNumberishValue(value?: string | number | null): number {
  const matched = String(value ?? '').match(/[\d.]+/)
  const parsed = Number((matched && matched[0]) || 0)
  return Number.isNaN(parsed) ? 0 : parsed
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function splitMetricText(value?: string): { valueText: string; unitText: string } {
  const source = String(value || '').trim()
  if (!source) {
    return { valueText: '-', unitText: '' }
  }
  const matched = source.match(/^([\d.\-]+)(.*)$/)
  if (!matched) {
    return { valueText: source, unitText: '' }
  }
  return {
    valueText: String(matched[1] || '').trim() || source,
    unitText: String(matched[2] || '').trim(),
  }
}

function parseListingDesc(desc?: string): { layoutText: string; areaValue: number; orientationText: string } {
  const segments = String(desc || '')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
  const layoutText = segments[0] || ''
  const areaMatch = (segments[1] || '').match(/([\d.]+)/)
  const areaValue = Number((areaMatch && areaMatch[1]) || 0)
  const orientationText = segments[2] || ''
  return { layoutText, areaValue, orientationText }
}

function parseBuildAreaValue(value?: string | number | null): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeText(value?: string | number | null): string {
  return String(value ?? '').trim()
}

function isSameLocalDate(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
}

function isCreatedToday(value?: string | null): boolean {
  const text = normalizeText(value)
  if (!text) return false
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return false
  return isSameLocalDate(parsed, new Date())
}

function normalizeDistrictName(value?: string | null): string {
  const normalized = normalizeText(value)
  switch (normalized) {
    case '大渡口':
    case '大渡口区':
      return '大渡口区'
    case '渝中':
    case '渝中区':
      return '渝中区'
    case '九龙坡':
    case '九龙坡区':
      return '九龙坡区'
    case '沙坪坝':
    case '沙坪坝区':
      return '沙坪坝区'
    case '巴南':
    case '巴南区':
      return '巴南区'
    case '南岸':
    case '南岸区':
      return '南岸区'
    default:
      return normalized
  }
}

function findDistrictOptionIndex(value?: string | null): number {
  const normalized = normalizeDistrictName(value)
  if (!normalized) return -1
  return DISTRICT_OPTIONS.findIndex((option) => normalizeDistrictName(option) === normalized)
}

function parseCoordinate(value?: string | number | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstImageFromValue(value?: string | string[] | null): string {
  if (Array.isArray(value)) {
    return String(value.find((item) => String(item || '').trim()) || '').trim()
  }
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return String(parsed.find((item) => String(item || '').trim()) || '').trim()
      }
    } catch (error) {
      console.warn('parse listing image json failed:', error)
    }
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .find(Boolean) || ''
}

function collectImages(value?: string | string[] | null): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }
  const raw = String(value || '').trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean)
      }
    } catch (error) {
      console.warn('parse listing images failed:', error)
    }
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function collectDetailImages(row: ErshouListingsRow): string[] {
  const source = [
    ...collectImages(row.galleryImages),
    ...collectImages(row.gallery_images),
  ]
  const poster = firstImageFromValue(row.posterImage)
    || firstImageFromValue(row.poster_image)
    || firstImageFromValue(row.coverPic)
  if (poster) source.unshift(poster)
  return cleanYinshanImageUrls(source).filter((item, index, list) => list.indexOf(item) === index)
}

function pickPosterImage(row: ErshouListingsRow): string {
  return cleanYinshanImageUrl(
    firstImageFromValue(row.posterImage)
    || firstImageFromValue(row.poster_image)
    || firstImageFromValue(row.coverPic)
  )
}

function parseListingDistrict(row: ErshouListingsRow): string {
  const districtName = normalizeDistrictName(row.districtName)
  if (districtName) return districtName
  const sourceText = [row.title, row.communityName, row.listingDesc].filter(Boolean).join(' ')
  return DISTRICT_NAMES.find((name) => sourceText.includes(name)) || '不限'
}

function buildDetailInfoList(row: ErshouListingsRow, district: string, parsed: { layoutText: string; areaValue: number; orientationText: string }): InfoItem[] {
  const infoList: InfoItem[] = []
  const communityName = normalizeText(row.communityName)
  if (communityName) infoList.push({ label: '小区', value: communityName })
  if (district && district !== '不限') infoList.push({ label: '区域', value: district })
  if (parsed.layoutText) infoList.push({ label: '户型', value: parsed.layoutText })
  if (parsed.areaValue > 0) infoList.push({ label: '面积', value: `${parsed.areaValue}㎡` })
  if (parsed.orientationText) infoList.push({ label: '朝向', value: parsed.orientationText })
  if (normalizeText(row.captureDate)) infoList.push({ label: '采集时间', value: normalizeText(row.captureDate) })
  return infoList
}

function buildDetailPayload(
  row: ErshouListingsRow,
  annualInterestRate: number,
  parsed: { layoutText: string; areaValue: number; orientationText: string },
  district: string
): ErshouDetailCache {
  const priceValue = parseNumberishValue(row.totalPriceText)
  const downPaymentRange = calculateDownPaymentRange(priceValue)
  const monthlyPaymentRange = calculateMonthlyPaymentRange(priceValue, annualInterestRate)
  const images = collectDetailImages(row)
  const title = normalizeText(row.title) || '低首付房源'
  const position = normalizeText(row.communityName) || title
  return {
    id: String(row.id || row.houseCode || ''),
    houseCode: normalizeText(row.houseCode),
    title,
    position,
    images,
    hasImages: images.length > 0,
    totalPriceText: row.totalPriceText ? `${normalizeText(row.totalPriceText)}${normalizeText(row.totalPriceUnit) || '万'}` : '-',
    unitPriceText: normalizeText(row.unitPriceText) || '-',
    downPaymentText: formatRangeText(downPaymentRange.minValue, downPaymentRange.maxValue, '万'),
    monthlyPaymentText: formatRangeText(monthlyPaymentRange.minValue, monthlyPaymentRange.maxValue, '元'),
    layoutText: parsed.layoutText,
    areaText: parsed.areaValue ? `${parsed.areaValue}㎡` : '-',
    orientationText: parsed.orientationText,
    infoList: buildDetailInfoList(row, district, parsed),
    contactName: '置业顾问',
    contactPhone: '4008001234',
    longitude: parseCoordinate(row.longitude),
    latitude: parseCoordinate(row.latitude),
  }
}

function toErshouItemFromApi(row: ErshouListingsRow, annualInterestRate: number): ErshouItem | null {
  if (!row.houseCode || row.cardType === 'xinfang') return null
  const parsed = parseListingDesc(row.listingDesc)
  const buildAreaValue = parseBuildAreaValue(row.buildAreaSqm)
  const resolvedParsed = {
    layoutText: parsed.layoutText,
    areaValue: buildAreaValue > 0 ? buildAreaValue : parsed.areaValue,
    orientationText: parsed.orientationText,
  }
  const image = pickPosterImage(row)
  const district = parseListingDistrict(row)
  const detailPayload = buildDetailPayload(row, annualInterestRate, resolvedParsed, district)
  const downPaymentMetric = splitMetricText(detailPayload.downPaymentText)
  const monthlyPaymentMetric = splitMetricText(detailPayload.monthlyPaymentText)
  return {
    id: String(row.id || row.houseCode),
    houseCode: normalizeText(row.houseCode),
    title: normalizeText(row.title) || '低首付房源',
    position: normalizeText(row.communityName) || normalizeText(row.title) || '低首付房源',
    image,
    hasImage: Boolean(image),
    isNewToday: isCreatedToday(row.createdAt),
    areaText: resolvedParsed.areaValue ? `${resolvedParsed.areaValue}㎡` : '-',
    layoutText: resolvedParsed.layoutText,
    orientationText: resolvedParsed.orientationText,
    totalPriceText: row.totalPriceText ? `${normalizeText(row.totalPriceText)}${normalizeText(row.totalPriceUnit) || '万'}` : '-',
    unitPriceText: normalizeText(row.unitPriceText) || '-',
    downPaymentText: detailPayload.downPaymentText,
    monthlyPaymentText: detailPayload.monthlyPaymentText,
    downPaymentValueText: downPaymentMetric.valueText,
    downPaymentUnitText: downPaymentMetric.unitText,
    monthlyPaymentValueText: monthlyPaymentMetric.valueText,
    monthlyPaymentUnitText: monthlyPaymentMetric.unitText,
    areaValue: resolvedParsed.areaValue,
    detailPayload,
  }
}

function getRouteOptions(): Record<string, string> {
  const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
  const lastPage = pages[pages.length - 1]
  return (lastPage && lastPage.options) || {}
}

Page({
  data: {
    keyword: '',
    pageNo: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: true,
    isRefreshing: false,
    isLoadingMore: false,
    filterOptions: {
      minPrice: MIN_PRICE_FILTER_OPTIONS.slice(),
      maxPrice: MAX_PRICE_FILTER_OPTIONS.slice(),
      area: DISTRICT_OPTIONS.slice(),
      layout: ['不限', '50㎡以下', '50-70㎡', '70-90㎡', '90-120㎡', '120-150㎡', '150㎡以上'],
    },
    filterIndex: {
      minPrice: 1,
      maxPrice: 8,
      area: 0,
      layout: 0,
    },
    feedLeft: [] as ErshouItem[],
    feedRight: [] as ErshouItem[],
    emptyResultText: '',
    wechatLoginStatusText: '',
    wechatLoginResult: {
      openid: '',
      unionid: '',
      phoneNumber: '',
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
    } as WechatLoginProfile,
    sharedShareKey: '',
    currentShareKey: '',
    showOpenidCard: false,
    annualInterestRate: DEFAULT_ANNUAL_INTEREST_RATE,
    showPhoneAuthDialog: false,
    introText: '',
  },
  onLoad(query: Record<string, string>) {
    ;(this as any)._visiblePool = [] as ErshouItem[]
    const routeOptions = Object.keys(query || {}).length > 0 ? query : getRouteOptions()
    const routeKeyword = decodeURIComponent(routeOptions.keyword || '')
    if (routeKeyword) this.setData({ keyword: routeKeyword })
    const routeDistrictName = decodeURIComponent(routeOptions.districtName || '')
    const routeDistrictIndex = findDistrictOptionIndex(routeDistrictName)
    if (routeDistrictIndex > 0) this.setData({ 'filterIndex.area': routeDistrictIndex })
    const { shareKey: sharedShareKey } = consumeShareParams(routeOptions)
    this.setData({ sharedShareKey })

    const cachedWechatLogin = readWechatLoginCache()
    if (cachedWechatLogin && this.hasCachedPhone(cachedWechatLogin)) {
      this.applyWechatProfile(cachedWechatLogin, '已读取缓存身份')
      void this.bindSalesOpenidIfNeeded(cachedWechatLogin)
    } else {
      clearWechatLoginCache()
      this.setData({
        wechatLoginStatusText: '需要先获取手机号',
        showPhoneAuthDialog: true,
      })
      return
    }

    this.loadBasicSettings().finally(() => {
      this.refreshByFilter()
    })
  },
  onShow() {
    const { shareKey: sharedShareKey } = consumeShareParams()
    if (sharedShareKey) {
      this.setData({ sharedShareKey })
      const profile = this.data.wechatLoginResult
      if (this.hasCachedPhone(profile)) {
        void this.bindSalesOpenidIfNeeded(profile)
      }
    }
    const tabBar = (this as any).getTabBar ? (this as any).getTabBar() : null
    if (tabBar && tabBar.setSelected) tabBar.setSelected(1)
    this.updateShareMenu()
    this.updatePhoneAuthDialog()
  },
  buildWechatStatusText(profile: WechatLoginProfile) {
    if (profile.accessMessage) return profile.accessMessage
    if (profile.canShareMiniProgram) return '销售身份已识别，可直接分享'
    if (profile.salesPerson?.name) return `已绑定销售：${profile.salesPerson.name}`
    if (profile.binding?.salesOpenid) return '已绑定销售'
    return '微信身份已获取，等待绑定销售'
  },
  hasCachedPhone(profile?: Partial<WechatLoginProfile> | null) {
    return Boolean(String(profile?.phoneNumber || profile?.matchedPerson?.phone || '').trim())
  },
  updatePhoneAuthDialog(profile?: WechatLoginProfile) {
    const dataProfile = this.data.wechatLoginResult
    const currentProfile = profile || (this.hasCachedPhone(dataProfile) ? dataProfile : readWechatLoginCache())
    this.setData({ showPhoneAuthDialog: !this.hasCachedPhone(currentProfile) })
  },
  applyWechatProfile(profile: WechatLoginProfile, statusText?: string) {
    const hadAccess = hasWechatAccess(this.data.wechatLoginResult)
    const hasAccess = hasWechatAccess(profile)
    saveWechatLoginCache(profile)
    this.setData({
      wechatLoginResult: {
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
      wechatLoginStatusText: statusText || this.buildWechatStatusText(profile),
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
  async bindSalesOpenidIfNeeded(profile: WechatLoginProfile) {
    const currentPhone = String(profile.phoneNumber || profile.openid || '').trim()
    const shareKey = String(this.data.sharedShareKey || '').trim()
    if (!currentPhone || !shareKey || profile.canShareMiniProgram) return
    try {
      const boundProfile = await requestBindSalesOpenid({
        phoneNumber: currentPhone,
        shareKey,
      })
      this.applyWechatProfile(boundProfile, this.buildWechatStatusText(boundProfile))
    } catch (error) {
      console.warn('bind sales openid failed:', error)
    }
  },
  async ensureCurrentShareKey(profile: WechatLoginProfile) {
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
      this.applyWechatProfile(profile, this.buildWechatStatusText(profile))
      await this.ensureCurrentShareKey(profile)
      await this.bindSalesOpenidIfNeeded(profile)
      this.loadBasicSettings().finally(() => {
        this.refreshByFilter()
      })
      wx.showToast({
        title: hasWechatAccess(this.data.wechatLoginResult) ? '手机号绑定成功' : '暂无权限',
        icon: hasWechatAccess(this.data.wechatLoginResult) ? 'success' : 'none',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '手机号绑定失败'
      wx.showToast({ title: message, icon: 'none' })
    }
  },
  onCopyOpenidTap() {
    const phoneNumber = String(this.data.wechatLoginResult.phoneNumber || this.data.wechatLoginResult.openid || '').trim()
    if (!phoneNumber) {
      wx.showToast({ title: '手机号为空', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: phoneNumber,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' })
      },
    })
  },
  updateShareMenu() {
    syncWechatShareMenu(this.data.wechatLoginResult)
  },
  async loadBasicSettings() {
    try {
      const settings = await requestBasicSettings()
      const annualInterestRate = Number(settings.interest_rate || DEFAULT_ANNUAL_INTEREST_RATE)
      this.setData({
        annualInterestRate: Number.isFinite(annualInterestRate) ? annualInterestRate : DEFAULT_ANNUAL_INTEREST_RATE,
        introText: String(settings.low_down_payment_intro || '').trim(),
      })
    } catch (error) {
      this.setData({
        annualInterestRate: DEFAULT_ANNUAL_INTEREST_RATE,
        introText: '',
      })
    }
  },
  refreshByFilter() {
    ;(this as any)._visiblePool = []
    this.setData({
      pageNo: 1,
      hasMore: true,
      feedLeft: [],
      feedRight: [],
      emptyResultText: '',
      isRefreshing: true,
    })
    this.loadMore(true)
  },
  buildApiQuery(pageNo: number): ErshouListingsQuery {
    const keyword = this.data.keyword.trim()
    const query: ErshouListingsQuery = {
      page: pageNo,
      pageSize: this.data.pageSize,
      includeTotal: false,
    }
    if (keyword) query.title = keyword
    if (this.data.filterIndex.area > 0) {
      query.districtName = normalizeDistrictName(this.data.filterOptions.area[this.data.filterIndex.area])
    }
    const minPrice = this.data.filterIndex.minPrice > 0
      ? parsePriceFilterValue(this.data.filterOptions.minPrice[this.data.filterIndex.minPrice])
      : null
    const maxPrice = this.data.filterIndex.maxPrice > 0
      ? parsePriceFilterValue(this.data.filterOptions.maxPrice[this.data.filterIndex.maxPrice])
      : null
    const areaRange = this.data.filterIndex.layout > 0
      ? parseAreaRange(this.data.filterOptions.layout[this.data.filterIndex.layout])
      : {}
    if (minPrice !== null) query.minPrice = minPrice
    if (maxPrice !== null) query.maxPrice = maxPrice
    if (areaRange.minArea !== undefined) query.minArea = areaRange.minArea
    if (areaRange.maxArea !== undefined) query.maxArea = areaRange.maxArea
    return query
  },
  applyLocalFilters(list: ErshouItem[]): ErshouItem[] {
    const areaRange = this.data.filterIndex.layout > 0 ? parseAreaRange(this.data.filterOptions.layout[this.data.filterIndex.layout]) : {}
    return list.filter((item) => {
      if (areaRange.minArea !== undefined && item.areaValue < areaRange.minArea) return false
      if (areaRange.maxArea !== undefined && item.areaValue > areaRange.maxArea) return false
      return true
    })
  },
  async loadMore(reset = false) {
    if (!hasWechatAccess(this.data.wechatLoginResult)) {
      this.setData({
        feedLeft: [],
        feedRight: [],
        hasMore: false,
        isLoadingMore: false,
      })
      return
    }
    if ((!this.data.hasMore && !reset) || this.data.isLoadingMore) return
    this.setData({ isLoadingMore: true })
    const pageNo = reset ? 1 : this.data.pageNo
    try {
      const { items, total, pageSize } = await requestErshouListings(this.buildApiQuery(pageNo))
      const annualInterestRate = Number(this.data.annualInterestRate || DEFAULT_ANNUAL_INTEREST_RATE)
      const apiList = items
        .map((item) => toErshouItemFromApi(item, annualInterestRate))
        .filter((item): item is ErshouItem => Boolean(item))
      const filteredPage = this.applyLocalFilters(apiList)
      const merged = reset ? filteredPage : (((this as any)._visiblePool || []) as ErshouItem[]).concat(filteredPage)
      ;(this as any)._visiblePool = merged
      const { left, right } = splitColumns(merged)
      const resolvedPageSize = pageSize || this.data.pageSize
      const hasMoreByTotal = total > 0 ? pageNo * resolvedPageSize < total : false
      const hasMoreByPageLength = total <= 0 ? apiList.length >= resolvedPageSize : false
      const emptyResultText = merged.length > 0
        ? ''
        : (hasMoreByTotal || hasMoreByPageLength)
          ? '当前页未命中筛选条件，继续下拉查看更多'
          : '暂无房源'
      this.setData({
        feedLeft: left,
        feedRight: right,
        pageNo: pageNo + 1,
        pageSize: resolvedPageSize,
        hasMore: hasMoreByTotal || hasMoreByPageLength,
        emptyResultText,
        isRefreshing: false,
        isLoadingMore: false,
      })
      if ((hasMoreByTotal || hasMoreByPageLength) && merged.length > 0 && merged.length <= resolvedPageSize) {
        await delay(80)
        this.loadMore()
      }
    } catch (error) {
      console.error('ershou listings request failed:', error)
      this.setData({ isRefreshing: false, isLoadingMore: false })
      wx.showToast({ title: '列表加载失败', icon: 'none' })
    }
  },
  onLoadMore() {
    this.loadMore()
  },
  onReachBottom() {
    this.loadMore()
  },
  onHouseTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    if (!hasWechatAccess(this.data.wechatLoginResult)) {
      showNoAccessToast(this.data.wechatLoginResult.accessMessage)
      return
    }
    const listingId = String(e.currentTarget.dataset.id || '')
    if (!listingId) return
    const visiblePool = (((this as any)._visiblePool || []) as ErshouItem[])
    const target = visiblePool.find((item) => item.id === listingId)
    if (!target) {
      wx.showToast({ title: '未找到详情数据', icon: 'none' })
      return
    }
    try {
      wx.setStorageSync(ERSHOU_DETAIL_CACHE_KEY, target.detailPayload)
    } catch (error) {
      console.warn('save ershou detail cache failed:', error)
    }
    wx.navigateTo({
      url: `/pages/ershoudetail/index?listingId=${encodeURIComponent(target.id)}&houseCode=${encodeURIComponent(target.houseCode)}`,
    })
  },
  onMapEntryTap() {
    if (!hasWechatAccess(this.data.wechatLoginResult)) {
      showNoAccessToast(this.data.wechatLoginResult.accessMessage)
      return
    }
    wx.navigateTo({ url: '/pages/maphouse/index?source=ershou' })
  },
  onAreaFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.area': Number(e.detail.value || 0) })
    this.refreshByFilter()
  },
  onLayoutFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.layout': Number(e.detail.value || 0) })
    this.refreshByFilter()
  },
  onMinPriceFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const nextIndex = Number(e.detail.value || 0)
    let nextMaxIndex = this.data.filterIndex.maxPrice
    if (nextMaxIndex > 0 && nextIndex > 0 && nextIndex > nextMaxIndex) {
      nextMaxIndex = nextIndex
    }
    this.setData({
      'filterIndex.minPrice': nextIndex,
      'filterIndex.maxPrice': nextMaxIndex,
    })
    this.refreshByFilter()
  },
  onMaxPriceFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const nextIndex = Number(e.detail.value || 0)
    let nextMinIndex = this.data.filterIndex.minPrice
    if (nextMinIndex > 0 && nextIndex > 0 && nextIndex < nextMinIndex) {
      nextMinIndex = nextIndex
    }
    this.setData({
      'filterIndex.minPrice': nextMinIndex,
      'filterIndex.maxPrice': nextIndex,
    })
    this.refreshByFilter()
  },
  onKeywordInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keyword: e.detail.value || '' })
  },
  onSearchConfirm() {
    this.refreshByFilter()
  },
  onSearchTap() {
    this.refreshByFilter()
  },
  onShareAppMessage() {
    const profile = this.data.wechatLoginResult as WechatLoginProfile
    if (!canWechatShare(profile)) {
      return {
        title: '\u200B',
        path: '/pages/ershou/index',
      }
    }
    const shareKey = encodeURIComponent(String(this.data.currentShareKey || profile.share?.shareKey || readCurrentShareKey() || ''))
    const sharePath = shareKey ? `/pages/ershou/index?shareKey=${shareKey}` : '/pages/ershou/index'
    const title = '\u200B'
    return {
      title,
      path: sharePath,
      promise: requestCreateWechatShare({ phoneNumber: String(profile.phoneNumber || profile.openid || '') }).then((share) => {
        saveCurrentShareCache(share)
        const freshShareKey = encodeURIComponent(String(share.shareKey || ''))
        return {
          title,
          path: freshShareKey ? `/pages/ershou/index?shareKey=${freshShareKey}` : sharePath,
        }
      }).catch(() => ({ title, path: sharePath })),
    } as any
  },
  onShareTimeline() {
    const profile = this.data.wechatLoginResult as WechatLoginProfile
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
