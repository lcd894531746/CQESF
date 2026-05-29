<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { isAdmin } from '../constants/auth'
import request from '../utils/request'

const loading = ref(false)
const saving = ref(false)
const message = reactive({
  type: '',
  text: '',
})
const form = reactive({
  min_house_price: '0',
  max_house_price: '150',
  interest_rate: '3.15',
})

const priceRangeText = computed(() => {
  const minPrice = Number(form.min_house_price || 0)
  const maxPrice = Number(form.max_house_price || 0)
  return `${minPrice} - ${maxPrice} 万`
})

const interestRateText = computed(() => `${Number(form.interest_rate || 0).toFixed(2)}%`)

function showMessage(type, text) {
  message.type = type
  message.text = text
  window.clearTimeout(showMessage.timer)
  showMessage.timer = window.setTimeout(() => {
    message.type = ''
    message.text = ''
  }, 2500)
}

function fillForm(settings = {}) {
  form.min_house_price = String(settings.min_house_price ?? 0)
  form.max_house_price = String(settings.max_house_price ?? 150)
  form.interest_rate = String(settings.interest_rate ?? 3.15)
}

function buildPayload() {
  return {
    min_house_price: Number(form.min_house_price),
    max_house_price: Number(form.max_house_price),
    interest_rate: Number(form.interest_rate),
  }
}

function validatePayload(payload) {
  if (
    Number.isNaN(payload.min_house_price) ||
    Number.isNaN(payload.max_house_price) ||
    Number.isNaN(payload.interest_rate)
  ) {
    return '房屋价格范围和利率必须是数字'
  }

  if (payload.min_house_price < 0 || payload.max_house_price < 0 || payload.interest_rate < 0) {
    return '房屋价格范围和利率不能小于 0'
  }

  if (payload.min_house_price > payload.max_house_price) {
    return '最低房屋价格不能大于最高房屋价格'
  }

  return ''
}

async function loadSettings() {
  loading.value = true
  try {
    const response = await request.get('/basic-settings')
    fillForm(response.data.data)
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (!isAdmin()) {
    showMessage('error', '暂无操作权限')
    return
  }

  const payload = buildPayload()
  const validationMessage = validatePayload(payload)
  if (validationMessage) {
    showMessage('error', validationMessage)
    return
  }

  saving.value = true
  try {
    const response = await request.put('/basic-settings', payload)
    fillForm(response.data.data)
    showMessage('success', response.data.message || '基础数据已保存')
  } catch (error) {
    showMessage('error', error.response?.data?.message || '保存基础数据失败')
  } finally {
    saving.value = false
  }
}

function resetDefaults() {
  if (!isAdmin()) {
    showMessage('error', '暂无操作权限')
    return
  }

  fillForm()
}

onMounted(async () => {
  try {
    await loadSettings()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '初始化失败，请确认后端和数据库已启动')
  }
})
</script>

<template>
  <div class="people-page basic-data-page">
    <header class="people-header">
      <div>
        <h2>业务参数</h2>
      </div>
    </header>

    <p v-if="message.text" :class="['inline-message', message.type]">{{ message.text }}</p>

    <section class="card basic-data-card">
      <form class="basic-form" @submit.prevent="saveSettings">
        <div class="field-group">
          <div>
            <h3>房屋价格范围</h3>
            <p class="field-hint">单位：万元</p>
          </div>
          <div class="range-fields">
            <label>
              <span class="required-label">最低价格</span>
              <input v-model.trim="form.min_house_price" inputmode="decimal" placeholder="0" />
            </label>
            <label>
              <span class="required-label">最高价格</span>
              <input v-model.trim="form.max_house_price" inputmode="decimal" placeholder="150" />
            </label>
          </div>
          <p class="summary-line">当前范围：{{ priceRangeText }}</p>
        </div>

        <div class="field-group">
          <div>
            <h3>利率</h3>
            <p class="field-hint">单位：%</p>
          </div>
          <label class="single-field">
            <span class="required-label">利率</span>
            <input v-model.trim="form.interest_rate" inputmode="decimal" placeholder="3.15" />
          </label>
          <p class="summary-line">当前利率：{{ interestRateText }}</p>
        </div>

        <div class="actions">
          <button v-permission="'admin'" class="primary" type="submit" :disabled="loading || saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button v-permission="'admin'" class="ghost" type="button" :disabled="loading || saving" @click="resetDefaults">恢复默认</button>
        </div>
      </form>
    </section>
  </div>
</template>
