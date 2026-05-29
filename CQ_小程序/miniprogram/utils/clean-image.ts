const CLEAN_IMAGE_API = 'https://shanlan.xyz/api/image/clean'
const YINSHAN_IMAGE_PREFIX = 'https://api.ysfp.com.cn/'
const SHANLAN_BASE_URL = 'https://shanlan.xyz'

function shouldCleanYinshanImage(url: string): boolean {
  const raw = url.trim()
  return raw.startsWith(YINSHAN_IMAGE_PREFIX)
}

export function cleanYinshanImageUrl(url?: string | null): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const normalized = raw.replace(/^http:\/\/shanlan\.xyz(?=\/)/i, SHANLAN_BASE_URL)
  if (normalized.startsWith('/uploads/')) {
    return `${SHANLAN_BASE_URL}${normalized}`
  }
  if (/^uploads\//i.test(normalized)) {
    return `${SHANLAN_BASE_URL}/${normalized.replace(/^\/+/, '')}`
  }
  if (!shouldCleanYinshanImage(normalized)) return normalized
  return `${CLEAN_IMAGE_API}?url=${encodeURIComponent(normalized)}`
}

export function cleanYinshanImageUrls(urls: string[]): string[] {
  return urls.map(cleanYinshanImageUrl).filter(Boolean)
}
