<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { clearAuthStorage, getAuthUser, getRoleLabel, isReviewerOrAbove, setAuthUser } from '../constants/auth'
import request from '../utils/request'

const router = useRouter()
const passwordDialogVisible = ref(false)
const bindDialogVisible = ref(false)
const bindDialogLoading = ref(false)
const currentUserState = ref(getAuthUser())
const currentUser = computed(() => currentUserState.value)
const currentUserRoleLabel = computed(() => getRoleLabel(currentUser.value?.role || ''))
const passwordForm = reactive({
  password: '',
  confirmPassword: '',
})
const passwordMessage = reactive({
  type: '',
  text: '',
})
const bindDialogState = reactive({
  qrCodeUrl: '',
  expiresAt: '',
})

const bindButtonText = computed(() => {
  if (currentUser.value?.wechat_openid) return '已绑定微信'
  if (currentUser.value?.bind_status === 'pending') return '去绑定'
  return '未发起绑定'
})

const canOpenBindDialog = computed(() => currentUser.value?.bind_status === 'pending' && !currentUser.value?.wechat_openid)

async function logout() {
  clearAuthStorage()
  await router.replace('/login')
}

function showPasswordMessage(type, text) {
  passwordMessage.type = type
  passwordMessage.text = text
  window.clearTimeout(showPasswordMessage.timer)
  showPasswordMessage.timer = window.setTimeout(() => {
    passwordMessage.type = ''
    passwordMessage.text = ''
  }, 2500)
}

function openPasswordDialog() {
  if (!isReviewerOrAbove()) return
  passwordForm.password = ''
  passwordForm.confirmPassword = ''
  passwordDialogVisible.value = true
}

function closePasswordDialog() {
  passwordDialogVisible.value = false
  passwordForm.password = ''
  passwordForm.confirmPassword = ''
}

function closeBindDialog() {
  bindDialogVisible.value = false
  bindDialogState.qrCodeUrl = ''
  bindDialogState.expiresAt = ''
}

async function refreshCurrentUser() {
  const response = await request.get('/system-staff/current', { showLoading: false })
  currentUserState.value = response.data?.data || null
  setAuthUser(currentUserState.value)
}

async function openBindDialog() {
  if (!canOpenBindDialog.value || !currentUser.value?.id) return
  bindDialogLoading.value = true
  try {
    const response = await request.get(`/system-staff/${currentUser.value.id}/wechat-bind-request`, {
      showLoading: false,
    })
    bindDialogState.qrCodeUrl = response.data?.data?.bindRequest?.qrCodeUrl || ''
    bindDialogState.expiresAt = response.data?.data?.bindRequest?.expiresAt || ''
    bindDialogVisible.value = true
    await refreshCurrentUser()
  } catch (error) {
    showPasswordMessage('error', error.response?.data?.message || '读取绑定码失败')
  } finally {
    bindDialogLoading.value = false
  }
}

async function updateCurrentPassword() {
  if (!isReviewerOrAbove()) {
    showPasswordMessage('error', '暂无操作权限')
    return
  }

  if (!passwordForm.password) {
    showPasswordMessage('error', '请输入新密码')
    return
  }

  if (passwordForm.password !== passwordForm.confirmPassword) {
    showPasswordMessage('error', '两次输入的密码不一致')
    return
  }

  try {
    await request.put(`/system-staff/password/${currentUser.value.id}`, {
      password: passwordForm.password,
    })
    showPasswordMessage('success', '密码已修改')
    closePasswordDialog()
  } catch (error) {
    showPasswordMessage('error', error.response?.data?.message || '修改密码失败')
  }
}

onMounted(async () => {
  try {
    await refreshCurrentUser()
  } catch {
    // ignore initial refresh failure and keep cached user state
  }
})
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand-block">
        <div class="brand-row">
          <img class="brand-logo" src="/favicon.jpg" alt="山澜资产" />
          <h1 class="brand-title">山澜资产</h1>
        </div>
      </div>

      <nav class="nav">
        <RouterLink v-permission="'admin'" class="nav-item" active-class="active" to="/people">人员管理</RouterLink>
        <RouterLink v-permission="'reviewer'" class="nav-item" active-class="active" to="/approval-tasks">审核管理</RouterLink>
        <RouterLink v-permission="'admin'" class="nav-item" active-class="active" to="/basic-data">基础数据维护</RouterLink>
        <RouterLink v-permission="'admin'" class="nav-item" active-class="active" to="/djl-sync-logs">数据采集日志</RouterLink>
        <RouterLink v-permission="'uploader'" class="nav-item" active-class="active" to="/fapai-houses">法拍房源</RouterLink>
        <RouterLink class="nav-item" active-class="active" to="/houses">房屋管理</RouterLink>
        <RouterLink class="nav-item" active-class="active" to="/special-assets">特殊资产</RouterLink>
      </nav>

      <div class="sidebar-actions">
        <div class="sidebar-user-card sidebar-user-card-stacked">
          <div class="sidebar-user-card-main">
            <strong class="sidebar-user-name">{{ currentUser?.name || currentUser?.phone || '未登录' }}</strong>
            <span class="sidebar-user-role">{{ currentUserRoleLabel || '-' }}</span>
          </div>
          <button
            class="sidebar-bind-btn"
            type="button"
            :disabled="bindDialogLoading || !canOpenBindDialog"
            @click="openBindDialog"
          >
            {{ bindButtonText }}
          </button>
        </div>
        <button v-permission="'reviewer'" class="logout-btn" type="button" @click="openPasswordDialog">修改密码</button>
        <button class="logout-btn" type="button" @click="logout">退出登录</button>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>

    <div v-if="passwordDialogVisible" class="modal-mask">
      <form class="card modal-card" @submit.prevent="updateCurrentPassword">
        <div class="modal-title-row">
          <h3>修改密码</h3>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closePasswordDialog">×</button>
        </div>
        <p v-if="passwordMessage.text" :class="['inline-message', passwordMessage.type]">{{ passwordMessage.text }}</p>
        <label>
          <span class="required-label">新密码</span>
          <input v-model="passwordForm.password" type="password" autocomplete="new-password" placeholder="请输入新密码" />
        </label>
        <label>
          <span class="required-label">确认密码</span>
          <input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" />
        </label>
        <div class="actions">
          <button class="primary" type="submit">保存密码</button>
          <button class="ghost" type="button" @click="closePasswordDialog">取消</button>
        </div>
      </form>
    </div>

    <div v-if="bindDialogVisible" class="modal-mask">
      <div class="card modal-card bind-modal-card">
        <div class="modal-title-row">
          <h3>去绑定</h3>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closeBindDialog">×</button>
        </div>
        <p class="modal-subtitle">请使用当前员工的微信扫一扫下方二维码，1分钟内完成绑定。</p>
        <div class="bind-qr-wrap">
          <img v-if="bindDialogState.qrCodeUrl" :src="bindDialogState.qrCodeUrl" alt="绑定二维码" class="bind-qr-image" />
          <p v-else class="empty-cell">当前没有可用绑定码，请联系管理员重新生成。</p>
        </div>
        <p v-if="bindDialogState.expiresAt" class="bind-expire-text">有效期至：{{ bindDialogState.expiresAt }}</p>
        <div class="actions">
          <button class="ghost" type="button" @click="closeBindDialog">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
