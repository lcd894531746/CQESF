Page({
  data: {
    longitude: 106.551556,
    latitude: 29.563009,
    scale: 16,
    title: '房源位置',
    address: '',
    markers: [] as WechatMiniprogram.Marker[],
  },
  onLoad(query: Record<string, string>) {
    const longitude = Number(query.lng || 0)
    const latitude = Number(query.lat || 0)
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !longitude || !latitude) {
      wx.showToast({ title: '位置信息无效', icon: 'none' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
      return
    }
    const title = decodeURIComponent(query.title || '房源位置')
    const address = decodeURIComponent(query.address || '')
    this.setData({
      longitude,
      latitude,
      title,
      address,
      markers: [
        {
          id: 1,
          longitude,
          latitude,
          width: 34,
          height: 34,
          // 不传 iconPath 使用系统默认定位图钉，视觉更接近地图场景
          anchor: { x: 0.5, y: 1 },
          callout: {
            content: title,
            display: 'ALWAYS',
            borderRadius: 8,
            bgColor: '#ffffff',
            color: '#111827',
            padding: 6,
            fontSize: 12,
          },
        },
      ],
    })
  },
})
