import { requestConfirmStaffWechatBinding, requestStaffWechatBindRequest } from '../../services/house'
import { saveWechatLoginCache } from '../../utils/wechat-access'

type BindRequestInfo = {
  bindRequest?: {
    bindToken?: string
    expiresAt?: string
  } | null
  staff?: {
    id?: number
    name?: string
    role?: string
  } | null
}

function parseBindTokenFromScene(sceneValue: string): string {
  const scene = decodeURIComponent(String(sceneValue || '').trim())
  if (!scene) return ''
  const params: Record<string, string> = {}
  scene.split('&').forEach((pair) => {
    const [rawKey, ...rest] = pair.split('=')
    const key = String(rawKey || '').trim()
    if (!key) return
    params[key] = String(rest.join('=') || '').trim()
  })
  return String(params.t || params.bindToken || params.token || '').trim()
}

Page({
  data: {
    loading: true,
    confirming: false,
    bindToken: '',
    errorMessage: '',
    successMessage: '',
    staffName: '',
    staffRole: '',
    expiresAt: '',
  },

  parseBindToken(options: Record<string, string>) {
    const directToken = String(options.t || options.bindToken || options.token || '').trim()
    if (directToken) return directToken
    return parseBindTokenFromScene(String(options.scene || ''))
  },

  async onLoad(options: Record<string, string>) {
    wx.setNavigationBarTitle({ title: '绑定销售身份' })
    const bindToken = this.parseBindToken(options)
    if (!bindToken) {
      this.setData({
        loading: false,
        errorMessage: '绑定参数无效，请重新扫码',
      })
      return
    }

    this.setData({ bindToken })
    await this.loadBindRequest(bindToken)
  },

  async loadBindRequest(bindToken: string) {
    this.setData({
      loading: true,
      errorMessage: '',
      successMessage: '',
    })

    try {
      const result = await requestStaffWechatBindRequest({ bindToken }) as BindRequestInfo
      this.setData({
        loading: false,
        staffName: String(result.staff?.name || ''),
        staffRole: String(result.staff?.role || ''),
        expiresAt: String(result.bindRequest?.expiresAt || ''),
      })
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : '绑定请求读取失败',
      })
    }
  },

  async onRetryTap() {
    if (!this.data.bindToken) return
    await this.loadBindRequest(this.data.bindToken)
  },

  async onConfirmTap() {
    if (this.data.confirming || !this.data.bindToken) return
    this.setData({
      confirming: true,
      errorMessage: '',
      successMessage: '',
    })

    try {
      const loginResult = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve, reject) => {
        wx.login({
          success: resolve,
          fail: reject,
        })
      })

      const code = String(loginResult.code || '').trim()
      if (!code) throw new Error('未获取到微信登录态，请重试')

      const profile = await requestConfirmStaffWechatBinding({
        bindToken: this.data.bindToken,
        code,
      })

      saveWechatLoginCache(profile)
      this.setData({
        confirming: false,
        successMessage: '绑定成功，当前微信已识别为内部人员',
      })

      wx.showToast({
        title: '绑定成功',
        icon: 'success',
      })

      setTimeout(() => {
        wx.switchTab({
          url: '/pages/index/index',
          fail: () => {
            wx.reLaunch({ url: '/pages/index/index' })
          },
        })
      }, 800)
    } catch (error) {
      this.setData({
        confirming: false,
        errorMessage: error instanceof Error ? error.message : '绑定失败，请稍后重试',
      })
    }
  },
})
