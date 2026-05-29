function resolveIncomingShareParams(options?: WechatMiniprogram.App.LaunchShowOption) {
  const query = options?.query || {}
  const shareKey = String(query.shareKey || '').trim()
  return { shareKey }
}

App<IAppOption>({
  globalData: {
    entryShareParams: {
      shareKey: '',
    },
  },
  onLaunch(options) {
    this.globalData.entryShareParams = resolveIncomingShareParams(options)
  },
  onShow(options) {
    this.globalData.entryShareParams = resolveIncomingShareParams(options)
  },
})
