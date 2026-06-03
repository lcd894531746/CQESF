import { requestHouseDetail } from '../../services/house'
import { cleanYinshanImageUrls } from '../../utils/clean-image'
import { canWechatShare, readWechatLoginCache, syncWechatShareMenu } from '../../utils/wechat-access'

type HouseDetailRow = import('../../services/house').HouseDetailRow

type InfoItem = {
  label: string
  value: string
}

type DetailHouse = {
  id: number
  images: string[]
  title: string
  position: string
  startingPriceText: string
  marketPriceText: string
  layoutText: string
  areaText: string
  orientationText: string
  infoList: InfoItem[]
  auctionHint: string
  externalLink: string
  contactName: string
  contactPhone: string
  contactAvatar: string
  hasContactAvatar: boolean
  longitude: number | null
  latitude: number | null
}

const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'
const CURRENT_SHARE_STORAGE_KEY = 'current_wechat_share'

function splitImageUrls(raw?: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function dedupeImages(list: string[]): string[] {
  return list.filter((item, index) => item && list.indexOf(item) === index)
}

function resolveImages(row: HouseDetailRow): string[] {
  const images = cleanYinshanImageUrls(dedupeImages(splitImageUrls(row.detailPic)))
  return images.length > 0 ? images : ['/assets/icons/city-icon.png']
}

function normalizeText(value?: string | null): string {
  if (!value || value === '-') return ''
  return value.trim()
}

function parseLocation(location?: string | null): { longitude: number; latitude: number } | null {
  if (!location) return null
  const [lng, lat] = location.split(',').map((item) => Number(item.trim()))
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { longitude: lng, latitude: lat }
}

function formatNumberText(value?: number | null, unit = ''): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  const num = Number(value)
  return `${Number.isInteger(num) ? num : num.toFixed(2)}${unit}`
}

function guessDecorationText(code?: string | null): string {
  if (!code) return '未知'
  if (code === '1') return '简装'
  if (code === '2') return '精装修'
  if (code === '3') return '毛坯'
  return '未知'
}

function guessAuctionModeText(mode?: string | null): string {
  if (!mode) return '未知'
  if (mode === '1') return '一拍'
  if (mode === '2') return '二拍'
  if (mode === '3') return '变卖'
  return '未知'
}

function guessElevatorText(flag?: string | null): string {
  if (!flag) return '未知'
  if (flag === '1') return '有电梯'
  if (flag === '2') return '无电梯'
  return '未知'
}

function canViewInternalFields(): boolean {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    return canWechatShare(source)
  } catch (error) {
    console.warn('read wechat internal field access failed:', error)
    return false
  }
}

function buildInfoList(row: HouseDetailRow, showInternalFields: boolean): InfoItem[] {
  const list: InfoItem[] = []
  const communityName = normalizeText(row.communityName)
  const floorLevel = normalizeText(row.floorLevel)
  const buildYear = normalizeText(row.buildYear)
  const platform = normalizeText(row.platform)
  const auctionTime = normalizeText(row.auctionTime)

  if (communityName) list.push({ label: '小区', value: communityName })
  list.push({ label: '楼层', value: floorLevel || '未知' })
  list.push({ label: '电梯', value: guessElevatorText(row.elevator) })
  list.push({ label: '建成年代', value: buildYear ? `${buildYear}年` : '未知' })
  list.push({ label: '装修情况', value: guessDecorationText(row.decoration) })
  list.push({ label: '拍卖轮次', value: guessAuctionModeText(row.auctionMode) })
  if (showInternalFields && platform) list.push({ label: '拍卖平台', value: platform })
  if (auctionTime) list.push({ label: '开拍时间', value: auctionTime })
  if (row.guaranteeAmount !== null && row.guaranteeAmount !== undefined) {
    list.push({ label: '保证金', value: formatNumberText(row.guaranteeAmount, '万') })
  }
  if (row.markupPrice !== null && row.markupPrice !== undefined) {
    list.push({ label: '加价幅度', value: formatNumberText(row.markupPrice, '万') })
  }
  if (row.startingUnitPrice !== null && row.startingUnitPrice !== undefined) {
    list.push({ label: '起拍单价', value: formatNumberText(row.startingUnitPrice, '元/㎡') })
  }
  if (row.discountRate !== null && row.discountRate !== undefined) {
    list.push({ label: '折价率', value: formatNumberText(Number(row.discountRate) * 100, '%') })
  }
  return list
}

function toDetailHouse(row: HouseDetailRow): DetailHouse {
  const contactPhone = normalizeText(row.phone) || normalizeText(row.mobile) || '4008001234'
  const contactName = normalizeText(row.contactName) || normalizeText(row.brokerName) || '资产顾问'
  const contactAvatar = normalizeText(row.avatar) || normalizeText(row.brokerAvatar)
  const title = normalizeText(row.title) || '房源详情'
  const location = parseLocation(row.location)

  return {
    id: row.id,
    images: resolveImages(row),
    title,
    position: normalizeText(row.detailAddress) || normalizeText(row.address) || title,
    startingPriceText: formatNumberText(row.startingPrice, '万'),
    marketPriceText: formatNumberText(row.marketPrice, '万'),
    layoutText: normalizeText(row.layout),
    areaText: formatNumberText(row.area, '㎡'),
    orientationText: normalizeText(row.orientation),
    infoList: buildInfoList(row, canViewInternalFields()),
    auctionHint: row.auctionTime ? `预计开拍：${row.auctionTime}` : '开拍时间待确认',
    externalLink: normalizeText(row.jumpLink),
    contactName,
    contactPhone,
    contactAvatar,
    hasContactAvatar: Boolean(contactAvatar),
    longitude: location ? location.longitude : null,
    latitude: location ? location.latitude : null,
  }
}

function canViewHouseDetail(): boolean {
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

function readWechatSharePhone(): string {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    if (!cached) return ''
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    if (!canWechatShare(source)) return ''
    return String(source?.phoneNumber || source?.matchedPerson?.phone || source?.openid || '').trim()
  } catch (error) {
    console.warn('read wechat share openid failed:', error)
    return ''
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

Page({
  data: {
    currentImageIndex: 0,
    house: {
      id: 0,
      images: [] as string[],
      title: '',
      position: '',
      startingPriceText: '-',
      marketPriceText: '-',
      layoutText: '',
      areaText: '-',
      orientationText: '',
      infoList: [] as InfoItem[],
      auctionHint: '',
      externalLink: '',
      contactName: '璧勪骇椤鹃棶',
      contactPhone: '4008001234',
      contactAvatar: '',
      hasContactAvatar: false,
      longitude: null,
      latitude: null,
    } as DetailHouse,
  },
  onLoad(query: Record<string, string>) {
    syncWechatShareMenu(readWechatLoginCache())
    if (!canViewHouseDetail()) {
      wx.showModal({
        title: '暂无查看权限',
        content: '请联系销售人员授权后查看详情。',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/index/index' })
        },
      })
      return
    }
    const id = Number(query.id || 0)
    if (!id) {
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
      return
    }
    ;(this as any).loadDetail(id)
  },
  onShow() {
    syncWechatShareMenu(readWechatLoginCache())
  },
  async loadDetail(id: number) {
    try {
      const row = await requestHouseDetail(id)
      this.setData({
        currentImageIndex: 0,
        house: toDetailHouse(row),
      })
      wx.setNavigationBarTitle({
        title: normalizeText(row.communityName) || '房源详情',
      })
    } catch (error) {
      wx.showToast({ title: '房源详情加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
    }
  },
  onCallTap() {
    const phoneNumber = String(this.data.house.contactPhone || '')
      .replace(/^\+?86/, '')
      .replace(/[^\d]/g, '')
    if (!phoneNumber) {
      wx.showToast({ title: '暂无联系电话', icon: 'none' })
      return
    }
    if (wx.getSystemInfoSync().platform === 'devtools') {
      wx.showToast({ title: '请在手机上拨打', icon: 'none' })
      return
    }
    wx.makePhoneCall({
      phoneNumber,
      fail: () => wx.showToast({ title: '暂时无法发起拨号', icon: 'none' }),
    })
  },
  onSwiperChange(e: WechatMiniprogram.CustomEvent<{ current: number }>) {
    this.setData({
      currentImageIndex: Number(e.detail.current || 0),
    })
  },
  previewImageByIndex(index: number) {
    const urls = this.data.house.images
    if (!urls || urls.length === 0) return
    const safeIndex = Math.max(0, Math.min(index, urls.length - 1))
    const current = urls[safeIndex]
    if (!current) return
    wx.previewImage({
      current,
      urls,
    })
  },
  onPreviewCurrentImage() {
    ;(this as any).previewImageByIndex(Number(this.data.currentImageIndex || 0))
  },
  onPreviewImageTap(e: WechatMiniprogram.BaseEvent) {
    const index = Number(e.currentTarget.dataset.index || 0)
    ;(this as any).previewImageByIndex(index)
  },
  onPrevImage() {
    const total = this.data.house.images.length
    if (total <= 1) return
    const nextIndex = (this.data.currentImageIndex - 1 + total) % total
    this.setData({ currentImageIndex: nextIndex })
  },
  onNextImage() {
    const total = this.data.house.images.length
    if (total <= 1) return
    const nextIndex = (this.data.currentImageIndex + 1) % total
    this.setData({ currentImageIndex: nextIndex })
  },
  onGoLocationTap() {
    const { longitude, latitude, title, position } = this.data.house
    if (!Number.isFinite(Number(longitude)) || !Number.isFinite(Number(latitude))) {
      wx.showToast({ title: '暂无定位信息', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/houselocation/index?lng=${longitude}&lat=${latitude}&title=${encodeURIComponent(
        title || '房源'
      )}&address=${encodeURIComponent(position || '')}`,
    })
  },
  onOpenExternalTap() {
    const url = this.data.house.externalLink
    if (!url) {
      wx.showToast({ title: '暂无链接', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
    })
  },
  onOpenExternalLinkTap() {
    const url = String(this.data.house.externalLink || '').trim()
    if (!url) {
      wx.showToast({ title: '鏆傛棤閾炬帴', icon: 'none' })
      return
    }
    if (/^https:\/\//i.test(url)) {
      wx.navigateTo({
        url: `/pages/webview/index?url=${encodeURIComponent(url)}&title=${encodeURIComponent('来源地址')}`,
      })
      return
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: '鏃犳硶鐩存帴鎵撳紑',
          content: '褰撳墠鏉ユ簮鍦板潃宸插鍒板壀璐村澘锛岃鍦ㄦ祻瑙堝櫒涓墦寮€銆?',
          showCancel: false,
        })
      },
    })
  },
  onOpenExternalSourceTap() {
    const rawUrl = String(this.data.house.externalLink || '').trim()
    if (!rawUrl) {
      wx.showToast({ title: '\u6682\u65e0\u94fe\u63a5', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: rawUrl,
      success: () => {
        wx.showToast({ title: '\u5df2\u590d\u5236', icon: 'none' })
      },
    })
  },
  onShareAppMessage() {
    if (!canWechatShare(readWechatLoginCache())) {
      return {
        title: '\u200B',
        path: '/pages/index/index',
      }
    }
    const shareKey = encodeURIComponent(readWechatShareKey())
    const path = shareKey ? `/pages/index/index?shareKey=${shareKey}` : '/pages/index/index'
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
