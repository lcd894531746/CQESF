function parseRange(selected: string): { min?: number; max?: number } {
  const normalized = String(selected || '').replace(/\s+/g, '')
  if (!normalized || normalized === '不限') return {}

  const numbers = (normalized.match(/[\d.]+/g) || [])
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value))

  if (normalized.includes('以下') && numbers[0] !== undefined) return { max: numbers[0] }
  if (normalized.includes('以上') && numbers[0] !== undefined) return { min: numbers[0] }
  if (normalized.includes('-') && numbers.length >= 2) return { min: numbers[0], max: numbers[1] }

  return {}
}

export function parseAreaRange(selected: string): { minArea?: number; maxArea?: number } {
  const range = parseRange(selected)
  return { minArea: range.min, maxArea: range.max }
}

export function parsePriceRange(selected: string): { minPrice?: number; maxPrice?: number } {
  const range = parseRange(selected)
  return { minPrice: range.min, maxPrice: range.max }
}

export function parseAmountRange(selected: string): { minAmount?: number; maxAmount?: number } {
  const range = parseRange(selected)
  return { minAmount: range.min, maxAmount: range.max }
}

export function splitColumns<T>(list: T[]): { left: T[]; right: T[] } {
  return list.reduce<{ left: T[]; right: T[] }>(
    (acc, item, index) => {
      if (index % 2 === 0) acc.left.push(item)
      else acc.right.push(item)
      return acc
    },
    { left: [], right: [] }
  )
}
