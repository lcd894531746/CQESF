Component({
  data: {
    selected: 0,
    pressedIndex: -1,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '',
        icon: '⌂',
      },
      {
        pagePath: '/pages/ershou/index',
        text: '低首付',
        icon: '◎',
      },
      {
        pagePath: '/pages/specialassets/index',
        text: '特殊资产',
        icon: '◇',
      },
    ],
  },
  methods: {
    onSwitchTab(e: WechatMiniprogram.CustomEvent<{ path: string; index: number }>) {
      const path = e.currentTarget.dataset.path as string
      const index = Number(e.currentTarget.dataset.index || 0)
      if (!path) return
      if ((this as any)._switching) return
      ;(this as any)._switching = true
      if (this.data.selected !== index) this.setData({ selected: index })
      wx.switchTab({
        url: path,
        complete: () => {
          ;(this as any)._switching = false
          this.setData({ pressedIndex: -1 })
        },
      })
    },
    onTouchStart(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
      const index = Number(e.currentTarget.dataset.index || -1)
      this.setData({ pressedIndex: index })
    },
    onTouchEnd() {
      this.setData({ pressedIndex: -1 })
    },
    setSelected(index: number) {
      if (index < 0 || index === this.data.selected) return
      this.setData({ selected: index })
    },
    setHomeLabel(text: string) {
      const label = String(text || '').trim() || ''
      const list = this.data.list.slice()
      if (!list[0] || list[0].text === label) return
      list[0] = Object.assign({}, list[0], { text: label })
      this.setData({ list })
    },
  },
})
