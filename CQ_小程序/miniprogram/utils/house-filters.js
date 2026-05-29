function parseRange(selected) {
  var normalized = String(selected || '').replace(/\s+/g, '')
  if (!normalized || normalized === '不限') return {}

  var numbers = (normalized.match(/[\d.]+/g) || [])
    .map(function (value) { return Number(value) })
    .filter(function (value) { return !Number.isNaN(value) })

  if (normalized.indexOf('以下') >= 0 && numbers[0] !== undefined) return { max: numbers[0] }
  if (normalized.indexOf('以上') >= 0 && numbers[0] !== undefined) return { min: numbers[0] }
  if (normalized.indexOf('-') >= 0 && numbers.length >= 2) return { min: numbers[0], max: numbers[1] }

  return {}
}

function parseAreaRange(selected) {
  var range = parseRange(selected)
  return { minArea: range.min, maxArea: range.max }
}

function parsePriceRange(selected) {
  var range = parseRange(selected)
  return { minPrice: range.min, maxPrice: range.max }
}

function parseAmountRange(selected) {
  var range = parseRange(selected)
  return { minAmount: range.min, maxAmount: range.max }
}

function splitColumns(list) {
  return (list || []).reduce(function (acc, item, index) {
    if (index % 2 === 0) acc.left.push(item)
    else acc.right.push(item)
    return acc
  }, { left: [], right: [] })
}

module.exports = {
  parseAreaRange: parseAreaRange,
  parsePriceRange: parsePriceRange,
  parseAmountRange: parseAmountRange,
  splitColumns: splitColumns,
}
