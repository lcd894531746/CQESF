import { requestErshouDetailById, requestPhoneProfile } from '../../services/house'
import { cleanYinshanImageUrls } from '../../utils/clean-image'
import { canWechatShare, hasWechatAccess, readWechatLoginCache, rememberWechatShareKey, syncWechatShareMenu } from '../../utils/wechat-access'

type ErshouDetailRow = import('../../services/house').ErshouDetailRow
type WechatLoginData = import('../../services/house').WechatLoginData

type InfoItem = {
  label: string
  value: string
}

type ErshouDetailView = {
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
  metroTags: string[]
  featureTags: string[]
  contactName: string
  contactPhone: string
  longitude: number | null
  latitude: number | null
}

const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'
const CURRENT_SHARE_STORAGE_KEY = 'current_wechat_share'
const ERSHOU_DETAIL_CACHE_KEY = 'ershou_detail_cache'
const TEMP_CONTACT_NAME = '置业顾问'
const TEMP_CONTACT_PHONE = '123456789'
const MIN_DOWN_PAYMENT_RATIO = 0.03
const MAX_DOWN_PAYMENT_RATIO = 0.05
const DEFAULT_MORTGAGE_YEARS = 30
const DEFAULT_ANNUAL_INTEREST_RATE = 3.15

function normalizeText(value?: string | number | null): string {
  return String(value ?? '').trim()
}

function normalizeNumber(value?: string | number | null): number {
  const matched = String(value ?? '').match(/[\d.]+/)
  const parsed = Number((matched && matched[0]) || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasUnitText(value: string): boolean {
  return /[万亿千百元平米㎡]/.test(value)
}

function formatPriceText(value?: string | number | null, unit = ''): string {
  const text = normalizeText(value)
  if (!text) return '-'
  if (!unit || hasUnitText(text)) return text
  return `${text}${unit}`
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
    return totalMonths > 0 ? Math.round(loanAmountYuan / totalMonths) : 0
  }
  const factor = Math.pow(1 + monthlyRate, totalMonths)
  const payment = (loanAmountYuan * monthlyRate * factor) / (factor - 1)
  return Math.round(payment)
}

function calculateLoanTexts(priceValue: number): { downPaymentText: string; monthlyPaymentText: string } {
  if (priceValue <= 0) {
    return { downPaymentText: '-', monthlyPaymentText: '-' }
  }
  const downMin = roundToOneDecimal(priceValue * MIN_DOWN_PAYMENT_RATIO)
  const downMax = roundToOneDecimal(priceValue * MAX_DOWN_PAYMENT_RATIO)
  const minLoanAmountYuan = priceValue * (1 - MAX_DOWN_PAYMENT_RATIO) * 10000
  const maxLoanAmountYuan = priceValue * (1 - MIN_DOWN_PAYMENT_RATIO) * 10000
  const monthlyMin = calculateMonthlyPayment(minLoanAmountYuan, DEFAULT_ANNUAL_INTEREST_RATE)
  const monthlyMax = calculateMonthlyPayment(maxLoanAmountYuan, DEFAULT_ANNUAL_INTEREST_RATE)
  return {
    downPaymentText: formatRangeText(downMin, downMax, '万'),
    monthlyPaymentText: formatRangeText(Math.min(monthlyMin, monthlyMax), Math.max(monthlyMin, monthlyMax), '元'),
  }
}

function canViewErshouDetail(): boolean {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    return hasWechatAccess(source)
  } catch (error) {
    console.warn('read wechat access failed:', error)
    return false
  }
}

function readWechatShareKey(): string {
  try {
    const cached = wx.getStorageSync(CURRENT_SHARE_STORAGE_KEY)
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const expireAt = source?.expireAt ? new Date(source.expireAt).getTime() : 0
    if (!expireAt || expireAt <= Date.now()) return ''
    return String(source?.shareKey || '').trim()
  } catch (error) {
    console.warn('read wechat share key failed:', error)
    return ''
  }
}

function buildContactFromWechatProfile(profile?: WechatLoginData | null): { contactName: string; contactPhone: string } | null {
  if (!profile) return null

  if (canWechatShare(profile)) {
    const contactPhone = normalizeText(profile.matchedPerson?.phone) || normalizeText(profile.phoneNumber)
    if (!contactPhone) return null
    return {
      contactName: normalizeText(profile.matchedPerson?.name) || TEMP_CONTACT_NAME,
      contactPhone,
    }
  }

  const salesPhone = normalizeText(profile.salesPerson?.phone)
  if (!salesPhone) return null
  return {
    contactName: normalizeText(profile.salesPerson?.name) || TEMP_CONTACT_NAME,
    contactPhone: salesPhone,
  }
}

function resolvePhoneProfileShareKey(profile?: WechatLoginData | null): string {
  return String(
    readWechatShareKey()
    || profile?.share?.shareKey
    || profile?.binding?.shareKey
    || ''
  ).trim()
}

function parseCoordinate(value?: string | number | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function collectImages(row: ErshouDetailRow): string[] {
  const fromArray = (value?: string[] | null) => Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean)
    : []

  const resourcesPhotos = Array.isArray(row.resources?.photos)
    ? row.resources.photos.map((item) => normalizeText(item?.imageUrl)).filter(Boolean)
    : []

  const resourceVr = Array.isArray(row.resources?.vr)
    ? row.resources.vr.map((item) => normalizeText(item?.coverUrl)).filter(Boolean)
    : []

  const source = [
    normalizeText(row.coverImage),
    normalizeText(row.posterImage),
    normalizeText(row.poster_image),
    ...fromArray(row.galleryImages),
    ...fromArray(row.gallery_images),
    ...resourcesPhotos,
    ...resourceVr,
  ].filter(Boolean)

  return cleanYinshanImageUrls(source).filter((item, index, list) => item && list.indexOf(item) === index)
}

function buildLayoutText(row: ErshouDetailRow): string {
  if (normalizeText(row.propertyType)) return normalizeText(row.propertyType)
  const bedRoomNum = Number(row.bedRoomNum || 0)
  const hallNum = Number(row.hallNum || 0)
  if (bedRoomNum > 0 || hallNum > 0) {
    return `${bedRoomNum || 0}室${hallNum || 0}厅`
  }
  return ''
}

function buildPositionText(row: ErshouDetailRow): string {
  return normalizeText(row.houseLocationText)
    || normalizeText(row.communityName)
    || normalizeText(row.communityInfo?.resblockName)
    || normalizeText(row.title)
    || '暂无地址'
}

function pushInfo(list: InfoItem[], label: string, value?: string | number | null) {
  const text = normalizeText(value)
  if (!text) return
  list.push({ label, value: text })
}

function splitTagText(value?: string | null, mode: 'metro' | 'feature' = 'feature'): string[] {
  const raw = normalizeText(value)
  if (!raw) return []

  const parts = mode === 'metro'
    ? raw.split(/[\s|｜,，、]+/)
    : raw.split(/\s*\|\s*|[，,、]+/)

  return parts
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
}

function buildInfoList(row: ErshouDetailRow): InfoItem[] {
  const list: InfoItem[] = []
  pushInfo(list, '小区', row.communityName)
  pushInfo(list, '装修', row.decoration)
  pushInfo(list, '朝向', row.orientationText || row.orientation)
  pushInfo(list, '建筑年代', row.buildingYear || row.buildYear)
  pushInfo(list, '建筑结构', row.buildingStructure || row.buildingType)
  pushInfo(list, '楼层', row.floorText || row.floorState)
  pushInfo(list, '电梯', row.elevatorText || row.hasElevatorText)
  pushInfo(list, '物业类型', row.houseUse)
  pushInfo(list, '物业费', row.propertyFeeText)
  pushInfo(list, '房源位置', row.houseLocationText)
  return list
}

function toView(row: ErshouDetailRow): ErshouDetailView {
  const images = collectImages(row)
  const priceValue = normalizeNumber(row.price)
  const loanTexts = calculateLoanTexts(priceValue)
  const layoutText = buildLayoutText(row)
  const areaValue = normalizeNumber(row.area)
  return {
    id: normalizeText(row.listingId),
    houseCode: normalizeText(row.houseCode),
    title: normalizeText(row.title) || '低首付详情',
    position: buildPositionText(row),
    images,
    hasImages: images.length > 0,
    totalPriceText: formatPriceText(row.price, '万'),
    unitPriceText: formatPriceText(row.unitPrice, ''),
    downPaymentText: loanTexts.downPaymentText,
    monthlyPaymentText: loanTexts.monthlyPaymentText,
    layoutText,
    areaText: areaValue > 0 ? `${areaValue}㎡` : '-',
    orientationText: normalizeText(row.orientationText) || normalizeText(row.orientation),
    infoList: buildInfoList(row),
    metroTags: splitTagText(row.metroText, 'metro'),
    featureTags: splitTagText(row.tagsText, 'feature'),
    contactName: TEMP_CONTACT_NAME,
    contactPhone: TEMP_CONTACT_PHONE,
    longitude: parseCoordinate(row.longitude),
    latitude: parseCoordinate(row.latitude),
  }
}

function readDetailCache(): ErshouDetailView | null {
  try {
    const cached = wx.getStorageSync(ERSHOU_DETAIL_CACHE_KEY)
    if (!cached) return null
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    if (!source || !source.id) return null
    const images = Array.isArray(source.images)
      ? source.images.map((item: unknown) => normalizeText(item)).filter(Boolean)
      : []
    const infoList = Array.isArray(source.infoList)
      ? source.infoList
        .map((item: any) => ({ label: normalizeText(item?.label), value: normalizeText(item?.value) }))
        .filter((item) => item.label && item.value)
      : []
    const metroTags = Array.isArray(source.metroTags)
      ? source.metroTags.map((item: unknown) => normalizeText(item)).filter(Boolean)
      : []
    const featureTags = Array.isArray(source.featureTags)
      ? source.featureTags.map((item: unknown) => normalizeText(item)).filter(Boolean)
      : []
    return {
      id: normalizeText(source.id),
      houseCode: normalizeText(source.houseCode),
      title: normalizeText(source.title) || '低首付详情',
      position: normalizeText(source.position) || '暂无地址',
      images,
      hasImages: images.length > 0,
      totalPriceText: normalizeText(source.totalPriceText) || '-',
      unitPriceText: normalizeText(source.unitPriceText) || '-',
      downPaymentText: normalizeText(source.downPaymentText) || '-',
      monthlyPaymentText: normalizeText(source.monthlyPaymentText) || '-',
      layoutText: normalizeText(source.layoutText),
      areaText: normalizeText(source.areaText) || '-',
      orientationText: normalizeText(source.orientationText),
      infoList,
      metroTags,
      featureTags,
      contactName: TEMP_CONTACT_NAME,
      contactPhone: TEMP_CONTACT_PHONE,
      longitude: Number.isFinite(Number(source.longitude)) ? Number(source.longitude) : null,
      latitude: Number.isFinite(Number(source.latitude)) ? Number(source.latitude) : null,
    }
  } catch (error) {
    console.warn('read ershou detail cache failed:', error)
    return null
  }
}

function saveDetailCache(view: ErshouDetailView) {
  try {
    wx.setStorageSync(ERSHOU_DETAIL_CACHE_KEY, view)
  } catch (error) {
    console.warn('save ershou detail cache failed:', error)
  }
}

Page({
  data: {
    currentImageIndex: 0,
    house: {
      id: '',
      houseCode: '',
      title: '',
      position: '',
      images: [] as string[],
      hasImages: false,
      totalPriceText: '-',
      unitPriceText: '-',
      downPaymentText: '-',
      monthlyPaymentText: '-',
      layoutText: '',
      areaText: '-',
      orientationText: '',
      infoList: [] as InfoItem[],
      metroTags: [] as string[],
      featureTags: [] as string[],
      contactName: TEMP_CONTACT_NAME,
      contactPhone: TEMP_CONTACT_PHONE,
      longitude: null,
      latitude: null,
    } as ErshouDetailView,
  },
  async onLoad(query: Record<string, string>) {
    rememberWechatShareKey(query.shareKey)
    syncWechatShareMenu(readWechatLoginCache())
    if (!canViewErshouDetail()) {
      wx.showModal({
        title: '暂无权限',
        content: '请联系销售授权后查看详情。',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/ershou/index' })
        },
      })
      return
    }

    const listingId = Number(decodeURIComponent(query.listingId || query.id || '0'))
    const cached = readDetailCache()
    if (cached && cached.id === String(listingId || '')) {
      this.setData({ house: cached })
      wx.setNavigationBarTitle({ title: cached.title || '低首付详情' })
    }

    if (!listingId) {
      if (!cached) {
        wx.showToast({ title: '详情不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
      }
      return
    }

    try {
      const row = await requestErshouDetailById(listingId)
      const view = toView(row)
      const contact = await this.resolveWechatContact()
      if (contact) {
        view.contactName = contact.contactName
        view.contactPhone = contact.contactPhone
      }
      this.setData({
        currentImageIndex: 0,
        house: view,
      })
      saveDetailCache(view)
      wx.setNavigationBarTitle({ title: view.title || '低首付详情' })
    } catch (error) {
      console.error('ershou detail request failed:', error)
      if (!cached) {
        wx.showToast({ title: '详情加载失败', icon: 'none' })
        setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
      }
    }
  },
  onShow() {
    syncWechatShareMenu(readWechatLoginCache())
  },
  async resolveWechatContact() {
    const cachedProfile = readWechatLoginCache()
    const phoneNumber = String(cachedProfile?.phoneNumber || cachedProfile?.matchedPerson?.phone || '').trim()
    if (!phoneNumber) return buildContactFromWechatProfile(cachedProfile)

    try {
      const profile = await requestPhoneProfile({
        phoneNumber,
        shareKey: resolvePhoneProfileShareKey(cachedProfile) || undefined,
      })
      return buildContactFromWechatProfile(profile)
    } catch (error) {
      console.warn('resolve ershoudetail wechat contact failed:', error)
      return buildContactFromWechatProfile(cachedProfile)
    }
  },
  onSwiperChange(e: WechatMiniprogram.CustomEvent<{ current: number }>) {
    this.setData({ currentImageIndex: Number(e.detail.current || 0) })
  },
  onPreviewCurrentImage() {
    const current = this.data.house.images[this.data.currentImageIndex]
    if (!current) return
    wx.previewImage({ current, urls: this.data.house.images })
  },
  onGoLocationTap() {
    const { longitude, latitude, title, position } = this.data.house
    if (!Number.isFinite(Number(longitude)) || !Number.isFinite(Number(latitude))) {
      wx.showToast({ title: '暂无定位信息', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/houselocation/index?lng=${longitude}&lat=${latitude}&title=${encodeURIComponent(title)}&address=${encodeURIComponent(position)}`,
    })
  },
  onCallTap() {
    const phoneNumber = String(this.data.house.contactPhone || '').replace(/[^\d]/g, '')
    if (!phoneNumber) {
      wx.showToast({ title: '暂无联系电话', icon: 'none' })
      return
    }
    if (wx.getSystemInfoSync().platform === 'devtools') {
      wx.showToast({ title: '请在手机上拨打', icon: 'none' })
      return
    }
    wx.makePhoneCall({ phoneNumber })
  },
  onShareAppMessage() {
    if (!canWechatShare(readWechatLoginCache())) {
      return {
        title: '\u200B',
        path: '/pages/ershou/index',
      }
    }
    const shareKey = encodeURIComponent(readWechatShareKey())
    const path = shareKey ? `/pages/ershou/index?shareKey=${shareKey}` : '/pages/ershou/index'
    return {
      title: '\u200B',
      path,
    }
  },
  onShareTimeline() {
    if (!canWechatShare(readWechatLoginCache())) {
      return {
        title: '\u200B',
        query: '',
      }
    }
    const shareKey = encodeURIComponent(readWechatShareKey())
    const query = shareKey ? `shareKey=${shareKey}` : ''
    return {
      title: '\u200B',
      query,
    }
  },
})
