import { readWechatAccessShareKey } from '../utils/wechat-access'

export type HouseListQuery = {
  pageNum: number
  pageSize: number
  cityName: string
  houseTypeId: number
  searchName?: string
  type?: number
  status?: number
  auctionMode?: number
  sortName?: string
  sortStyle?: 'asc' | 'desc'
  districtId?: number
  districtName?: string
  minArea?: number
  maxArea?: number
  minStartingPrice?: number
  maxStartingPrice?: number
}

// ------- List API types -------
export type HouseListRow = {
  id: number
  title: string
  communityName?: string | null
  location?: string | null
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
  auctionMode?: number | null
}

type HouseListResponse = {
  code?: number
  data?: {
    total?: number
    rows?: HouseListRow[]
  }
}

// ------- API endpoints -------
const HOUSE_LIST_API = 'https://api.ysfp.com.cn/api/house/index/list'
const HOUSE_TYPE_LIST_API = 'https://api.ysfp.com.cn/api/house/type/list'
const HOUSE_DETAIL_API = 'https://api.ysfp.com.cn/api/house/detail'
// const BK_API_BASE_URL = 'http://152.136.108.55:9080'
const BK_API_BASE_URL = 'https://shanlan.xyz'
const ERSHOU_LIST_API = `${BK_API_BASE_URL}/api/bk/ershou/list`
const ERSHOU_DETAIL_API = `${BK_API_BASE_URL}/api/bk/ershou/details/item`
const BK_MAP_BUBBLES_API = `${BK_API_BASE_URL}/api/bk/map/bubbles`
const BK_MAP_DISTRICTS_API = `${BK_API_BASE_URL}/api/bk/map/districts`
const BK_MAP_HOUSES_API = `${BK_API_BASE_URL}/api/bk/map/houses`
const BK_MAP_HOUSE_CARD_API = `${BK_API_BASE_URL}/api/bk/map/house-card`
const DJL_MAP_DISTRICTS_API = `${BK_API_BASE_URL}/api/djl/map/districts`
const DJL_MAP_SUB_AREAS_API = `${BK_API_BASE_URL}/api/djl/map/sub-areas`
const DJL_MAP_COMMUNITIES_API = `${BK_API_BASE_URL}/api/djl/map/communities`
const BASIC_SETTINGS_API = `${BK_API_BASE_URL}/api/basic-settings`
const SPECIAL_ASSETS_API = `${BK_API_BASE_URL}/api/special-assets`
const MAP_DISTRICT_COUNT_API = 'https://api.ysfp.com.cn/api/map/district/getDistrictHouseCount'
const SUBWAY_BY_CITY_API = 'https://api.ysfp.com.cn/api/subwayDate/getSubwayByCityName'
const MAP_DATA_API = 'https://api.ysfp.com.cn/api/map/district/dataMap'
const SERVICE_TEL_API = 'https://api.ysfp.com.cn/api/common/service/tel'

function withWechatShareKey<T extends Record<string, unknown>>(data?: T): T & { shareKey?: string } {
  const shareKey = readWechatAccessShareKey()
  return Object.assign({}, data || {}, shareKey ? { shareKey } : {}) as T & { shareKey?: string }
}

function wechatShareHeader(): Record<string, string> {
  const shareKey = readWechatAccessShareKey()
  return shareKey ? { 'x-share-key': shareKey } : {}
}

// ------- Detail API types -------
export type HouseDetailRow = {
  id: number
  title: string
  communityName?: string | null
  location?: string | null
  coverPic?: string | null
  detailPic?: string | null
  hpfCoverPic?: string | null
  hpfDetailPic?: string | null
  detailAddress?: string | null
  address?: string | null
  area?: number | null
  layout?: string | null
  orientation?: string | null
  startingPrice?: number | null
  marketPrice?: number | null
  startingUnitPrice?: number | null
  auctionTime?: string | null
  floorLevel?: string | null
  elevator?: string | null
  buildYear?: string | null
  decoration?: string | null
  auctionMode?: string | null
  platform?: string | null
  guaranteeAmount?: number | null
  markupPrice?: number | null
  discountRate?: number | null
  jumpLink?: string | null
  phone?: string | null
  mobile?: string | null
  contactName?: string | null
  brokerName?: string | null
  avatar?: string | null
  brokerAvatar?: string | null
}

type HouseDetailResponse = {
  code?: number
  data?: HouseDetailRow
}

// ------- Map API types -------
type DistrictCountRow = {
  areaName: string
  districtId: number
  location: string
  houseCount: string
}

type DistrictCountResponse = {
  code?: number
  data?: DistrictCountRow[]
}

type SubwayStationRow = {
  station: string
  latitude: number
  longitude: number
}

type SubwayLineRow = {
  lineName: string
  subwayDataList: SubwayStationRow[]
}

type SubwayResponse = {
  code?: number
  data?: {
    code?: number
    data?: SubwayLineRow[]
  }
}

export type MapCommunityRow = {
  communityName: string
  location: string
  houseCount: string
}

type MapCommunityResponse = {
  code?: number
  data?: MapCommunityRow[]
}

export type ServiceTelData = {
  tel?: string
  averageTransactionPrice?: string | number
  auctioningCount?: string | number
  comeAuctioningCount?: string | number
  todayIncreaseCount?: string | number
}

type ServiceTelResponse = {
  code?: number
  data?: ServiceTelData
}

export type BasicSettingsData = {
  id?: number
  min_house_price?: number
  max_house_price?: number
  interest_rate?: number
  updated_at?: string
}

type BasicSettingsResponse = {
  success?: boolean
  data?: BasicSettingsData
  message?: string
}

export type WechatPhoneAuthData = {
  id?: number
  phoneNumber?: string
  purePhoneNumber?: string
  countryCode?: string
  userType?: 'sales' | 'customer'
  canShareMiniProgram?: boolean
  insertedWechatPhoneAuth?: boolean
  salesPhone?: string
  authorizedUntil?: string
  accessGranted?: boolean
  message?: string
  matchedPerson?: {
    id?: number
    name?: string
    phone?: string
    role?: string
    status?: number
    remark?: string
  } | null
}

type WechatPhoneAuthResponse = {
  success?: boolean
  data?: WechatPhoneAuthData
  message?: string
}

export type WechatLoginData = {
  openid?: string
  unionid?: string
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
    phone?: string
    role?: string
    status?: number
    remark?: string
    wechatOpenid?: string
    wechatUnionid?: string
    wechatBoundAt?: string
  } | null
  salesPerson?: {
    id?: number
    name?: string
    phone?: string
    role?: string
    status?: number
    remark?: string
    wechatOpenid?: string
    wechatUnionid?: string
    wechatBoundAt?: string
  } | null
  binding?: {
    id?: number
    openid?: string
    unionid?: string
    salesOpenid?: string
    salesPersonId?: number | null
    shareKey?: string
    boundAt?: string
    authorizedUntil?: string
    expired?: boolean
  } | null
  share?: WechatShareData | null
}

export type WechatBindSalesOpenidData = WechatLoginData

export type WechatShareData = {
  id?: number
  shareKey?: string
  salesOpenid?: string
  salesPersonId?: number | null
  expireAt?: string
  status?: number
  expired?: boolean
  salesPerson?: {
    id?: number
    name?: string
    phone?: string
    role?: string
    status?: number
    remark?: string
    wechatOpenid?: string
    wechatUnionid?: string
    wechatBoundAt?: string
  } | null
}

type WechatShareResponse = {
  success?: boolean
  data?: WechatShareData
  message?: string
  error?: string
}

type WechatBindSalesOpenidResponse = {
  success?: boolean
  data?: WechatBindSalesOpenidData
  message?: string
  error?: string
}

type WechatBindStaffPhoneResponse = {
  success?: boolean
  data?: WechatLoginData & {
    phoneNumber?: string
  }
  message?: string
  error?: string
}

export type ErshouListingsQuery = {
  page: number
  pageSize?: number
  includeTotal?: boolean
  title?: string
  districtName?: string
  areaCode?: string
  subAreaName?: string
  communityId?: string
  minPrice?: number
  maxPrice?: number
  minArea?: number
  maxArea?: number
}

export type ErshouListingsRow = {
  id?: number
  houseCode?: string
  createdAt?: string | null
  title?: string
  listingDesc?: string
  buildAreaSqm?: number | string | null
  captureDate?: string
  communityId?: string | null
  communityName?: string
  districtName?: string | null
  totalPriceText?: string | null
  totalPriceUnit?: string | null
  unitPriceText?: string | null
  poster_image?: string | null
  posterImage?: string | null
  gallery_images?: string[] | null
  galleryImages?: string[] | null
  coverPic?: string | null
  cardType?: string | null
  longitude?: number | null
  latitude?: number | null
}

type ErshouListingsResponse = {
  ok?: boolean
  result?: {
    page?: number
    pageSize?: number
    total?: number
    items?: ErshouListingsRow[]
  }
}

export type SpecialAssetRow = {
  id?: number
  title?: string
  communityName?: string
  assetDesc?: string
  totalPrice?: string
  unitPrice?: string
  area?: number | string | null
  bedRoomNum?: number | string | null
  hallNum?: number | string | null
  orientation?: string
  floorState?: string
  contactName?: string
  contactPhone?: string
  coverImage?: string
  galleryImages?: string[]
  status?: number
  remark?: string
  createdAt?: string
  updatedAt?: string
}

type SpecialAssetsResponse = {
  success?: boolean
  data?: {
    page?: number
    pageSize?: number
    total?: number
    totalPages?: number
    items?: SpecialAssetRow[]
  }
  message?: string
}

type SpecialAssetDetailResponse = {
  success?: boolean
  data?: SpecialAssetRow
  message?: string
}

export type ErshouDetailPhotoRow = {
  imageUrl?: string
  roomName?: string
}

export type ErshouDetailFloorPlanRow = {
  imageUrl?: string
}

export type ErshouDetailRow = {
  listingId?: number
  detailId?: number
  captureDate?: string
  houseCode?: string
  route?: string
  title?: string
  price?: string
  unitPrice?: string
  area?: string
  bedRoomNum?: number
  hallNum?: number
  orientation?: string
  floorState?: string
  propertyType?: string
  buildYear?: string
  houseUse?: string
  buildingType?: string
  orientationText?: string
  hasElevatorText?: string
  communityId?: string
  communityName?: string
  cityId?: string
  longitude?: number | null
  latitude?: number | null
  mUrl?: string
  coverImage?: string | null
  decoration?: string
  buildingYear?: string
  buildingStructure?: string
  elevatorText?: string
  floorText?: string
  metroText?: string
  houseLocationText?: string
  tagsText?: string
  propertyFeeText?: string
  usageType?: string
  viewingTime?: string
  statusText?: string
  mainAgentName?: string
  mainAgentPhone?: string
  poster_image?: string | null
  posterImage?: string | null
  gallery_images?: string[] | null
  galleryImages?: string[] | null
  dynamic?: Array<{
    title?: string
    subTitle?: string
    navName?: string
    actionText?: string
    changeTitle?: string
    changeSubTitle?: string
    priceTimeline?: Array<{
      desc?: string
      unit?: string
      price?: string
      dateStr?: string
    }>
    stats?: Array<{
      title?: string
      numbers?: string
      unit?: string
    }>
  }>
  resources?: {
    vr?: Array<{ coverUrl?: string }>
    photos?: ErshouDetailPhotoRow[]
    floorPlans?: ErshouDetailFloorPlanRow[]
  }
  communityInfo?: {
    desc?: string
    resblockId?: string
    resblockName?: string
  }
  commute?: {
    commutingLocation?: {
      startPoint?: {
        name?: string
        pointLat?: number
        pointLng?: number
      }
      hasCommuteInfo?: number
    }
  }
  surroundings?: Array<{
    tabs?: Array<{
      mapActionUrl?: string
    }>
  }> | {
    tabs?: Array<{
      mapActionUrl?: string
    }>
  }
}

type ErshouDetailResponse = {
  ok?: boolean
  result?: ErshouDetailRow
}

export type BkMapGroupType = 'district' | 'bizcircle' | 'community'

export type BkMapBubbleRow = {
  captureDate?: string | null
  groupType: BkMapGroupType
  parentGroupType?: string | null
  parentId?: string | null
  entityId?: string | null
  entityType?: string | null
  bubbleId?: string | null
  name?: string | null
  fullSpell?: string | null
  price?: number | null
  priceStr?: string | null
  priceUnit?: string | null
  desc?: string | null
  bubbleDesc?: string | null
  longitude?: number | null
  latitude?: number | null
}

type BkMapBubblesResponse = {
  ok?: boolean
  result?: {
    captureDate?: string | null
    groupType?: BkMapGroupType
    parentId?: string | null
    itemCount?: number
    items?: BkMapBubbleRow[]
  }
}

type BkMapDistrictsResponse = {
  ok?: boolean
  result?: {
    items?: Array<{
      district_name?: string
    }>
    itemCount?: number
  }
}

export type DjlMapDistrictRow = {
  areaCode?: string
  areaName?: string
  displayName?: string
  longitude?: number | null
  latitude?: number | null
  houseCount?: number | null
  avgTotalPriceWan?: number | null
  priceText?: string | null
}

type DjlMapDistrictsResponse = {
  ok?: boolean
  result?: {
    items?: DjlMapDistrictRow[]
    itemCount?: number
  }
}

export type DjlMapSubAreaRow = {
  areaCode?: string
  areaName?: string
  subAreaName?: string
  longitude?: number | null
  latitude?: number | null
  communityCount?: number | null
  houseCount?: number | null
  avgTotalPriceWan?: number | null
  priceText?: string | null
}

type DjlMapSubAreasResponse = {
  ok?: boolean
  result?: {
    items?: DjlMapSubAreaRow[]
    itemCount?: number
  }
}

export type DjlMapCommunityRow = {
  communityId?: string
  communityName?: string
  areaCode?: string
  areaName?: string
  subAreaName?: string
  longitude?: number | null
  latitude?: number | null
  houseCount?: number | null
  avgTotalPriceWan?: number | null
  priceText?: string | null
}

type DjlMapCommunitiesResponse = {
  ok?: boolean
  result?: {
    items?: DjlMapCommunityRow[]
    itemCount?: number
  }
}

export type BkMapHouseRow = {
  id?: number
  captureDate?: string | null
  resblockId?: string | null
  resblockName?: string | null
  houseCode?: string | null
  title?: string | null
  desc?: string | null
  buildAreaSqm?: number | string | null
  originalCoverPic?: string | null
  coverPic?: string | null
  posterImage?: string | null
  priceStr?: string | null
  unitPriceStr?: string | null
  actionUrl?: string | null
  cardType?: string | null
  itemIndex?: number | null
  total?: number | null
  longitude?: number | null
  latitude?: number | null
}

type BkMapHousesResponse = {
  ok?: boolean
  result?: {
    captureDate?: string | null
    resblockId?: string
    resblockName?: string
    total?: number
    itemCount?: number
    items?: BkMapHouseRow[]
  }
}

type BkMapHouseCardResponse = {
  ok?: boolean
  result?: BkMapHouseRow
}

// 列表查询：线上接口失败时由页面层决定是否回退本地 mock。
export function requestHouseList(query: HouseListQuery): Promise<{ rows: HouseListRow[]; total: number }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: HOUSE_LIST_API,
      method: 'GET',
      data: query,
      success: (res) => {
        const responseData = (res.data || {}) as HouseListResponse
        if (responseData.code !== 200) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve({
          rows: (responseData.data && responseData.data.rows) || [],
          total: Number((responseData.data && responseData.data.total) || 0),
        })
      },
      fail: () => {
        reject(new Error('NETWORK_FAIL'))
      },
    })
  })
}

export function requestHouseTypeList(query: Partial<HouseListQuery>): Promise<{ rows: HouseListRow[]; total: number }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: HOUSE_TYPE_LIST_API,
      method: 'GET',
      data: query,
      success: (res) => {
        const responseData = (res.data || {}) as HouseListResponse
        if (responseData.code !== 200) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve({
          rows: (responseData.data && responseData.data.rows) || [],
          total: Number((responseData.data && responseData.data.total) || 0),
        })
      },
      fail: () => reject(new Error('NETWORK_FAIL')),
    })
  })
}

export function requestHouseDetail(id: number): Promise<HouseDetailRow> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${HOUSE_DETAIL_API}/${id}`,
      method: 'GET',
      success: (res) => {
        const responseData = (res.data || {}) as HouseDetailResponse
        if (responseData.code !== 200 || !responseData.data) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: () => {
        reject(new Error('NETWORK_FAIL'))
      },
    })
  })
}

export function requestErshouListings(query: ErshouListingsQuery): Promise<{ items: ErshouListingsRow[]; total: number; pageSize: number }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: ERSHOU_LIST_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(query as unknown as Record<string, unknown>),
      success: (res) => {
        const responseData = (res.data || {}) as ErshouListingsResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve({
          items: responseData.result.items || [],
          total: Number(responseData.result.total || 0),
          pageSize: Number(responseData.result.pageSize || query.pageSize || 20),
        })
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestErshouDetailById(id: number): Promise<ErshouDetailRow> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: ERSHOU_DETAIL_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey({ id }),
      success: (res) => {
        const responseData = (res.data || {}) as ErshouDetailResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.result)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestSpecialAssets(query: { page: number; pageSize?: number; keyword?: string; status?: number }): Promise<{ items: SpecialAssetRow[]; total: number; pageSize: number }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: SPECIAL_ASSETS_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(query as unknown as Record<string, unknown>),
      success: (res) => {
        const responseData = (res.data || {}) as SpecialAssetsResponse
        if (!responseData.success || !responseData.data) {
          reject(new Error(responseData.message || 'API_CODE_ERROR'))
          return
        }
        resolve({
          items: responseData.data.items || [],
          total: Number(responseData.data.total || 0),
          pageSize: Number(responseData.data.pageSize || query.pageSize || 20),
        })
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestSpecialAssetDetail(id: number): Promise<SpecialAssetRow> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${SPECIAL_ASSETS_API}/${id}`,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(),
      success: (res) => {
        const responseData = (res.data || {}) as SpecialAssetDetailResponse
        if (!responseData.success || !responseData.data) {
          reject(new Error(responseData.message || 'API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestBkMapBubbles(params: {
  groupType: BkMapGroupType
  parentId?: string
  parentAltId?: string
  date?: string
}): Promise<{ items: BkMapBubbleRow[]; itemCount: number; captureDate?: string | null }> {
  return new Promise((resolve, reject) => {
    const data: Record<string, string> = {
      groupType: params.groupType,
    }
    if (params.parentId !== undefined) data.parentId = params.parentId
    if (params.parentAltId !== undefined && params.parentAltId !== '') data.parentAltId = params.parentAltId
    if (params.date) data.date = params.date
    wx.request({
      url: BK_MAP_BUBBLES_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(data),
      success: (res) => {
        const responseData = (res.data || {}) as BkMapBubblesResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve({
          items: responseData.result.items || [],
          itemCount: Number(responseData.result.itemCount || 0),
          captureDate: responseData.result.captureDate,
        })
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestBkMapDistricts(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BK_MAP_DISTRICTS_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(),
      success: (res) => {
        const responseData = (res.data || {}) as BkMapDistrictsResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(
          (responseData.result.items || [])
            .map((item) => String(item?.district_name || '').trim())
            .filter(Boolean)
        )
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestBkMapHouses(params: {
  resblockId?: string
  resblockAltId?: string
  date?: string
}): Promise<{ items: BkMapHouseRow[]; itemCount: number; total: number; captureDate?: string | null; resblockName?: string }> {
  return new Promise((resolve, reject) => {
    const data: Record<string, string> = {}
    if (params.resblockId) data.resblockId = params.resblockId
    if (params.resblockAltId !== undefined && params.resblockAltId !== '') data.resblockAltId = params.resblockAltId
    if (params.date) data.date = params.date
    wx.request({
      url: BK_MAP_HOUSES_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(data),
      success: (res) => {
        const responseData = (res.data || {}) as BkMapHousesResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve({
          items: responseData.result.items || [],
          itemCount: Number(responseData.result.itemCount || 0),
          total: Number(responseData.result.total || 0),
          captureDate: responseData.result.captureDate,
          resblockName: responseData.result.resblockName,
        })
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestDjlMapDistricts(): Promise<DjlMapDistrictRow[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: DJL_MAP_DISTRICTS_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(),
      success: (res) => {
        const responseData = (res.data || {}) as DjlMapDistrictsResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.result.items || [])
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestDjlMapSubAreas(params: {
  areaCode: string
}): Promise<DjlMapSubAreaRow[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: DJL_MAP_SUB_AREAS_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(params as unknown as Record<string, unknown>),
      success: (res) => {
        const responseData = (res.data || {}) as DjlMapSubAreasResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.result.items || [])
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestDjlMapCommunities(params: {
  areaCode: string
  subAreaName: string
}): Promise<DjlMapCommunityRow[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: DJL_MAP_COMMUNITIES_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(params as unknown as Record<string, unknown>),
      success: (res) => {
        const responseData = (res.data || {}) as DjlMapCommunitiesResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.result.items || [])
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestBkMapHouseCard(params: {
  id?: number | string
  houseCode?: string
  date?: string
}): Promise<BkMapHouseRow> {
  return new Promise((resolve, reject) => {
    const data: Record<string, string | number> = {}
    if (params.id !== undefined && params.id !== '') data.id = params.id
    if (params.houseCode) data.houseCode = params.houseCode
    if (params.date) data.date = params.date
    wx.request({
      url: BK_MAP_HOUSE_CARD_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(data),
      success: (res) => {
        const responseData = (res.data || {}) as BkMapHouseCardResponse
        if (!responseData.ok || !responseData.result) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.result)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestDistrictHouseCount(cityName: string, houseTypeId: number): Promise<DistrictCountRow[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: MAP_DISTRICT_COUNT_API,
      method: 'GET',
      data: { cityName, houseTypeId, type: 0 },
      success: (res) => {
        const responseData = (res.data || {}) as DistrictCountResponse
        if (responseData.code !== 200) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.data || [])
      },
      fail: () => reject(new Error('NETWORK_FAIL')),
    })
  })
}

export function requestSubwayByCityName(cityName: string): Promise<SubwayLineRow[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: SUBWAY_BY_CITY_API,
      method: 'GET',
      data: { cityName },
      success: (res) => {
        const responseData = (res.data || {}) as SubwayResponse
        if (responseData.code !== 200) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve((responseData.data && responseData.data.data) || [])
      },
      fail: () => reject(new Error('NETWORK_FAIL')),
    })
  })
}

// 地图放大后的社区点位接口（POST），参数由地图当前视野范围驱动。
export function requestMapData(params: {
  cityName: string
  houseTypeId: number
  maxLatitude: number
  minLatitude: number
  maxLongitude: number
  minLongitude: number
}): Promise<MapCommunityRow[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: MAP_DATA_API,
      method: 'POST',
      data: {
        cityName: params.cityName,
        lineName: '',
        stationName: [],
        houseTypeId: params.houseTypeId,
        type: 0,
        maxLatitude: params.maxLatitude,
        minLatitude: params.minLatitude,
        maxLongitude: params.maxLongitude,
        minLongitude: params.minLongitude,
      },
      success: (res) => {
        const responseData = (res.data || {}) as MapCommunityResponse
        if (responseData.code !== 200) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.data || [])
      },
      fail: () => reject(new Error('NETWORK_FAIL')),
    })
  })
}

export function requestServiceTel(cityName?: string): Promise<ServiceTelData> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: SERVICE_TEL_API,
      method: 'GET',
      data: cityName ? { cityName } : {},
      success: (res) => {
        const responseData = (res.data || {}) as ServiceTelResponse
        if (responseData.code !== 200 || !responseData.data) {
          reject(new Error('API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: () => reject(new Error('NETWORK_FAIL')),
    })
  })
}

export function requestBasicSettings(): Promise<BasicSettingsData> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASIC_SETTINGS_API,
      method: 'GET',
      header: wechatShareHeader(),
      data: withWechatShareKey(),
      success: (res) => {
        const responseData = (res.data || {}) as BasicSettingsResponse
        if (!responseData.success || !responseData.data) {
          reject(new Error(responseData.message || 'API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestCreateWechatShare(params: {
  phoneNumber: string
}): Promise<WechatShareData> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BK_API_BASE_URL}/api/wechat/create-share`,
      method: 'POST',
      header: {
        'content-type': 'application/json',
      },
      data: params,
      success: (res) => {
        const responseData = (res.data || {}) as WechatShareResponse
        if (!responseData.success || !responseData.data?.shareKey) {
          reject(new Error(responseData.message || responseData.error || 'API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestBindSalesOpenid(params: {
  phoneNumber: string
  shareKey: string
  unionid?: string
}): Promise<WechatBindSalesOpenidData> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BK_API_BASE_URL}/api/wechat/bind-sales-openid`,
      method: 'POST',
      header: {
        'content-type': 'application/json',
      },
      data: params,
      success: (res) => {
        const responseData = (res.data || {}) as WechatBindSalesOpenidResponse
        if (!responseData.success || !responseData.data?.phoneNumber) {
          reject(new Error(responseData.message || responseData.error || 'API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestPhoneProfile(params: {
  phoneNumber: string
  shareKey?: string
}): Promise<WechatLoginData> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BK_API_BASE_URL}/api/wechat/phone-profile`,
      method: 'POST',
      header: {
        'content-type': 'application/json',
      },
      data: params,
      success: (res) => {
        const responseData = (res.data || {}) as WechatBindStaffPhoneResponse
        if (!responseData.success || !responseData.data?.phoneNumber) {
          reject(new Error(responseData.message || responseData.error || 'API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}

export function requestBindStaffPhone(params: {
  openid?: string
  code: string
  unionid?: string
  shareKey?: string
}): Promise<WechatLoginData> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BK_API_BASE_URL}/api/wechat/bind-staff-phone`,
      method: 'POST',
      header: {
        'content-type': 'application/json',
      },
      data: params,
      success: (res) => {
        const responseData = (res.data || {}) as WechatBindStaffPhoneResponse
        if (!responseData.success || !responseData.data?.phoneNumber) {
          reject(new Error(responseData.message || responseData.error || 'API_CODE_ERROR'))
          return
        }
        resolve(responseData.data)
      },
      fail: (err) => reject(new Error((err && (err as any).errMsg) || 'NETWORK_FAIL')),
    })
  })
}
