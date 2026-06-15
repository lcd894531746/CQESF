import { requestBasicSettings, requestHouseList, requestHouseTypeList } from '../../services/house'
import { parseAreaRange, parsePriceRange } from '../../utils/house-filters.js'
import { cleanYinshanImageUrl } from '../../utils/clean-image'
import { canWechatShare, hasWechatAccess as checkWechatAccess, readWechatLoginCache, showNoAccessToast, syncWechatShareMenu } from '../../utils/wechat-access'

type HouseListQuery = import('../../services/house').HouseListQuery

type HouseRow = {
  id: number
  sourceId?: number | null
  title: string
  communityName?: string | null
  coverPic: string
  area: number
  layout: string | null
  startingPrice: number
  marketPrice: number
  districtId: number | null
  auctionTime: string | null
  status: number | null
  auctionMode?: number | string | null
}

type HouseItem = {
  id: number
  sourceId?: number | null
  communityNameText: string
  title: string
  areaText: string
  layoutText: string
  startingPriceText: string
  marketPriceText: string
  auctionStatusText: string
  auctionStatusType: 'upcoming' | 'running' | 'finished' | 'unknown'
  auctionTimeText: string
  image: string
  auctionModeBadge: string
}

type WechatShareProfile = {
  openid: string
  canShareMiniProgram?: boolean
  isSales?: boolean
  matchedPerson?: {
    role?: string
  } | null
}

type TitleLabels = {
  auctioning: string
  coming: string
}

const DISTRICT_OPTIONS = ['区域', '大渡口', '渝中', '江北区', '渝北区', '九龙坡', '沙坪坝', '巴南', '南岸']
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
const DEFAULT_TITLE_LABELS: TitleLabels = {
  auctioning: '',
  coming: '',
}

function pickFirstImage(urls?: string | null): string {
  if (!urls) return ''
  const first = urls.split(',').map((item) => item.trim()).find(Boolean) || ''
  return cleanYinshanImageUrl(first)
}

function formatAuctionTimeText(value?: string | null): string {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const normalized = raw.replace('T', ' ').replace(/\.\d+Z?$/, '')
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/)
  if (!match) return raw
  return `${match[2]}-${match[3]} ${match[4]}`
}

function parseAuctionStatus(statusValue?: number | null): { text: string; type: 'upcoming' | 'running' | 'finished' | 'unknown' } {
  const status = Number(statusValue)
  if (status === 0) return { text: '未起拍', type: 'upcoming' }
  if (status === 1) return { text: '竞拍中', type: 'running' }
  if (status === 2) return { text: '已成交', type: 'finished' }
  if (status === 3) return { text: '已结束', type: 'finished' }
  return { text: '状态未知', type: 'unknown' }
}

function toAuctionModeBadge(row: HouseRow): string {
  const auctionMode = Number(row.auctionMode || 0)
  if (auctionMode === 1) return '/assets/icons/yipai.png'
  if (auctionMode === 2) return '/assets/icons/erpai.png'
  if (auctionMode === 3) return '/assets/icons/bianmai.png'
  const title = String(row.title || '')
  if (title.includes('一拍')) return '/assets/icons/yipai.png'
  if (title.includes('二拍')) return '/assets/icons/erpai.png'
  if (title.includes('变卖')) return '/assets/icons/bianmai.png'
  return ''
}

function normalizeRows(rows: HouseRow[]): HouseItem[] {
  return rows.map((row) => {
    const status = parseAuctionStatus(row.status)
    return {
      id: row.id,
      sourceId: row.sourceId ?? row.id,
      communityNameText: row.communityName || row.title || '未知小区',
      title: row.title || '房源',
      areaText: `${Number(row.area || 0) || '-'}㎡`,
      layoutText: row.layout && row.layout !== '-' ? row.layout : '',
      startingPriceText: `${Number(row.startingPrice || 0) || '-'}万`,
      marketPriceText: `${Number(row.marketPrice || 0) || '-'}万`,
      auctionStatusText: status.text,
      auctionStatusType: status.type,
      auctionTimeText: formatAuctionTimeText(row.auctionTime),
      image: pickFirstImage(row.coverPic),
      auctionModeBadge: toAuctionModeBadge(row),
    }
  })
}

function titleByType(type: number, cityName: string, labels?: Partial<TitleLabels>): string {
  const auctioningLabel = String(labels?.auctioning || '').trim() || DEFAULT_TITLE_LABELS.auctioning
  const comingLabel = String(labels?.coming || '').trim() || DEFAULT_TITLE_LABELS.coming
  if (type === 0) return `今日新增(${cityName})`
  if (type === 1) return `${auctioningLabel}(${cityName})`
  if (type === 2) return `${comingLabel}(${cityName})`
  return `FP列表(${cityName})`
}

function readWechatShareProfile(): WechatShareProfile | null {
  try {
    const cached = wx.getStorageSync(WECHAT_LOGIN_STORAGE_KEY)
    if (!cached) return null
    const source = typeof cached === 'string' ? JSON.parse(cached) : cached
    const openid = String(source?.phoneNumber || source?.matchedPerson?.phone || source?.openid || '').trim()
    if (!openid) return null
    return {
      openid,
      canShareMiniProgram: Boolean(source?.canShareMiniProgram),
      isSales: Boolean(source?.isSales),
      matchedPerson: source?.matchedPerson || null,
    }
  } catch (error) {
    console.warn('read wechat share profile failed:', error)
    return null
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

function hasWechatAccess(): boolean {
  return checkWechatAccess(readWechatLoginCache())
}

Page({
  data: {
    cityName: DEFAULT_CITY_NAME,
    type: 1,
    titleLabels: DEFAULT_TITLE_LABELS,
    keyword: '',
    pageNo: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: true,
    isLoadingMore: false,
    list: [] as HouseItem[],
    filterOptions: {
      area: DISTRICT_OPTIONS.slice(),
      layout: ['面积', '50㎡以下', '50-70㎡', '70-90㎡', '90-120㎡', '120-150㎡', '150㎡以上'],
      price: ['价格', '50万以下', '50-70万', '70-80万', '80-100万', '100-110万', '110-130万', '130-150万', '150万以上'],
      more: ['更多', '一拍', '二拍', '变卖'],
      sort: ['排序', '最新发布', '总价从低到高', '总价从高到低', '起拍时间由近到远'],
    },
    filterIndex: {
      area: 0,
      layout: 0,
      price: 0,
      more: 0,
      sort: 0,
    },
  },
  onLoad(options: Record<string, string>) {
    const cityName = decodeURIComponent(options.cityName || DEFAULT_CITY_NAME)
    const type = Number(options.type || 1)
    const auctioningLabel = decodeURIComponent(options.auctioningLabel || '').trim()
    const comingLabel = decodeURIComponent(options.comingLabel || '').trim()
    const titleLabels: TitleLabels = {
      auctioning: auctioningLabel || DEFAULT_TITLE_LABELS.auctioning,
      coming: comingLabel || DEFAULT_TITLE_LABELS.coming,
    }
    ;(this as any)._districtNameToIdMap = new Map<string, number>(
      Object.entries(DISTRICT_ID_BY_NAME)
    )
    this.setData({
      cityName,
      type,
      titleLabels,
      'filterOptions.area': DISTRICT_OPTIONS.slice(),
    })
    this.updateNavigationTitle(type, cityName, titleLabels)
    void this.loadBasicSettings()
    syncWechatShareMenu(readWechatShareProfile())
    ;(this as any).refreshList()
  },
  onShow() {
    syncWechatShareMenu(readWechatShareProfile())
  },
  async loadBasicSettings() {
    try {
      const settings = await requestBasicSettings()
      const titleLabels: TitleLabels = {
        auctioning: String(settings.fapai_auctioning_label || '').trim() || DEFAULT_TITLE_LABELS.auctioning,
        coming: String(settings.fapai_coming_label || '').trim() || DEFAULT_TITLE_LABELS.coming,
      }
      this.setData({ titleLabels })
      this.updateNavigationTitle(this.data.type, this.data.cityName, titleLabels)
    } catch (error) {
      this.updateNavigationTitle(this.data.type, this.data.cityName, this.data.titleLabels)
    }
  },
  updateNavigationTitle(type: number, cityName: string, labels?: Partial<TitleLabels>) {
    wx.setNavigationBarTitle({
      title: titleByType(type, cityName, labels || this.data.titleLabels),
    })
  },
  buildQuery(pageNo: number): HouseListQuery {
    const query: HouseListQuery = {
      pageNum: pageNo,
      pageSize: this.data.pageSize,
      cityName: this.data.cityName,
      houseTypeId: DEFAULT_HOUSE_TYPE_ID,
    }
    if (this.data.keyword.trim()) query.searchName = this.data.keyword.trim()
    if (this.data.type === 0 || this.data.type === 1 || this.data.type === 2) query.type = this.data.type

    const areaName = this.data.filterOptions.area[this.data.filterIndex.area]
    if (this.data.filterIndex.area > 0) {
      const districtId = ((this as any)._districtNameToIdMap as Map<string, number>).get(areaName)
      query.districtName = areaName
      if (districtId) query.districtId = districtId
    }

    if (this.data.filterIndex.layout > 0) {
      const areaRange = parseAreaRange(this.data.filterOptions.layout[this.data.filterIndex.layout])
      if (areaRange.minArea !== undefined) query.minArea = areaRange.minArea
      if (areaRange.maxArea !== undefined) query.maxArea = areaRange.maxArea
    }
    if (this.data.filterIndex.price > 0) {
      const priceRange = parsePriceRange(this.data.filterOptions.price[this.data.filterIndex.price])
      if (priceRange.minPrice !== undefined) query.minStartingPrice = priceRange.minPrice
      if (priceRange.maxPrice !== undefined) query.maxStartingPrice = priceRange.maxPrice
    }

    if (this.data.filterIndex.more > 0) query.auctionMode = this.data.filterIndex.more

    const sortIndex = this.data.filterIndex.sort
    if (sortIndex === 1) {
      query.sortName = 'createTimeSort'
      query.sortStyle = 'desc'
    } else if (sortIndex === 2) {
      query.sortName = 'startingPriceSort'
      query.sortStyle = 'asc'
    } else if (sortIndex === 3) {
      query.sortName = 'startingPriceSort'
      query.sortStyle = 'desc'
    } else if (sortIndex === 4) {
      query.sortName = 'auctionTimeSort'
      query.sortStyle = 'asc'
    }
    return query
  },
  refreshList() {
    this.setData({ pageNo: 1, hasMore: true, list: [] })
    ;(this as any).loadMore(true)
  },
  async loadMore(reset = false) {
    if (!hasWechatAccess()) {
      this.setData({ list: [], hasMore: false, isLoadingMore: false })
      showNoAccessToast()
      return
    }
    if ((!this.data.hasMore && !reset) || this.data.isLoadingMore) return
    this.setData({ isLoadingMore: true })
    const pageNo = reset ? 1 : this.data.pageNo
    try {
      const query = (this as any).buildQuery(pageNo) as HouseListQuery
      const isTypeList = this.data.type === 0 || this.data.type === 1 || this.data.type === 2
      let rows: HouseRow[] = []
      let total = 0
      if (isTypeList) {
        const typeQuery: Partial<HouseListQuery> = Object.assign({}, query)
        delete (typeQuery as Partial<HouseListQuery> & { houseTypeId?: number }).houseTypeId
        const result = await requestHouseTypeList(typeQuery)
        rows = result.rows as HouseRow[]
        total = result.total
      } else {
        const result = await requestHouseList(query)
        rows = result.rows as HouseRow[]
        total = result.total
      }
      const pageList = normalizeRows(rows)
      const merged = reset ? pageList : this.data.list.concat(pageList)
      this.setData({
        list: merged,
        pageNo: pageNo + 1,
        hasMore: merged.length < total,
        isLoadingMore: false,
      })
    } catch (error) {
      this.setData({ isLoadingMore: false })
      wx.showToast({ title: '列表加载失败', icon: 'none' })
    }
  },
  onLoadMore() {
    ;(this as any).loadMore()
  },
  onKeywordInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keyword: e.detail.value || '' })
  },
  onSearchConfirm() {
    ;(this as any).refreshList()
  },
  onFilterAreaChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.area': Number(e.detail.value || 0) })
    ;(this as any).refreshList()
  },
  onFilterLayoutChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.layout': Number(e.detail.value || 0) })
    ;(this as any).refreshList()
  },
  onFilterPriceChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.price': Number(e.detail.value || 0) })
    ;(this as any).refreshList()
  },
  onFilterMoreChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.more': Number(e.detail.value || 0) })
    ;(this as any).refreshList()
  },
  onFilterSortChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.sort': Number(e.detail.value || 0) })
    ;(this as any).refreshList()
  },
  onHouseTap(e: WechatMiniprogram.CustomEvent<{ id: string | number }>) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const id = Number(e.currentTarget.dataset.id || 0)
    const sourceId = Number((e.currentTarget.dataset as { sourceid?: string | number }).sourceid || 0)
    if (!id) return
    wx.navigateTo({ url: `/pages/housedetail/index?id=${id}&sourceId=${sourceId || id}` })
  },
  onShareAppMessage() {
    const profile = readWechatShareProfile()
    if (!canWechatShare(profile)) {
      return {
        title: '\u200B',
        path: '/pages/index/index',
      }
    }
    const shareKey = canWechatShare(profile) ? encodeURIComponent(readWechatShareKey()) : ''
    const path = shareKey ? `/pages/index/index?shareKey=${shareKey}` : '/pages/index/index'
    return {
      title: '\u200B',
      path,
    }
  },
  onShareTimeline() {
    const profile = readWechatShareProfile()
    if (!canWechatShare(profile)) {
      return {
        title: '\u200B',
        query: '',
      }
    }
    const shareKey = canWechatShare(profile) ? encodeURIComponent(readWechatShareKey()) : ''
    const query = shareKey ? `shareKey=${shareKey}` : ''
    return {
      title: '\u200B',
      query,
    }
  },
})
