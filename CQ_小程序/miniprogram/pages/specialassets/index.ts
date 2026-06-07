import { requestBindSalesOpenid, requestBindStaffPhone, requestPhoneProfile, requestSpecialAssets } from '../../services/house'
import { consumeShareParams } from '../../utils/wechat-access'

type SpecialAssetRow = import('../../services/house').SpecialAssetRow
type WechatLoginData = import('../../services/house').WechatLoginData

type SpecialAssetItem = {
  id: string
  title: string
  position: string
  image: string
  hasImage: boolean
  areaText: string
  layoutText: string
  orientationText: string
  totalPriceText: string
  unitPriceText: string
  downPaymentText: string
  monthlyPaymentText: string
}

type LegalDocumentType = 'agreement' | 'privacy'

const DEFAULT_PAGE_SIZE = 10
const MIN_DOWN_PAYMENT_RATIO = 0.03
const MAX_DOWN_PAYMENT_RATIO = 0.05
const DEFAULT_MORTGAGE_YEARS = 30
const DEFAULT_ANNUAL_INTEREST_RATE = 3.15
const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'

function hasAccess(profile?: Partial<WechatLoginData> | null): boolean {
  if (profile?.canShareMiniProgram || profile?.accessGranted) return true
  const role = String(profile?.matchedPerson?.role || '').trim()
  return role === '销售' || role === '管理员'
}

function getRouteOptions(): Record<string, string> {
  const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
  const lastPage = pages[pages.length - 1]
  return (lastPage && lastPage.options) || {}
}

function readWechatProfile(): WechatLoginData | null {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    if (!cached) return null
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const phoneNumber = String(source?.phoneNumber || source?.matchedPerson?.phone || '').trim()
    if (!phoneNumber) return null
    const profile = Object.assign({}, source, {
      openid: phoneNumber,
      unionid: '',
      phoneNumber,
    }) as WechatLoginData
    profile.accessGranted = hasAccess(profile)
    return profile
  } catch (error) {
    console.warn('read wechat access failed:', error)
    return null
  }
}

function saveWechatProfile(profile: WechatLoginData) {
  const phoneNumber = String(profile.phoneNumber || profile.matchedPerson?.phone || profile.openid || '').trim()
  if (!phoneNumber) return
  wx.setStorageSync(WECHAT_LOGIN_STORAGE_KEY, Object.assign({}, profile, {
    openid: phoneNumber,
    unionid: '',
    phoneNumber,
    accessGranted: hasAccess(profile),
  }))
}

function clearWechatProfile() {
  try {
    wx.removeStorageSync(WECHAT_LOGIN_STORAGE_KEY)
  } catch (error) {
    console.warn('clear wechat profile failed:', error)
  }
}

function hasCachedPhone(profile?: Partial<WechatLoginData> | null): boolean {
  return Boolean(String(profile?.phoneNumber || profile?.matchedPerson?.phone || '').trim())
}

function normalizeText(value?: string | number | null): string {
  return String(value ?? '').trim()
}

function normalizeNumberText(value?: string | number | null): string {
  return normalizeText(value).replace(/,/g, '')
}

function hasUnitText(value: string): boolean {
  return /[万亿千百元㎡平米]/.test(value)
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
    if (unit === '万') return `${formatWan(minValue)}${unit}`
    return `${Math.round(minValue)}${unit}`
  }
  if (unit === '万') return `${formatWan(minValue)}-${formatWan(maxValue)}${unit}`
  return `${Math.round(minValue)}-${Math.round(maxValue)}${unit}`
}

function calculateMonthlyPayment(loanAmountYuan: number): number {
  if (!loanAmountYuan) return 0
  const totalMonths = DEFAULT_MORTGAGE_YEARS * 12
  const yearlyRate = DEFAULT_ANNUAL_INTEREST_RATE / 100
  const monthlyRate = yearlyRate / 12
  if (!monthlyRate || !totalMonths) return Math.round(loanAmountYuan / totalMonths)
  const factor = Math.pow(1 + monthlyRate, totalMonths)
  return Math.round((loanAmountYuan * monthlyRate * factor) / (factor - 1))
}

function calculateDownPaymentRange(priceValue: number): { minValue: number; maxValue: number } {
  return {
    minValue: roundToOneDecimal(priceValue * MIN_DOWN_PAYMENT_RATIO),
    maxValue: roundToOneDecimal(priceValue * MAX_DOWN_PAYMENT_RATIO),
  }
}

function calculateMonthlyPaymentRange(priceValue: number): { minValue: number; maxValue: number } {
  const minLoanAmountYuan = priceValue * (1 - MAX_DOWN_PAYMENT_RATIO) * 10000
  const maxLoanAmountYuan = priceValue * (1 - MIN_DOWN_PAYMENT_RATIO) * 10000
  const minValue = calculateMonthlyPayment(minLoanAmountYuan)
  const maxValue = calculateMonthlyPayment(maxLoanAmountYuan)
  return {
    minValue: Math.min(minValue, maxValue),
    maxValue: Math.max(minValue, maxValue),
  }
}

function toLayoutText(row: SpecialAssetRow): string {
  const bedRoomNum = Number(row.bedRoomNum || 0)
  const hallNum = Number(row.hallNum || 0)
  return bedRoomNum > 0 ? `${bedRoomNum}室${hallNum || 0}厅` : ''
}

function toAssetItem(row: SpecialAssetRow): SpecialAssetItem | null {
  const id = String(row.id || '')
  if (!id) return null
  const image = normalizeText(row.coverImage)
  const areaValue = Number(row.area || 0)
  const priceValue = Number(normalizeNumberText(row.totalPrice) || 0)
  const downPaymentRange = calculateDownPaymentRange(priceValue)
  const monthlyPaymentRange = calculateMonthlyPaymentRange(priceValue)
  return {
    id,
    title: normalizeText(row.title) || '特殊资产',
    position: normalizeText(row.communityName) || '暂无小区',
    image,
    hasImage: Boolean(image),
    areaText: areaValue > 0 ? `${areaValue}㎡` : '-',
    layoutText: toLayoutText(row),
    orientationText: normalizeText(row.orientation),
    totalPriceText: formatPriceText(row.totalPrice, '万'),
    unitPriceText: formatPriceText(row.unitPrice, '元/㎡'),
    downPaymentText: formatRangeText(downPaymentRange.minValue, downPaymentRange.maxValue, '万'),
    monthlyPaymentText: formatRangeText(monthlyPaymentRange.minValue, monthlyPaymentRange.maxValue, '元'),
  }
}

Page({
  data: {
    keyword: '',
    pageNo: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: true,
    isLoading: false,
    isLoadingMore: false,
    feedLeft: [] as SpecialAssetItem[],
    feedRight: [] as SpecialAssetItem[],
    canView: true,
    showPhoneAuthDialog: false,
    sharedShareKey: '',
  },
  async bindSalesOpenidIfNeeded(profile: WechatLoginData) {
    const currentPhone = String(profile.phoneNumber || profile.openid || '').trim()
    const shareKey = String(this.data.sharedShareKey || '').trim()
    if (!currentPhone || !shareKey || profile.canShareMiniProgram) {
      return profile
    }
    const staffRole = String(profile.matchedPerson?.role || '').trim()
    if (staffRole === '销售' || staffRole === '管理员') {
      return profile
    }
    const boundProfile = await requestBindSalesOpenid({
      phoneNumber: currentPhone,
      shareKey,
    })
    saveWechatProfile(boundProfile)
    return boundProfile
  },
  async refreshWechatProfile(profile: WechatLoginData) {
    const currentPhone = String(profile.phoneNumber || profile.openid || '').trim()
    if (!currentPhone) return profile
    try {
      const refreshedProfile = await requestPhoneProfile({
        phoneNumber: currentPhone,
        shareKey: String(this.data.sharedShareKey || '').trim() || undefined,
      })
      saveWechatProfile(refreshedProfile)
      return refreshedProfile
    } catch (error) {
      console.warn('refresh wechat profile failed:', error)
      return profile
    }
  },
  onLoad() {
    const routeOptions = getRouteOptions()
    const { shareKey: sharedShareKey } = consumeShareParams(routeOptions)
    this.setData({ sharedShareKey })

    const profile = readWechatProfile()
    const canUseCache = hasCachedPhone(profile)
    if (!canUseCache) clearWechatProfile()
    if (canUseCache && profile) {
      void this.refreshWechatProfile(profile).then((refreshedProfile) => this.bindSalesOpenidIfNeeded(refreshedProfile)).then((nextProfile) => {
        const canView = hasAccess(nextProfile)
        this.setData({ canView, showPhoneAuthDialog: false })
        if (canView) ;(this as any).refreshList()
      })
    }
    const canView = canUseCache && hasAccess(profile)
    this.setData({
      canView,
      showPhoneAuthDialog: false,
    })
    if (!canView) return
    if (canView) ;(this as any).refreshList()
  },
  onShow() {
    const { shareKey: sharedShareKey } = consumeShareParams()
    if (sharedShareKey) {
      this.setData({ sharedShareKey })
      const profile = readWechatProfile()
      if (hasCachedPhone(profile) && profile) {
        void this.refreshWechatProfile(profile).then((refreshedProfile) => this.bindSalesOpenidIfNeeded(refreshedProfile)).then((nextProfile) => {
          this.setData({
            canView: hasAccess(nextProfile),
            showPhoneAuthDialog: false,
          })
        })
      }
    }
    const tabBar = (this as any).getTabBar ? (this as any).getTabBar() : null
    if (tabBar && tabBar.setSelected) tabBar.setSelected(2)
    const profile = readWechatProfile()
    this.setData({
      canView: hasCachedPhone(profile) && hasAccess(profile),
      showPhoneAuthDialog: false,
    })
  },
  onKeywordInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keyword: e.detail.value || '' })
  },
  onSearchConfirm() {
    if (!this.ensurePhoneAuth()) return
    ;(this as any).refreshList()
  },
  onSearchTap() {
    if (!this.ensurePhoneAuth()) return
    ;(this as any).refreshList()
  },
  promptPhoneAuth() {
    this.setData({ showPhoneAuthDialog: true })
  },
  ensurePhoneAuth() {
    const profile = readWechatProfile()
    if (hasCachedPhone(profile)) return true
    this.promptPhoneAuth()
    return false
  },
  refreshList() {
    const profile = readWechatProfile()
    if (!hasCachedPhone(profile)) {
      this.setData({
        feedLeft: [],
        feedRight: [],
        hasMore: false,
      })
      return
    }
    this.setData({
      pageNo: 1,
      hasMore: true,
      feedLeft: [],
      feedRight: [],
    })
    ;(this as any).loadMore(true)
  },
  async loadMore(reset = false) {
    if (!this.data.canView || this.data.isLoading || this.data.isLoadingMore || (!reset && !this.data.hasMore)) return
    this.setData({
      isLoading: reset,
      isLoadingMore: !reset,
    })
    try {
      const pageNo = reset ? 1 : this.data.pageNo
      const response = await requestSpecialAssets({
        page: pageNo,
        pageSize: this.data.pageSize,
        keyword: this.data.keyword.trim(),
        status: 1,
      })
      const items = response.items
        .map(toAssetItem)
        .filter(Boolean) as SpecialAssetItem[]
      const allItems = reset ? items : this.data.feedLeft.concat(this.data.feedRight, items)
      const feedLeft: SpecialAssetItem[] = []
      const feedRight: SpecialAssetItem[] = []
      allItems.forEach((item, index) => {
        ;(index % 2 === 0 ? feedLeft : feedRight).push(item)
      })
      this.setData({
        feedLeft,
        feedRight,
        pageNo: pageNo + 1,
        hasMore: pageNo * response.pageSize < response.total,
      })
    } catch (error) {
      console.error('special assets request failed:', error)
      wx.showToast({ title: '特殊资产加载失败', icon: 'none' })
    } finally {
      this.setData({
        isLoading: false,
        isLoadingMore: false,
      })
    }
  },
  onLoadMore() {
    ;(this as any).loadMore(false)
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
      const boundProfile = await requestBindStaffPhone({
        code,
        shareKey: String(this.data.sharedShareKey || '').trim() || undefined,
      })
      const profileAfterShare = await this.bindSalesOpenidIfNeeded(boundProfile)
      saveWechatProfile(profileAfterShare)
      const canView = hasAccess(profileAfterShare)
      this.setData({
        canView,
        showPhoneAuthDialog: !hasCachedPhone(boundProfile),
      })
      if (canView) ;(this as any).refreshList()
      wx.showToast({
        title: canView ? '手机号绑定成功' : (profileAfterShare.accessMessage || '请通过销售分享进入'),
        icon: canView ? 'success' : 'none',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '手机号绑定失败'
      wx.showToast({ title: message, icon: 'none' })
    }
  },
  onAssetTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    if (!this.ensurePhoneAuth()) return
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/pages/specialassetdetail/index?id=${encodeURIComponent(id)}` })
  },
})
