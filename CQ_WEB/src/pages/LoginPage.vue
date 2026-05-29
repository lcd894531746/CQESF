<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AUTH_KEY, getDefaultRouteByRole, ROLE_MAP, setAuthRole, setAuthToken, setAuthUser } from '../constants/auth'
import request from '../utils/request'

const router = useRouter()
const authLoading = ref(false)
const authMessage = reactive({
  type: '',
  text: '',
})
const loginForm = reactive({
  phone: '',
  password: '',
})

function showAuthMessage(type, text) {
  authMessage.type = type
  authMessage.text = text
  window.clearTimeout(showAuthMessage.timer)
  showAuthMessage.timer = window.setTimeout(() => {
    authMessage.type = ''
    authMessage.text = ''
  }, 2500)
}

async function login() {
  if (!loginForm.phone || !loginForm.password) {
    showAuthMessage('error', '请输入手机号和密码')
    return
  }

  authLoading.value = true
  try {
    const response = await request.post('/system-staff/login', {
      phone: loginForm.phone,
      password: loginForm.password,
    })
    const user = response.data?.data
    const token = response.data?.token || user?.token || ''
    if (!token) {
      showAuthMessage('error', '登录凭证生成失败')
      return
    }
    window.localStorage.setItem(AUTH_KEY, '1')
    setAuthRole(user?.role || ROLE_MAP[user?.role] || '')
    setAuthToken(token)
    setAuthUser(Object.assign({}, user, { token: undefined }))
    loginForm.password = ''
    await router.replace(getDefaultRouteByRole(user?.role || ROLE_MAP[user?.role] || ''))
  } catch (error) {
    showAuthMessage('error', error.response?.data?.message || '手机号或密码错误')
  } finally {
    authLoading.value = false
  }
}
</script>

<template>
  <div class="login-shell">
    <div class="login-card">
      <h1>山澜资产</h1>
      <p class="login-tip">请输入手机号和密码后进入管理系统。</p>
      <form class="login-form" @submit.prevent="login">
        <label>
          <span class="required-label">手机号</span>
          <input v-model.trim="loginForm.phone" autocomplete="username" inputmode="tel" placeholder="请输入手机号" />
        </label>
        <label>
          <span class="required-label">密码</span>
          <input
            v-model="loginForm.password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
          />
        </label>
        <button class="primary login-btn" :disabled="authLoading" type="submit">
          {{ authLoading ? '登录中...' : '登录' }}
        </button>
      </form>
      <p v-if="authMessage.text" :class="['login-message', authMessage.type]">{{ authMessage.text }}</p>
    </div>
  </div>
</template>
