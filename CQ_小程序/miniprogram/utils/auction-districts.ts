export const FULL_AUCTION_DISTRICT_OPTIONS = [
  '不限',
  '渝中区',
  '江北区',
  '渝北区',
  '九龙坡区',
  '沙坪坝区',
  '南岸区',
  '巴南区',
  '大渡口区',
  '北碚区',
]

export function normalizeAuctionDistrictName(name?: string): string {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (raw === '两江新区' || raw === '北部新区') return '渝北区'
  if (raw.endsWith('区')) return raw
  return `${raw}区`
}

export function buildAuctionDistrictOptions(extraNames?: string[]): string[] {
  const result = FULL_AUCTION_DISTRICT_OPTIONS.slice()
  ;(extraNames || []).forEach((name) => {
    const normalized = normalizeAuctionDistrictName(name)
    if (result.indexOf(normalized) < 0 && FULL_AUCTION_DISTRICT_OPTIONS.indexOf(normalized) >= 0) {
      result.push(normalized)
    }
  })
  return result
}

export function extractAuctionDistrictName(...texts: Array<string | null | undefined>): string {
  const combined = texts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(' ')
  if (!combined) return ''
  const matched = FULL_AUCTION_DISTRICT_OPTIONS.find((name) => name !== '不限' && (combined.includes(name) || combined.includes(name.replace(/区$/, ''))))
  if (matched) return matched
  if (combined.includes('两江新区') || combined.includes('北部新区')) return '渝北区'
  return ''
}
