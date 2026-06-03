Page({
  data: {
    url: '',
  },

  onLoad(options: Record<string, string>) {
    const url = decodeURIComponent(options.url || '').trim()
    const title = decodeURIComponent(options.title || '').trim()

    if (title) {
      wx.setNavigationBarTitle({ title })
    }

    if (!url) {
      wx.showToast({ title: '\u94fe\u63a5\u4e0d\u5b58\u5728', icon: 'none' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 400)
      return
    }

    this.setData({ url })
  },

  onWebViewError() {
    const url = String(this.data.url || '').trim()
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: '\u65e0\u6cd5\u6253\u5f00\u7f51\u9875',
          content: '\u6765\u6e90\u5730\u5740\u5df2\u590d\u5236\uff0c\u8bf7\u5728\u5fae\u4fe1\u5916\u90e8\u6d4f\u89c8\u5668\u4e2d\u6253\u5f00\u3002',
          showCancel: false,
        })
      },
    })
  },
})
