import { requestSpecialAssetDetail } from '../../services/house'
import { rememberWechatShareKey } from '../../utils/wechat-access'

type SpecialAssetRow = import('../../services/house').SpecialAssetRow

type InfoItem = { label: string; value: string }

type SpecialAssetDetailView = {
  title: string
  position: string
  desc: string
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
}

const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'
const MIN_DOWN_PAYMENT_RATIO = 0.03
const MAX_DOWN_PAYMENT_RATIO = 0.05
const DEFAULT_MORTGAGE_YEARS = 30
const DEFAULT_ANNUAL_INTEREST_RATE = 3.15

function canViewDetail(): boolean {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    return Boolean(
      source?.canShareMiniProgram
      || (source?.accessGranted && (source?.matchedPerson || source?.binding?.salesOpenid))
    )
  } catch (error) {
    console.warn('read wechat access failed:', error)
    return false
  }
}

function normalizeText(value?: string | number | null): string {
  return String(value ?? '').trim()
}

function normalizeNumberText(value?: string | number | null): string {
  return normalizeText(value).replace(/,/g, '')
}

function hasUnitText(value: string): boolean {
  return /[万亿千百元㎡平方米]/.test(value)
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

function calculateMonthlyPayment(loanAmountYuan: number): number {
  if (!loanAmountYuan) return 0
  const totalMonths = DEFAULT_MORTGAGE_YEARS * 12
  const monthlyRate = (DEFAULT_ANNUAL_INTEREST_RATE / 100) / 12
  const factor = Math.pow(1 + monthlyRate, totalMonths)
  return Math.round((loanAmountYuan * monthlyRate * factor) / (factor - 1))
}

function calculateLoanTexts(priceValue: number): { downPaymentText: string; monthlyPaymentText: string } {
  const downMin = roundToOneDecimal(priceValue * MIN_DOWN_PAYMENT_RATIO)
  const downMax = roundToOneDecimal(priceValue * MAX_DOWN_PAYMENT_RATIO)
  const minLoan = priceValue * (1 - MAX_DOWN_PAYMENT_RATIO) * 10000
  const maxLoan = priceValue * (1 - MIN_DOWN_PAYMENT_RATIO) * 10000
  const monthlyMin = calculateMonthlyPayment(minLoan)
  const monthlyMax = calculateMonthlyPayment(maxLoan)
  return {
    downPaymentText: formatRangeText(downMin, downMax, '万'),
    monthlyPaymentText: formatRangeText(Math.min(monthlyMin, monthlyMax), Math.max(monthlyMin, monthlyMax), '元'),
  }
}

function collectImages(row: SpecialAssetRow): string[] {
  const coverImage = normalizeText(row.coverImage)
  const galleryImages = Array.isArray(row.galleryImages)
    ? row.galleryImages.map((item) => normalizeText(item)).filter(Boolean)
    : []
  const images = coverImage ? [coverImage].concat(galleryImages) : galleryImages
  return images.filter((item, index) => item && images.indexOf(item) === index)
}

function toView(row: SpecialAssetRow): SpecialAssetDetailView {
  const images = collectImages(row)
  const bedRoomNum = Number(row.bedRoomNum || 0)
  const hallNum = Number(row.hallNum || 0)
  const areaValue = Number(row.area || 0)
  const priceValue = Number(normalizeNumberText(row.totalPrice) || 0)
  const loanTexts = calculateLoanTexts(priceValue)
  const infoList: InfoItem[] = []
  const communityName = normalizeText(row.communityName)
  const floorState = normalizeText(row.floorState)
  const remark = normalizeText(row.remark)
  if (communityName) infoList.push({ label: '小区', value: communityName })
  if (floorState) infoList.push({ label: '楼层', value: floorState })
  if (normalizeText(row.createdAt)) infoList.push({ label: '发布时间', value: normalizeText(row.createdAt).slice(0, 10) })
  if (remark) infoList.push({ label: '备注', value: remark })
  return {
    title: normalizeText(row.title) || '特殊资产详情',
    position: communityName || '暂无小区',
    desc: normalizeText(row.assetDesc),
    images,
    hasImages: images.length > 0,
    totalPriceText: formatPriceText(row.totalPrice, '万'),
    unitPriceText: formatPriceText(row.unitPrice, '元/㎡'),
    downPaymentText: loanTexts.downPaymentText,
    monthlyPaymentText: loanTexts.monthlyPaymentText,
    layoutText: bedRoomNum > 0 ? `${bedRoomNum}室${hallNum || 0}厅` : '',
    areaText: areaValue > 0 ? `${areaValue}㎡` : '-',
    orientationText: normalizeText(row.orientation),
    infoList,
    contactName: normalizeText(row.contactName) || '资产顾问',
    contactPhone: normalizeText(row.contactPhone),
  }
}

Page({
  data: {
    currentImageIndex: 0,
    asset: {
      title: '',
      position: '',
      desc: '',
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
      contactName: '资产顾问',
      contactPhone: '',
    } as SpecialAssetDetailView,
  },
  async onLoad(query: Record<string, string>) {
    rememberWechatShareKey(query.shareKey)
    if (!canViewDetail()) {
      wx.showModal({
        title: '暂无查看权限',
        content: '请联系销售人员授权后查看详情。',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/specialassets/index' })
        },
      })
      return
    }
    const id = Number(decodeURIComponent(query.id || '0'))
    if (!id) {
      wx.showToast({ title: '资产不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
      return
    }
    try {
      const row = await requestSpecialAssetDetail(id)
      const view = toView(row)
      this.setData({ asset: view })
      wx.setNavigationBarTitle({ title: view.title || '特殊资产详情' })
    } catch (error) {
      console.error('special asset detail request failed:', error)
      wx.showToast({ title: '详情加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
    }
  },
  onSwiperChange(e: WechatMiniprogram.CustomEvent<{ current: number }>) {
    this.setData({ currentImageIndex: Number(e.detail.current || 0) })
  },
  onPreviewCurrentImage() {
    const current = this.data.asset.images[this.data.currentImageIndex]
    if (!current) return
    wx.previewImage({ current, urls: this.data.asset.images })
  },
  onCallTap() {
    const phoneNumber = String(this.data.asset.contactPhone || '').replace(/[^\d]/g, '')
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
})
