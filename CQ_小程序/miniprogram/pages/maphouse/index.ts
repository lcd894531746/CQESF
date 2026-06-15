import {
  requestBkMapHouses,
  requestDjlMapCommunities,
  requestDjlMapDistricts,
  requestDjlMapSubAreas,
  requestFapaiMapCommunities,
  requestFapaiMapDistricts,
  requestFapaiMapHouses,
  requestFapaiMapSubAreas,
  requestDistrictHouseCount,
  requestMapData,
  requestSubwayByCityName,
} from '../../services/house'
import {
  hasWechatAccess as checkWechatAccess,
  readWechatLoginCache,
  rememberWechatShareKey,
  showNoAccessToast,
} from '../../utils/wechat-access'
import { cleanYinshanImageUrl } from '../../utils/clean-image'

type MapCommunityRow = import('../../services/house').MapCommunityRow
type BkMapGroupType = import('../../services/house').BkMapGroupType
type BkMapHouseRow = import('../../services/house').BkMapHouseRow
type DjlMapDistrictRow = import('../../services/house').DjlMapDistrictRow
type DjlMapSubAreaRow = import('../../services/house').DjlMapSubAreaRow
type DjlMapCommunityRow = import('../../services/house').DjlMapCommunityRow
type FapaiMapDistrictRow = import('../../services/house').FapaiMapDistrictRow
type FapaiMapSubAreaRow = import('../../services/house').FapaiMapSubAreaRow
type FapaiMapCommunityRow = import('../../services/house').FapaiMapCommunityRow
type FapaiMapHouseRow = import('../../services/house').FapaiMapHouseRow

type MapMode = 'auction' | 'ershou'
type MarkerType =
  | 'district'
  | 'community'
  | 'auctionDistrict'
  | 'auctionSubArea'
  | 'auctionCommunity'
  | 'ershouDistrict'
  | 'ershouSubArea'
  | 'ershouCommunity'

type MapPoint = {
  name: string
  entityId?: string
  bubbleId?: string
  districtId?: number
  longitude: number
  latitude: number
  priceStr?: string
}

type MarkerMeta = {
  type: MarkerType
  name: string
  entityId?: string
  bubbleId?: string
  longitude?: number
  latitude?: number
}

type InfoItem = {
  label: string
  value: string
}

type ErshouDetailCache = {
  id: string
  houseCode: string
  sourceId?: string
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

type DrawerItem = {
  id: string
  houseCode: string
  title: string
  position: string
  image: string
  hasImage: boolean
  totalPriceText: string
  unitPriceText: string
  downPaymentText: string
  monthlyPaymentText: string
  layoutText: string
  areaText: string
  orientationText: string
  actionUrl: string
  detailPayload: ErshouDetailCache
}

const DEFAULT_CITY_NAME = '重庆市区'
const DEFAULT_HOUSE_TYPE_ID = 2
const MIN_DOWN_PAYMENT_RATIO = 0.03
const MAX_DOWN_PAYMENT_RATIO = 0.05
const DEFAULT_MORTGAGE_YEARS = 30
const DEFAULT_ANNUAL_INTEREST_RATE = 3.15
const CHONGQING_CENTER = {
  longitude: 107.55,
  latitude: 30.05,
}
const ERSHOU_DISTRICT_MAX_SCALE = 9
const ERSHOU_BIZCIRCLE_MAX_SCALE = 13
const ERSHOU_DETAIL_CACHE_KEY = 'ershou_detail_cache'

const HOUSE_TYPE_TABS = [
  { id: 2, label: '住宅' },
  { id: 1, label: '商业' },
  { id: 3, label: '工业' },
]

function normalizeText(value?: string | number | null): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function parseCoordinate(value?: string | number | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstImageFromValue(value?: string | string[] | null): string {
  if (Array.isArray(value)) {
    return String(value.find((item) => normalizeText(item)) || '').trim()
  }
  const raw = normalizeText(value)
  if (!raw) return ''
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return String(parsed.find((item) => normalizeText(item)) || '').trim()
      }
    } catch (error) {
      console.warn('parse map drawer image json failed:', error)
    }
  }
  return raw.split(',').map((item) => item.trim()).find(Boolean) || ''
}

function pickDrawerImage(row: BkMapHouseRow): string {
  const image = firstImageFromValue(row.posterImage)
    || firstImageFromValue(row.coverPic)
  return cleanYinshanImageUrl(image)
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

function parsePriceValue(priceText?: string | null): number {
  const matched = normalizeText(priceText).match(/[\d.]+/)
  return matched ? Number(matched[0]) || 0 : 0
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

function hasWechatAccess(): boolean {
  return checkWechatAccess(readWechatLoginCache())
}

function parseLocation(location?: string | null): { longitude: number; latitude: number } | null {
  if (!location) return null
  const parts = location.split(',').map((item) => Number(item.trim()))
  const lng = parts[0]
  const lat = parts[1]
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { longitude: lng, latitude: lat }
}

function pickColorByLineName(lineName: string): string {
  const palette = ['#2563eb', '#e11d48', '#059669', '#f59e0b', '#7c3aed', '#0ea5e9', '#ef4444']
  let sum = 0
  for (let i = 0; i < lineName.length; i += 1) sum += lineName.charCodeAt(i)
  return palette[sum % palette.length]
}

function buildSubwayPolylines(
  subwayLines: Array<{ lineName: string; subwayDataList: Array<{ latitude: number; longitude: number }> }>
): WechatMiniprogram.Polyline[] {
  return subwayLines
    .map((line) => ({
      points: (line.subwayDataList || [])
        .map((station) => ({
          longitude: Number(station.latitude),
          latitude: Number(station.longitude),
        }))
        .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude)),
      color: pickColorByLineName(line.lineName) + 'CC',
      width: 4,
      dottedLine: false,
    }))
    .filter((line) => line.points.length > 1)
}

function normalizeDistrictPoint(row: {
  areaName: string
  districtId: number
  location: string
  houseCount: string
}): MapPoint | null {
  const location = parseLocation(row.location)
  if (!location) return null
  return {
    name: row.areaName || '区域',
    districtId: row.districtId,
    latitude: location.latitude,
    longitude: location.longitude,
  }
}

function normalizeCommunityPoint(row: MapCommunityRow): MapPoint | null {
  const location = parseLocation(row.location)
  if (!location) return null
  return {
    name: row.communityName || '小区',
    latitude: location.latitude,
    longitude: location.longitude,
  }
}

function normalizeDjlDistrictPoint(row: DjlMapDistrictRow): MapPoint | null {
  const longitude = Number(row.longitude)
  const latitude = Number(row.latitude)
  const areaCode = normalizeText(row.areaCode)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !areaCode) return null
  return {
    name: normalizeText(row.displayName) || normalizeText(row.areaName) || '行政区',
    entityId: areaCode,
    bubbleId: areaCode,
    longitude,
    latitude,
    priceStr: normalizeText(row.priceText),
  }
}

function normalizeDjlSubAreaPoint(row: DjlMapSubAreaRow): MapPoint | null {
  const longitude = Number(row.longitude)
  const latitude = Number(row.latitude)
  const areaCode = normalizeText(row.areaCode)
  const subAreaName = normalizeText(row.subAreaName)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !areaCode || !subAreaName) return null
  return {
    name: subAreaName,
    entityId: areaCode,
    bubbleId: subAreaName,
    longitude,
    latitude,
    priceStr: normalizeText(row.priceText),
  }
}

function normalizeDjlCommunityPoint(row: DjlMapCommunityRow): MapPoint | null {
  const longitude = Number(row.longitude)
  const latitude = Number(row.latitude)
  const communityId = normalizeText(row.communityId)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !communityId) return null
  return {
    name: normalizeText(row.communityName) || '小区',
    entityId: communityId,
    bubbleId: communityId,
    longitude,
    latitude,
    priceStr: normalizeText(row.priceText),
  }
}

function normalizeFapaiDistrictPoint(row: FapaiMapDistrictRow): MapPoint | null {
  const longitude = Number(row.longitude)
  const latitude = Number(row.latitude)
  const areaCode = normalizeText(row.areaCode)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !areaCode) return null
  return {
    name: normalizeText(row.displayName) || normalizeText(row.areaName) || '区域',
    entityId: areaCode,
    bubbleId: areaCode,
    longitude,
    latitude,
    priceStr: normalizeText(row.priceText),
  }
}

function normalizeFapaiSubAreaPoint(row: FapaiMapSubAreaRow): MapPoint | null {
  const longitude = Number(row.longitude)
  const latitude = Number(row.latitude)
  const areaCode = normalizeText(row.areaCode)
  const subAreaName = normalizeText(row.subAreaName)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !areaCode || !subAreaName) return null
  return {
    name: subAreaName,
    entityId: areaCode,
    bubbleId: subAreaName,
    longitude,
    latitude,
    priceStr: normalizeText(row.priceText),
  }
}

function normalizeFapaiCommunityPoint(row: FapaiMapCommunityRow): MapPoint | null {
  const longitude = Number(row.longitude)
  const latitude = Number(row.latitude)
  const communityId = normalizeText(row.communityId)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !communityId) return null
  return {
    name: normalizeText(row.communityName) || '小区',
    entityId: communityId,
    bubbleId: communityId,
    longitude,
    latitude,
    priceStr: normalizeText(row.priceText),
  }
}

function toMapBoundsPoints(points: MapPoint[]): Array<{ longitude: number; latitude: number }> {
  return points
    .map((item) => ({
      longitude: Number(item.longitude),
      latitude: Number(item.latitude),
    }))
    .filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude))
}

function buildMarkerCalloutContent(point: MapPoint): string {
  const title = point.name.length > 10 ? point.name.slice(0, 10) + '...' : point.name
  const value = point.priceStr || ''
  return value ? title + '\n' + value : title
}

function parseHouseDesc(desc?: string | null): { layoutText: string; areaText: string; orientationText: string } {
  const parts = normalizeText(desc)
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    layoutText: parts[0] || '',
    areaText: parts[1] || '',
    orientationText: parts[2] || '',
  }
}

function parseBuildAreaValue(value?: string | number | null): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildDrawerItem(row: BkMapHouseRow, index: number): DrawerItem {
  const parsed = parseHouseDesc(row.desc)
  const buildAreaValue = parseBuildAreaValue(row.buildAreaSqm)
  const areaText = parsed.areaText || (buildAreaValue > 0 ? `${buildAreaValue}㎡` : '')
  const houseCode = normalizeText(row.houseCode)
  const actionUrl = normalizeText(row.actionUrl)
  const image = pickDrawerImage(row)
  const loanTexts = calculateLoanTexts(parsePriceValue(row.priceStr))
  const position = normalizeText(row.resblockName) || normalizeText(row.title) || '暂无小区'
  const itemId = row.id ? String(row.id) : houseCode || actionUrl || String(index + 1)
  const infoList: InfoItem[] = []
  if (position) infoList.push({ label: '小区', value: position })
  if (parsed.layoutText) infoList.push({ label: '户型', value: parsed.layoutText })
  if (areaText) infoList.push({ label: '面积', value: areaText })
  if (parsed.orientationText) infoList.push({ label: '朝向', value: parsed.orientationText })
  const detailPayload: ErshouDetailCache = {
    id: itemId,
    houseCode,
    title: normalizeText(row.title) || '低首付',
    position,
    images: image ? [image] : [],
    hasImages: Boolean(image),
    totalPriceText: normalizeText(row.priceStr) || '-',
    unitPriceText: normalizeText(row.unitPriceStr) || '-',
    downPaymentText: loanTexts.downPaymentText,
    monthlyPaymentText: loanTexts.monthlyPaymentText,
    layoutText: parsed.layoutText,
    areaText: areaText || '-',
    orientationText: parsed.orientationText,
    infoList,
    contactName: '置业顾问',
    contactPhone: '4008001234',
    longitude: parseCoordinate(row.longitude),
    latitude: parseCoordinate(row.latitude),
  }
  return {
    id: itemId,
    houseCode,
    title: detailPayload.title,
    position,
    image,
    hasImage: Boolean(image),
    totalPriceText: detailPayload.totalPriceText,
    unitPriceText: detailPayload.unitPriceText,
    downPaymentText: detailPayload.downPaymentText,
    monthlyPaymentText: detailPayload.monthlyPaymentText,
    layoutText: parsed.layoutText,
    areaText,
    orientationText: parsed.orientationText,
    actionUrl,
    detailPayload,
  }
}

function buildAuctionDrawerItem(row: FapaiMapHouseRow, index: number): DrawerItem {
  const areaValue = Number(row.area || 0)
  const startingPriceValue = Number(row.startingPrice || 0)
  const marketPriceValue = Number(row.marketPrice || 0)
  const position = normalizeText(row.detailAddress) || normalizeText(row.communityName) || normalizeText(row.title) || '暂无小区'
  const title = normalizeText(row.title) || normalizeText(row.communityName) || '源'
  const sourceId = row.sourceId ? String(row.sourceId) : ''
  const itemId = sourceId || (row.id ? String(row.id) : String(index + 1))
  const image = cleanYinshanImageUrl(
    firstImageFromValue((row as FapaiMapHouseRow & { coverPic?: string | null }).coverPic)
  )
  const statusText = normalizeText(row.auctionStatusText)
  const infoList: InfoItem[] = []
  if (normalizeText(row.communityName)) infoList.push({ label: '小区', value: normalizeText(row.communityName) })
  if (normalizeText(row.layout)) infoList.push({ label: '户型', value: normalizeText(row.layout) })
  if (areaValue > 0) infoList.push({ label: '面积', value: `${areaValue}㎡` })
  if (normalizeText(row.orientation)) infoList.push({ label: '朝向', value: normalizeText(row.orientation) })
  if (statusText) infoList.push({ label: '状态', value: statusText })
  if (normalizeText(row.auctionTime)) infoList.push({ label: '开拍', value: normalizeText(row.auctionTime) })
  const detailPayload: ErshouDetailCache = {
    id: itemId,
    houseCode: sourceId,
    sourceId,
    title,
    position,
    images: image ? [image] : [],
    hasImages: Boolean(image),
    totalPriceText: startingPriceValue > 0 ? `${startingPriceValue}万` : '-',
    unitPriceText: marketPriceValue > 0 ? `市场价 ${marketPriceValue}万` : '',
    downPaymentText: '-',
    monthlyPaymentText: statusText || '-',
    layoutText: normalizeText(row.layout),
    areaText: areaValue > 0 ? `${areaValue}㎡` : '-',
    orientationText: normalizeText(row.orientation),
    infoList,
    contactName: '资产顾问',
    contactPhone: '4008001234',
    longitude: parseCoordinate(row.longitude),
    latitude: parseCoordinate(row.latitude),
  }

  return {
    id: itemId,
    houseCode: sourceId,
    title,
    position,
    image,
    hasImage: Boolean(image),
    totalPriceText: detailPayload.totalPriceText,
    unitPriceText: detailPayload.unitPriceText || '源',
    downPaymentText: normalizeText(row.auctionTime) || '开拍时间待定',
    monthlyPaymentText: statusText || '状态待定',
    layoutText: detailPayload.layoutText,
    areaText: areaValue > 0 ? `${areaValue}㎡` : '',
    orientationText: detailPayload.orientationText,
    actionUrl: row.id ? `/pages/housedetail/index?id=${row.id}` : '',
    detailPayload,
  }
}

function markProgrammaticRegionChange(page: WechatMiniprogram.Page.Instance<any, any>, count = 2) {
  const current = Number((page as any)._ignoreRegionChangeCount || 0)
  ;(page as any)._ignoreRegionChangeCount = Math.max(current, count)
}

function suppressAutoLevelFallback(page: WechatMiniprogram.Page.Instance<any, any>, durationMs = 1600) {
  ;(page as any)._suppressAutoLevelUntil = Date.now() + durationMs
}

function createMarkers(points: MapPoint[], baseId: number, color: string): WechatMiniprogram.Marker[] {
  return points.map((point, index) => ({
    id: baseId + index,
    longitude: point.longitude,
    latitude: point.latitude,
    width: 8,
    height: 8,
    iconPath: '/assets/icons/city-icon.png',
    callout: {
      content: buildMarkerCalloutContent(point),
      display: 'ALWAYS',
      borderRadius: 999,
      bgColor: color,
      color: '#ffffff',
      padding: 8,
      fontSize: 12,
      textAlign: 'center',
    },
  }))
}

Page({
  data: {
    longitude: 106.551556,
    latitude: 29.563009,
    scale: 10,
    minScale: 7,
    maxScale: 18,
    includePoints: [] as Array<{ longitude: number; latitude: number }>,
    polylines: [] as WechatMiniprogram.Polyline[],
    markers: [] as WechatMiniprogram.Marker[],
    loading: true,
    loadingText: '地图房源加载中...',
    zoomLevel: 'district' as BkMapGroupType,
    houseTypeTabs: HOUSE_TYPE_TABS,
    activeHouseTypeId: DEFAULT_HOUSE_TYPE_ID,
    sourceType: 'auction' as MapMode,
    pageTitle: '地图找房',
    pageDesc: '缩放地图查看区域和小区分布',
    mapTipText: '',
    drawerVisible: false,
    activeCommunityName: '',
    activeCommunityListings: [] as DrawerItem[],
  },

  onLoad(query: Record<string, string>) {
    rememberWechatShareKey(query.shareKey)
    if (!hasWechatAccess()) {
      showNoAccessToast()
      wx.switchTab({ url: '/pages/index/index' })
      return
    }
    const sourceType = query.source === 'ershou' ? 'ershou' : 'auction'
    ;(this as any)._mapCtx = wx.createMapContext('houseMap', this)
    ;(this as any)._markerMeta = new Map<number, MarkerMeta>()
    this.setData({
      sourceType,
      pageTitle: sourceType === 'ershou' ? '低首付地图找房' : '地图找房',
      pageDesc: sourceType === 'ershou' ? '重庆 · 七大区域' : '缩放地图查看区域和小区分布',
      mapTipText: sourceType === 'ershou' ? '点击行政区进入商圈，点击商圈进入小区' : '点击气泡可进入区域房源列表',
    })
    wx.setNavigationBarTitle({
      title: sourceType === 'ershou' ? '低首付地图找房' : '地图找房',
    })
    if (sourceType === 'ershou') {
      ;(this as any).loadErshouDistricts()
      return
    }
    ;(this as any).loadAuctionDistricts()
  },

  async loadErshouDistricts() {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    ;(this as any)._ershouLoadingLevel = 'district'
    this.setData({ loading: true, loadingText: '区域加载中...', drawerVisible: false })
    try {
      const rows = await requestDjlMapDistricts()
      const points = rows.map(normalizeDjlDistrictPoint).filter((item): item is MapPoint => Boolean(item))
      if (points.length === 0) {
        this.setData({
          loading: false,
          pageDesc: '重庆 · 七大区域，暂无数据',
          mapTipText: '当前没有可展示的区域数据',
        })
        wx.showToast({ title: '暂无区域数据', icon: 'none' })
        return
      }
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(200000 + index, {
        type: 'ershouDistrict',
        name: point.name,
        entityId: point.entityId,
        bubbleId: point.bubbleId,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      const boundsPoints = toMapBoundsPoints(points)
      ;(this as any)._markerMeta = markerMeta
      ;(this as any)._ershouDistrictParent = undefined
      ;(this as any)._ershouSubAreaParent = undefined
      this.setData({
        markers: createMarkers(points, 200000, '#2563eb'),
        polylines: [],
        includePoints: boundsPoints,
        longitude: CHONGQING_CENTER.longitude,
        latitude: CHONGQING_CENTER.latitude,
        scale: 7,
        zoomLevel: 'district',
        pageDesc: '重庆 · 七大区域，共 ' + points.length + ' 个',
        mapTipText: '点击行政区查看商圈',
        loading: false,
      })
      ;(this as any).fitMapToPoints(boundsPoints)
    } catch (error) {
      console.error('loadErshouDistricts failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '区域加载失败', icon: 'none' })
    } finally {
      ;(this as any)._ershouLoadingLevel = ''
    }
  },

  async loadDistrictMapData() {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    this.setData({ loading: true, loadingText: '地图房源加载中...' })
    try {
      const houseTypeId = Number(this.data.activeHouseTypeId || DEFAULT_HOUSE_TYPE_ID)
      const districtRows = await requestDistrictHouseCount(DEFAULT_CITY_NAME, houseTypeId)
      let subwayLines: Array<{ lineName: string; subwayDataList: Array<{ latitude: number; longitude: number }> }> = []
      try {
        subwayLines = await requestSubwayByCityName(DEFAULT_CITY_NAME)
      } catch (error) {
        console.warn('subway data request failed:', error)
      }
      const points = districtRows.map(normalizeDistrictPoint).filter((item): item is MapPoint => Boolean(item))
      const markers = createMarkers(points, 1, '#4a8df6')
      const boundsPoints = toMapBoundsPoints(points)
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(index + 1, {
        type: 'district',
        name: point.name,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      ;(this as any)._markerMeta = markerMeta
      const first = points[0]
      this.setData({
        markers,
        polylines: buildSubwayPolylines(subwayLines || []),
        includePoints: boundsPoints,
        longitude: first ? first.longitude : this.data.longitude,
        latitude: first ? first.latitude : this.data.latitude,
        zoomLevel: 'district',
        loading: false,
      })
      ;(this as any).fitMapToPoints(boundsPoints)
    } catch (error) {
      console.error('loadDistrictMapData failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '地图数据加载失败', icon: 'none' })
    }
  },

  async loadAuctionDistricts() {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    ;(this as any)._auctionLoadingLevel = 'district'
    this.setData({ loading: true, loadingText: '区域加载中...', drawerVisible: false })
    try {
      const rows = await requestFapaiMapDistricts()
      const points = rows.map(normalizeFapaiDistrictPoint).filter((item): item is MapPoint => Boolean(item))
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(500000 + index, {
        type: 'auctionDistrict',
        name: point.name,
        entityId: point.entityId,
        bubbleId: point.bubbleId,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      ;(this as any)._markerMeta = markerMeta
      ;(this as any)._auctionDistrictParent = undefined
      ;(this as any)._auctionSubAreaParent = undefined
      const boundsPoints = toMapBoundsPoints(points)
      this.setData({
        markers: createMarkers(points, 500000, '#2563eb'),
        polylines: [],
        includePoints: boundsPoints,
        longitude: CHONGQING_CENTER.longitude,
        latitude: CHONGQING_CENTER.latitude,
        scale: 7,
        zoomLevel: 'district',
        pageDesc: '重庆 · 法拍区域分布',
        mapTipText: '点击行政区查看商圈',
        loading: false,
      })
      ;(this as any).fitMapToPoints(boundsPoints)
    } catch (error) {
      console.error('loadAuctionDistricts failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '区域加载失败', icon: 'none' })
    } finally {
      ;(this as any)._auctionLoadingLevel = ''
    }
  },

  async loadCommunityDataByRegion(region: {
    southwest: { latitude: number; longitude: number }
    northeast: { latitude: number; longitude: number }
  }) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    this.setData({ loading: true, loadingText: '小区点位加载中...' })
    try {
      const rows = await requestMapData({
        cityName: DEFAULT_CITY_NAME,
        houseTypeId: Number(this.data.activeHouseTypeId || DEFAULT_HOUSE_TYPE_ID),
        maxLatitude: Number(region.northeast.latitude),
        minLatitude: Number(region.southwest.latitude),
        maxLongitude: Number(region.northeast.longitude),
        minLongitude: Number(region.southwest.longitude),
      })
      const points = rows.map(normalizeCommunityPoint).filter((item): item is MapPoint => Boolean(item))
      const markers = createMarkers(points, 100000, '#4a8df6')
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(100000 + index, {
        type: 'community',
        name: point.name,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      ;(this as any)._markerMeta = markerMeta
      this.setData({ markers, polylines: [], zoomLevel: 'community', loading: false })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: '小区点位加载失败', icon: 'none' })
    }
  },

  async loadErshouSubAreas(parent: MarkerMeta) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const areaCode = normalizeText(parent.entityId)
    if (!areaCode) return
    ;(this as any)._ershouLoadingLevel = 'bizcircle'
    this.setData({ loading: true, loadingText: '商圈加载中...', drawerVisible: false })
    try {
      const rows = await requestDjlMapSubAreas({ areaCode })
      const points = rows.map(normalizeDjlSubAreaPoint).filter((item): item is MapPoint => Boolean(item))
      if (points.length === 0) {
        this.setData({
          loading: false,
          pageDesc: parent.name + ' · 商圈，暂无数据',
          mapTipText: parent.name + ' 暂无商圈数据',
        })
        wx.showToast({ title: parent.name + ' 暂无商圈数据', icon: 'none' })
        return
      }
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(300000 + index, {
        type: 'ershouSubArea',
        name: point.name,
        entityId: point.entityId,
        bubbleId: point.bubbleId,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      const boundsPoints = toMapBoundsPoints(points)
      ;(this as any)._markerMeta = markerMeta
      ;(this as any)._ershouDistrictParent = parent
      ;(this as any)._ershouSubAreaParent = undefined
      this.setData({
        markers: createMarkers(points, 300000, '#2563eb'),
        polylines: [],
        includePoints: boundsPoints,
        longitude: Number.isFinite(Number(parent.longitude)) ? Number(parent.longitude) : points[0].longitude,
        latitude: Number.isFinite(Number(parent.latitude)) ? Number(parent.latitude) : points[0].latitude,
        scale: 12,
        zoomLevel: 'bizcircle',
        pageDesc: parent.name + ' · 商圈，共 ' + points.length + ' 个',
        mapTipText: '点击商圈查看小区',
        loading: false,
      })
      markProgrammaticRegionChange(this, 4)
    } catch (error) {
      console.error('loadErshouSubAreas failed', { parent, error })
      this.setData({ loading: false })
      wx.showToast({ title: '商圈加载失败', icon: 'none' })
    } finally {
      ;(this as any)._ershouLoadingLevel = ''
    }
  },

  async loadErshouCommunities(parent: MarkerMeta) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const areaCode = normalizeText(parent.entityId)
    const subAreaName = normalizeText(parent.bubbleId || parent.name)
    if (!areaCode || !subAreaName) return
    ;(this as any)._ershouLoadingLevel = 'community'
    this.setData({ loading: true, loadingText: '小区加载中...', drawerVisible: false })
    try {
      const rows = await requestDjlMapCommunities({ areaCode, subAreaName })
      const points = rows.map(normalizeDjlCommunityPoint).filter((item): item is MapPoint => Boolean(item))
      if (points.length === 0) {
        this.setData({
          loading: false,
          pageDesc: parent.name + ' · 小区，暂无数据',
          mapTipText: parent.name + ' 暂无小区数据',
        })
        wx.showToast({ title: parent.name + ' 暂无小区数据', icon: 'none' })
        return
      }
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(400000 + index, {
        type: 'ershouCommunity',
        name: point.name,
        entityId: point.entityId,
        bubbleId: point.bubbleId,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      const boundsPoints = toMapBoundsPoints(points)
      ;(this as any)._markerMeta = markerMeta
      ;(this as any)._ershouSubAreaParent = parent
      this.setData({
        markers: createMarkers(points, 400000, '#e34b40'),
        polylines: [],
        includePoints: boundsPoints,
        longitude: Number.isFinite(Number(parent.longitude)) ? Number(parent.longitude) : points[0].longitude,
        latitude: Number.isFinite(Number(parent.latitude)) ? Number(parent.latitude) : points[0].latitude,
        scale: 14,
        zoomLevel: 'community',
        pageDesc: parent.name + ' · 小区，共 ' + points.length + ' 个',
        mapTipText: '点击小区查看该小区房源',
        loading: false,
      })
      markProgrammaticRegionChange(this, 4)
    } catch (error) {
      console.error('loadErshouCommunities failed', { parent, error })
      this.setData({ loading: false })
      wx.showToast({ title: '小区加载失败', icon: 'none' })
    } finally {
      ;(this as any)._ershouLoadingLevel = ''
    }
  },

  async loadErshouCommunityHouses(meta: MarkerMeta) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const resblockId = normalizeText(meta.entityId || meta.bubbleId)
    if (!resblockId) return
    this.setData({ loading: true, loadingText: '房源加载中...', drawerVisible: false })
    try {
      const response = await requestBkMapHouses({ resblockId })
      const listings = response.items.map(buildDrawerItem)
      if (listings.length === 0) {
        this.setData({
          loading: false,
          drawerVisible: false,
          activeCommunityName: meta.name,
          activeCommunityListings: [],
          mapTipText: meta.name + ' 暂无房源数据',
        })
        wx.showToast({ title: meta.name + ' 暂无房源数据', icon: 'none' })
        return
      }
      this.setData({
        loading: false,
        drawerVisible: true,
        activeCommunityName: meta.name,
        activeCommunityListings: listings,
        mapTipText: '当前展示 ' + meta.name + ' 的房源',
      })
    } catch (error) {
      console.error('loadErshouCommunityHouses failed', { meta, error })
      this.setData({ loading: false })
      wx.showToast({ title: '房源加载失败', icon: 'none' })
    }
  },

  async loadAuctionSubAreas(parent: MarkerMeta) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const areaCode = normalizeText(parent.entityId)
    if (!areaCode) return
    ;(this as any)._auctionLoadingLevel = 'bizcircle'
    this.setData({ loading: true, loadingText: '商圈加载中...', drawerVisible: false })
    try {
      const rows = await requestFapaiMapSubAreas({ areaCode })
      const points = rows.map(normalizeFapaiSubAreaPoint).filter((item): item is MapPoint => Boolean(item))
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(600000 + index, {
        type: 'auctionSubArea',
        name: point.name,
        entityId: point.entityId,
        bubbleId: point.bubbleId,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      const boundsPoints = toMapBoundsPoints(points)
      ;(this as any)._markerMeta = markerMeta
      ;(this as any)._auctionDistrictParent = parent
      ;(this as any)._auctionSubAreaParent = undefined
      this.setData({
        markers: createMarkers(points, 600000, '#2563eb'),
        polylines: [],
        includePoints: boundsPoints,
        longitude: Number.isFinite(Number(parent.longitude)) ? Number(parent.longitude) : points[0]?.longitude || this.data.longitude,
        latitude: Number.isFinite(Number(parent.latitude)) ? Number(parent.latitude) : points[0]?.latitude || this.data.latitude,
        scale: 12,
        zoomLevel: 'bizcircle',
        pageDesc: parent.name + ' · 商圈分布',
        mapTipText: '点击商圈查看小区',
        loading: false,
      })
      markProgrammaticRegionChange(this, 4)
    } catch (error) {
      console.error('loadAuctionSubAreas failed', { parent, error })
      this.setData({ loading: false })
      wx.showToast({ title: '商圈加载失败', icon: 'none' })
    } finally {
      ;(this as any)._auctionLoadingLevel = ''
    }
  },

  async loadAuctionCommunities(parent: MarkerMeta) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const areaCode = normalizeText(parent.entityId)
    const subAreaName = normalizeText(parent.bubbleId || parent.name)
    if (!areaCode || !subAreaName) return
    ;(this as any)._auctionLoadingLevel = 'community'
    this.setData({ loading: true, loadingText: '小区加载中...', drawerVisible: false })
    try {
      const rows = await requestFapaiMapCommunities({ areaCode, subAreaName })
      const points = rows.map(normalizeFapaiCommunityPoint).filter((item): item is MapPoint => Boolean(item))
      const markerMeta = new Map<number, MarkerMeta>()
      points.forEach((point, index) => markerMeta.set(700000 + index, {
        type: 'auctionCommunity',
        name: point.name,
        entityId: point.entityId,
        bubbleId: point.bubbleId,
        longitude: point.longitude,
        latitude: point.latitude,
      }))
      const boundsPoints = toMapBoundsPoints(points)
      ;(this as any)._markerMeta = markerMeta
      ;(this as any)._auctionSubAreaParent = parent
      this.setData({
        markers: createMarkers(points, 700000, '#e34b40'),
        polylines: [],
        includePoints: boundsPoints,
        longitude: Number.isFinite(Number(parent.longitude)) ? Number(parent.longitude) : points[0]?.longitude || this.data.longitude,
        latitude: Number.isFinite(Number(parent.latitude)) ? Number(parent.latitude) : points[0]?.latitude || this.data.latitude,
        scale: 14,
        zoomLevel: 'community',
        pageDesc: parent.name + ' · 小区分布',
        mapTipText: '点击小区查看源',
        loading: false,
      })
      markProgrammaticRegionChange(this, 4)
    } catch (error) {
      console.error('loadAuctionCommunities failed', { parent, error })
      this.setData({ loading: false })
      wx.showToast({ title: '小区加载失败', icon: 'none' })
    } finally {
      ;(this as any)._auctionLoadingLevel = ''
    }
  },

  async loadAuctionCommunityHouses(meta: MarkerMeta) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const communityId = normalizeText(meta.entityId || meta.bubbleId)
    if (!communityId) return
    this.setData({ loading: true, loadingText: '房源加载中...', drawerVisible: false })
    try {
      const response = await requestFapaiMapHouses({ communityId })
      const listings = response.items.map(buildAuctionDrawerItem)
      if (listings.length === 0) {
        this.setData({
          loading: false,
          drawerVisible: false,
          activeCommunityName: meta.name,
          activeCommunityListings: [],
          mapTipText: meta.name + ' 暂无源',
        })
        wx.showToast({ title: meta.name + ' 暂无源', icon: 'none' })
        return
      }
      this.setData({
        loading: false,
        drawerVisible: true,
        activeCommunityName: response.communityName || meta.name,
        activeCommunityListings: listings,
        mapTipText: '当前展示 ' + (response.communityName || meta.name) + ' 的源',
      })
    } catch (error) {
      console.error('loadAuctionCommunityHouses failed', { meta, error })
      this.setData({ loading: false })
      wx.showToast({ title: '房源加载失败', icon: 'none' })
    }
  },

  getMapScale(): Promise<number> {
    return new Promise((resolve) => {
      const mapCtx = (this as any)._mapCtx as WechatMiniprogram.MapContext
      if (!mapCtx || !mapCtx.getScale) {
        resolve(this.data.scale)
        return
      }
      mapCtx.getScale({
        success: (res) => resolve(Number(res.scale) || this.data.scale),
        fail: () => resolve(this.data.scale),
      })
    })
  },

  fitMapToPoints(points: Array<{ longitude: number; latitude: number }>) {
    const safePoints = (points || []).filter((point) => (
      point &&
      Number.isFinite(Number(point.longitude)) &&
      Number.isFinite(Number(point.latitude))
    ))
    if (safePoints.length < 2) return
    const mapCtx = (this as any)._mapCtx as WechatMiniprogram.MapContext
    if (!mapCtx || !mapCtx.includePoints) return
    markProgrammaticRegionChange(this, 2)
    setTimeout(() => {
      mapCtx.includePoints({
        points: safePoints,
        padding: [48, 48, 48, 48],
      })
    }, 0)
  },

  getMapRegion(): Promise<{ southwest: { latitude: number; longitude: number }; northeast: { latitude: number; longitude: number } } | null> {
    return new Promise((resolve) => {
      const mapCtx = (this as any)._mapCtx as WechatMiniprogram.MapContext
      if (!mapCtx || !mapCtx.getRegion) {
        resolve(null)
        return
      }
      mapCtx.getRegion({
        success: (res) => {
          if (!res || !res.southwest || !res.northeast) {
            resolve(null)
            return
          }
          resolve({ southwest: res.southwest, northeast: res.northeast })
        },
        fail: () => resolve(null),
      })
    })
  },

  async onRegionChange(e: WechatMiniprogram.CustomEvent<{ type?: 'begin' | 'end' }>) {
    if (!e.detail || e.detail.type !== 'end') return
    const ignoreRegionChangeCount = Number((this as any)._ignoreRegionChangeCount || 0)
    if (ignoreRegionChangeCount > 0) {
      ;(this as any)._ignoreRegionChangeCount = ignoreRegionChangeCount - 1
      return
    }
    const suppressUntil = Number((this as any)._suppressAutoLevelUntil || 0)
    if (suppressUntil > Date.now()) return
    const scale = await (this as any).getMapScale()

    if (this.data.sourceType === 'ershou') {
      if ((this as any)._ershouLoadingLevel) return
      if (scale <= ERSHOU_DISTRICT_MAX_SCALE && this.data.zoomLevel !== 'district') {
        await (this as any).loadErshouDistricts()
        return
      }
      if (scale <= ERSHOU_BIZCIRCLE_MAX_SCALE && scale > ERSHOU_DISTRICT_MAX_SCALE && this.data.zoomLevel === 'community') {
        const parent = (this as any)._ershouDistrictParent as MarkerMeta | undefined
        if (parent && parent.entityId) {
          await (this as any).loadErshouSubAreas(parent)
          return
        }
        await (this as any).loadErshouDistricts()
      }
      return
    }

    if ((this as any)._auctionLoadingLevel) return
    if (scale <= ERSHOU_DISTRICT_MAX_SCALE && this.data.zoomLevel !== 'district') {
      await (this as any).loadAuctionDistricts()
      return
    }
    if (scale <= ERSHOU_BIZCIRCLE_MAX_SCALE && scale > ERSHOU_DISTRICT_MAX_SCALE && this.data.zoomLevel === 'community') {
      const parent = (this as any)._auctionDistrictParent as MarkerMeta | undefined
      if (parent && parent.entityId) {
        await (this as any).loadAuctionSubAreas(parent)
        return
      }
      await (this as any).loadAuctionDistricts()
    }
  },

  async onMarkerTap(e: WechatMiniprogram.CustomEvent<{ markerId: number }>) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const markerId = Number(e.detail.markerId)
    const markerMeta = (this as any)._markerMeta as Map<number, MarkerMeta>
    const meta = markerMeta.get(markerId)
    if (!meta || !meta.name) return

    if (this.data.sourceType === 'ershou') {
      if (meta.type === 'ershouDistrict') {
        suppressAutoLevelFallback(this)
        await (this as any).loadErshouSubAreas(meta)
        return
      }
      if (meta.type === 'ershouSubArea') {
        suppressAutoLevelFallback(this)
        await (this as any).loadErshouCommunities(meta)
        return
      }
      if (meta.type === 'ershouCommunity') {
        await (this as any).loadErshouCommunityHouses(meta)
      }
      return
    }

    if (meta.type === 'auctionDistrict') {
      suppressAutoLevelFallback(this)
      await (this as any).loadAuctionSubAreas(meta)
      return
    }
    if (meta.type === 'auctionSubArea') {
      suppressAutoLevelFallback(this)
      await (this as any).loadAuctionCommunities(meta)
      return
    }
    if (meta.type === 'auctionCommunity') {
      await (this as any).loadAuctionCommunityHouses(meta)
    }
  },

  onHouseTypeTabTap(e: WechatMiniprogram.CustomEvent<{ typeid: number }>) {
    if (this.data.sourceType === 'ershou') return
    const typeId = Number(e.currentTarget.dataset.typeid || 0)
    if (!typeId || typeId === this.data.activeHouseTypeId) return
    this.setData({ activeHouseTypeId: typeId, zoomLevel: 'district' })
    ;(this as any).loadAuctionDistricts()
  },

  onCalloutTap(e: WechatMiniprogram.CustomEvent<{ markerId: number }>) {
    ;(this as any).onMarkerTap({ detail: e.detail } as WechatMiniprogram.CustomEvent<{ markerId: number }>)
  },

  onDrawerMaskTap() {
    this.setData({ drawerVisible: false })
  },

  onDrawerCloseTap() {
    this.setData({ drawerVisible: false })
  },

  onErshouHouseTap(e: WechatMiniprogram.CustomEvent<{ id: string; housecode: string }>) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const id = String(e.currentTarget.dataset.id || '')
    const houseCode = String(e.currentTarget.dataset.housecode || '')
    if (!id && !houseCode) return
    const target = (this.data.activeCommunityListings || []).find((item) => item.id === id || item.houseCode === houseCode)
    if (target?.detailPayload) {
      try {
        wx.setStorageSync(ERSHOU_DETAIL_CACHE_KEY, target.detailPayload)
      } catch (error) {
        console.warn('save map ershou detail cache failed:', error)
      }
    }
    wx.navigateTo({
      url: '/pages/ershoudetail/index?listingId=' + encodeURIComponent(id) + '&houseCode=' + encodeURIComponent(houseCode),
    })
  },

  onAuctionHouseTap(e: WechatMiniprogram.CustomEvent<{ id: string; housecode?: string }>) {
    if (!hasWechatAccess()) {
      showNoAccessToast()
      return
    }
    const id = Number(e.currentTarget.dataset.id || 0)
    const sourceId = String((e.currentTarget.dataset as { housecode?: string }).housecode || '').trim()
    if (!id) return
    wx.navigateTo({
      url: `/pages/housedetail/index?id=${id}${sourceId ? `&sourceId=${encodeURIComponent(sourceId)}` : ''}`,
    })
  },

  noop() {},
})
