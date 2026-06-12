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

const defaultFormState = {
  min_house_price: '0',
  max_house_price: '150',
  interest_rate: '3.15',
  fapai_intro: '',
  low_down_payment_intro: '',
  fapai_auctioning_label: '正在拍卖',
  fapai_coming_label: '即将拍卖',
  mini_program_access_mode: 'strict',
}

const form = reactive({
  ...defaultFormState,
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
  form.min_house_price = String(settings.min_house_price ?? defaultFormState.min_house_price)
  form.max_house_price = String(settings.max_house_price ?? defaultFormState.max_house_price)
  form.interest_rate = String(settings.interest_rate ?? defaultFormState.interest_rate)
  form.fapai_intro = String(settings.fapai_intro ?? defaultFormState.fapai_intro)
  form.low_down_payment_intro = String(settings.low_down_payment_intro ?? defaultFormState.low_down_payment_intro)
  form.fapai_auctioning_label = String(settings.fapai_auctioning_label ?? defaultFormState.fapai_auctioning_label)
  form.fapai_coming_label = String(settings.fapai_coming_label ?? defaultFormState.fapai_coming_label)
  form.mini_program_access_mode = String(settings.mini_program_access_mode ?? defaultFormState.mini_program_access_mode)
}

function buildPayload() {
  return {
    min_house_price: Number(form.min_house_price),
    max_house_price: Number(form.max_house_price),
    interest_rate: Number(form.interest_rate),
    fapai_intro: form.fapai_intro.trim(),
    low_down_payment_intro: form.low_down_payment_intro.trim(),
    fapai_auctioning_label: form.fapai_auctioning_label.trim() || defaultFormState.fapai_auctioning_label,
    fapai_coming_label: form.fapai_coming_label.trim() || defaultFormState.fapai_coming_label,
    mini_program_access_mode: String(form.mini_program_access_mode || 'strict').trim().toLowerCase() === 'public' ? 'public' : 'strict',
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

  if (!['strict', 'public'].includes(String(payload.mini_program_access_mode || ''))) {
    return '小程序访问模式配置不正确'
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
        <div class="basic-form-body">
          <div class="field-group compact-field-group">
            <div>
              <h3>房屋价格范围与利率</h3>
              <p class="field-hint">房屋价格单位：万元，利率单位：%</p>
            </div>
            <div class="triple-fields">
              <label>
                <span class="required-label">最低价格</span>
                <input v-model.trim="form.min_house_price" inputmode="decimal" placeholder="0" />
              </label>
              <label>
                <span class="required-label">最高价格</span>
                <input v-model.trim="form.max_house_price" inputmode="decimal" placeholder="150" />
              </label>
              <label>
                <span class="required-label">利率</span>
                <input v-model.trim="form.interest_rate" inputmode="decimal" placeholder="3.15" />
              </label>
            </div>
            <div class="summary-pair">
              <p class="summary-line">当前范围：{{ priceRangeText }}</p>
              <p class="summary-line">当前利率：{{ interestRateText }}</p>
            </div>
          </div>

          <div class="field-group compact-field-group">
            <div>
              <h3>小程序访问模式</h3>
              <p class="field-hint">`strict` 需要手机号或销售分享；`public` 公开展示正式内容，适合提审期间使用。</p>
            </div>
            <div class="mode-options">
              <label class="mode-option">
                <input v-model="form.mini_program_access_mode" type="radio" value="strict" />
                <span>严格模式</span>
              </label>
              <label class="mode-option">
                <input v-model="form.mini_program_access_mode" type="radio" value="public" />
                <span>公开浏览模式</span>
              </label>
            </div>
          </div>

          <div class="field-group compact-field-group">
            <div>
              <h3>法拍房统计文案</h3>
              <p class="field-hint">用于小程序首页法拍房统计卡片标题展示。</p>
            </div>
            <div class="double-fields">
              <label>
                <span class="required-label">正在拍卖文案</span>
                <input v-model.trim="form.fapai_auctioning_label" maxlength="50" placeholder="正在拍卖" />
              </label>
              <label>
                <span class="required-label">即将拍卖文案</span>
                <input v-model.trim="form.fapai_coming_label" maxlength="50" placeholder="即将拍卖" />
              </label>
            </div>
          </div>

          <div class="intro-grid">
            <div class="field-group intro-field-group">
              <h3>法拍房简介</h3>
              <label class="intro-field">
                <textarea
                  v-model.trim="form.fapai_intro"
                  rows="4"
                  placeholder="请输入法拍房简介"
                ></textarea>
              </label>
            </div>

            <div class="field-group intro-field-group">
              <h3>低首付简介</h3>
              <label class="intro-field">
                <textarea
                  v-model.trim="form.low_down_payment_intro"
                  rows="4"
                  placeholder="请输入低首付简介"
                ></textarea>
              </label>
            </div>
          </div>
        </div>

        <div class="actions basic-form-actions">
          <button v-permission="'admin'" class="primary" type="submit" :disabled="loading || saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button
            v-permission="'admin'"
            class="ghost"
            type="button"
            :disabled="loading || saving"
            @click="resetDefaults"
          >
            恢复默认
          </button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.mode-options {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.mode-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #1f2937;
  font-size: 14px;
}

.mode-option input {
  margin: 0;
}

.double-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.double-fields label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 768px) {
  .double-fields {
    grid-template-columns: 1fr;
  }
}
</style>
