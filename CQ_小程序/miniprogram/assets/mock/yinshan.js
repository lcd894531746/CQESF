const fs = wx.getFileSystemManager()

function readJson(paths) {
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i]
    try {
      const content = fs.readFileSync(path, 'utf8')
      return JSON.parse(content)
    } catch (error) {
      // Continue trying fallback paths.
    }
  }
  return { code: 500, msg: 'READ_FAILED', data: { total: 0, rows: [] } }
}

module.exports = readJson([
  'assets/mock/yinshan.json',
  '/assets/mock/yinshan.json',
  'miniprogram/assets/mock/yinshan.json',
])
