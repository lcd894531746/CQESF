import { requestHouseList } from '../../services/house'
import { parseAreaRange, parsePriceRange, splitColumns } from '../../utils/house-filters.js'
import { cleanYinshanImageUrl } from '../../utils/clean-image'
import { canWechatShare, hasWechatAccess as checkWechatAccess, readWechatLoginCache, showNoAccessToast, syncWechatShareMenu } from '../../utils/wechat-access'

type HouseListQuery = import('../../services/house').HouseListQuery

type RegionRecord = {
  id: number
  name: string
}

type RegionMock = {
  data: RegionRecord[]
}

type HouseRow = {
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
}

const regionMock = require('../../assets/mock/chongqing-regions.js') as RegionMock
const DEFAULT_CITY_NAME = '重庆市区'
const DEFAULT_HOUSE_TYPE_ID = 2
const DEFAULT_PAGE_SIZE = 10
const FALLBACK_DISTRICTS = ['不限', '大渡口', '渝中', '江北区', '渝北区', '九龙坡', '沙坪坝', '巴南', '南岸']
const WECHAT_LOGIN_STORAGE_KEY = 'wechat_login_result'
const CURRENT_SHARE_STORAGE_KEY = 'current_wechat_share'

function normalizeDistrictName(name?: string): string {
  return String(name || '').trim().replace(/区$/, '')
}

function pickFirstImage(urls?: string | null): string {
  if (!urls) return ''
  const first = urls.split(',').map((item) => item.trim()).find(Boolean) || ''
  return cleanYinshanImageUrl(first)
}

function parseAuctionStatus(row: HouseRow): { text: string; type: 'upcoming' | 'running' | 'finished' | 'unknown' } {
  const status = Number(row.status)
  if (status === 0) return { text: '未起拍', type: 'upcoming' }
  if (status === 1) return { text: '竞拍中', type: 'running' }
  if (status === 2) return { text: '已成交', type: 'finished' }
  if (status === 3) return { text: '已结束', type: 'finished' }
  return { text: '状态未知', type: 'unknown' }
}

function normalizeRows(rows: HouseRow[]): HouseItem[] {
  return rows.map((row) => {
    const auctionStatus = parseAuctionStatus(row)
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
      position: row.detailAddress || row.title || '房源',
      areaText: `${Number(row.area || 0) || '-'}㎡`,
      layoutText: row.layout && row.layout !== '-' ? row.layout : '',
      orientationText: row.orientation && row.orientation !== '-' ? row.orientation : '',
      startingPriceText: `${Number(row.startingPrice || 0) || '-'}万`,
      marketPriceText: `${Number(row.marketPrice || 0) || '-'}万`,
      auctionStatusText: auctionStatus.text,
      auctionStatusType: auctionStatus.type,
      auctionTimeText: row.auctionTime || '-',
      image: pickFirstImage(row.coverPic),
    }
  })
}

function getRouteOptions(): Record<string, string> {
  const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
  const lastPage = pages[pages.length - 1]
  return (lastPage && lastPage.options) || {}
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

function hasWechatAccess(): boolean {
  return checkWechatAccess(readWechatLoginCache())
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
    keyword: '',
    pageNo: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: true,
    isLoadingMore: false,
    filterOptions: {
      area: FALLBACK_DISTRICTS.slice(),
      layout: ['不限', '50㎡以下', '50-70㎡', '70-90㎡', '90-120㎡', '120-150㎡', '150㎡以上'],
      price: ['不限', '50万以下', '50-70万', '70-80万', '80-100万', '100-110万', '110-130万', '130-150万', '150万以上'],
    },
    filterIndex: {
      area: 0,
      layout: 0,
      price: 0,
    },
    feedLeft: [] as HouseItem[],
    feedRight: [] as HouseItem[],
  },
  onLoad() {
    const regionData = (regionMock && regionMock.data) || []
    const districtList = FALLBACK_DISTRICTS.slice()
    const districtNameToIdMap = new Map<string, number>()
    regionData.forEach((item) => {
      if (!item.name) return
      districtNameToIdMap.set(item.name, item.id)
      districtNameToIdMap.set(normalizeDistrictName(item.name), item.id)
    })
    ;(this as any)._districtNameToIdMap = districtNameToIdMap
    this.setData({
      filterOptions: Object.assign({}, this.data.filterOptions, {
        area: districtList.length > 1 ? districtList : this.data.filterOptions.area,
      }),
    })

    const routeOptions = getRouteOptions()
    const patch: Record<string, any> = {}
    const districtName = decodeURIComponent(routeOptions.districtName || '')
    if (districtName) {
      const index = this.data.filterOptions.area.findIndex((name) => name === districtName)
      if (index >= 0) patch['filterIndex.area'] = index
    }
    const keyword = decodeURIComponent(routeOptions.keyword || '')
    if (keyword) patch.keyword = keyword
    if (Object.keys(patch).length > 0) this.setData(patch)

    syncWechatShareMenu(readWechatLoginCache())
    ;(this as any).refreshByFilter()
  },
  onShow() {
    syncWechatShareMenu(readWechatLoginCache())
  },
  buildQuery(pageNo: number): HouseListQuery {
    const { area, layout, price } = this.data.filterIndex
    const selectedDistrict = this.data.filterOptions.area[area]
    const districtId = area > 0 ? ((this as any)._districtNameToIdMap as Map<string, number>).get(selectedDistrict) : undefined
    const areaRange = layout > 0 ? parseAreaRange(this.data.filterOptions.layout[layout]) : {}
    const priceRange = price > 0 ? parsePriceRange(this.data.filterOptions.price[price]) : {}

    const query: HouseListQuery = {
      pageNum: pageNo,
      pageSize: this.data.pageSize,
      cityName: DEFAULT_CITY_NAME,
      houseTypeId: DEFAULT_HOUSE_TYPE_ID,
    }
    if (this.data.keyword.trim()) query.searchName = this.data.keyword.trim()
    if (area > 0) {
      query.districtName = selectedDistrict
      if (districtId) query.districtId = districtId
    }
    if (areaRange.minArea !== undefined) query.minArea = areaRange.minArea
    if (areaRange.maxArea !== undefined) query.maxArea = areaRange.maxArea
    if (priceRange.minPrice !== undefined) query.minStartingPrice = priceRange.minPrice
    if (priceRange.maxPrice !== undefined) query.maxStartingPrice = priceRange.maxPrice
    return query
  },
  refreshByFilter() {
    ;(this as any)._visiblePool = []
    this.setData({ pageNo: 1, hasMore: true, feedLeft: [], feedRight: [] })
    ;(this as any).loadMore(true)
  },
  async loadMore(reset = false) {
    if (!hasWechatAccess()) {
      this.setData({ feedLeft: [], feedRight: [], hasMore: false, isLoadingMore: false })
      showNoAccessToast()
      return
    }
    if ((!this.data.hasMore && !reset) || this.data.isLoadingMore) return
    this.setData({ isLoadingMore: true })
    const currentPage = reset ? 1 : this.data.pageNo
    try {
      const { rows, total } = await requestHouseList((this as any).buildQuery(currentPage))
      const pageList = normalizeRows(rows as HouseRow[])
      const merged = reset ? pageList : (((this as any)._visiblePool || []) as HouseItem[]).concat(pageList)
      ;(this as any)._visiblePool = merged
      const { left, right } = splitColumns(merged)
      this.setData({
        feedLeft: left,
        feedRight: right,
        pageNo: currentPage + 1,
        hasMore: merged.length < total,
        isLoadingMore: false,
      })
    } catch (error) {
      this.setData({ isLoadingMore: false })
      wx.showToast({ title: '鍒楄〃鍔犺浇澶辫触', icon: 'none' })
    }
  },
  onLoadMore() {
    ;(this as any).loadMore()
  },
  onHouseTap(e: WechatMiniprogram.CustomEvent<{ id: string | number }>) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const id = Number(e.currentTarget.dataset.id)
    const sourceId = Number((e.currentTarget.dataset as { sourceid?: string | number }).sourceid || 0)
    if (!id) return
    wx.navigateTo({ url: `/pages/housedetail/index?id=${id}&sourceId=${sourceId || id}` })
  },
  onAreaFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.area': Number(e.detail.value || 0) })
    ;(this as any).refreshByFilter()
  },
  onLayoutFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.layout': Number(e.detail.value || 0) })
    ;(this as any).refreshByFilter()
  },
  onPriceFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'filterIndex.price': Number(e.detail.value || 0) })
    ;(this as any).refreshByFilter()
  },
  onKeywordInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keyword: e.detail.value || '' })
  },
  onSearchConfirm() {
    ;(this as any).refreshByFilter()
  },
  onSearchTap() {
    ;(this as any).refreshByFilter()
  },
  onShareAppMessage() {
    const profile = readWechatLoginCache()
    if (!canWechatShare(profile)) {
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
    const profile = readWechatLoginCache()
    if (!canWechatShare(profile)) {
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
