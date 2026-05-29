const fs = wx.getFileSystemManager()

function readJson() {
  const candidates = ['assets/mock/detail.json', '/assets/mock/detail.json', 'miniprogram/assets/mock/detail.json']
  for (let i = 0; i < candidates.length; i += 1) {
    const path = candidates[i]
    try {
      const content = fs.readFileSync(path, 'utf8')
      if (content) return JSON.parse(content)
    } catch (error) {
      // Continue trying fallback paths.
    }
  }
  return { data: {} }
}

module.exports = readJson()
