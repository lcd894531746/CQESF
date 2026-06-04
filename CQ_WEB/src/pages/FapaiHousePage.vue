<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import request from '../utils/request'

const loading = ref(false)
const exporting = ref(false)
const rows = ref([])
const districtOptions = ref([])
const pageJumpInput = ref('1')

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
})

const filters = reactive({
  title: '',
  districtId: '',
  startDate: '',
  endDate: '',
})

const message = reactive({
  type: '',
  text: '',
})

const pageSummary = computed(() => {
  if (!pagination.total) return '共 0 条'
  const start = (pagination.page - 1) * pagination.pageSize + 1
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total)
  return `${start}-${end} / 共 ${pagination.total} 条`
})

function showMessage(type, text) {
  message.type = type
  message.text = text
  window.clearTimeout(showMessage.timer)
  showMessage.timer = window.setTimeout(() => {
    message.type = ''
    message.text = ''
  }, 2500)
}

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function padDatePart(value) {
  return String(value).padStart(2, '0')
}

function formatDateLine(value) {
  const date = toDate(value)
  if (!date) return '-'
  const yyyy = date.getFullYear()
  const mm = padDatePart(date.getMonth() + 1)
  const dd = padDatePart(date.getDate())
  return `${yyyy}-${mm}-${dd}`
}

function formatTimeLine(value) {
  const date = toDate(value)
  if (!date) return ''
  const hh = padDatePart(date.getHours())
  const mi = padDatePart(date.getMinutes())
  const ss = padDatePart(date.getSeconds())
  return `${hh}:${mi}:${ss}`
}

function formatBuildYear(value) {
  const year = String(value || '').trim()
  return year ? `${year}年` : '-'
}

function buildParams(page = 1) {
  const params = {
    page,
    pageSize: pagination.pageSize,
  }

  if (String(filters.title || '').trim()) params.title = String(filters.title).trim()
  if (String(filters.districtId || '').trim()) params.districtId = String(filters.districtId).trim()
  if (String(filters.startDate || '').trim()) params.startDate = String(filters.startDate).trim()
  if (String(filters.endDate || '').trim()) params.endDate = String(filters.endDate).trim()

  return params
}

async function loadDistrictOptions() {
  const response = await request.get('/fapai-houses/district-options')
  districtOptions.value = response.data?.result?.items || []
}

async function loadRows(page = 1) {
  loading.value = true
  try {
    const response = await request.get('/fapai-houses', {
      params: buildParams(page),
    })
    const result = response.data?.result || {}
    rows.value = result.items || []
    pagination.page = result.page || page
    pagination.pageSize = result.pageSize || 20
    pagination.total = result.total || 0
    pagination.totalPages = result.totalPages || 0
    pageJumpInput.value = String(pagination.page)
  } finally {
    loading.value = false
  }
}

async function searchRows() {
  try {
    await loadRows(1)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '查询法拍房源失败')
  }
}

async function resetFilters() {
  filters.title = ''
  filters.districtId = ''
  filters.startDate = ''
  filters.endDate = ''
  await searchRows()
}

async function changePage(nextPage) {
  if (nextPage < 1 || (pagination.totalPages && nextPage > pagination.totalPages)) return
  try {
    await loadRows(nextPage)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载法拍房源失败')
  }
}

async function jumpToPage() {
  const totalPages = pagination.totalPages || 1
  const targetPage = Math.min(Math.max(parseInt(pageJumpInput.value, 10) || 1, 1), totalPages)
  pageJumpInput.value = String(targetPage)
  await changePage(targetPage)
}

async function exportAllRows() {
  exporting.value = true
  try {
    const response = await request.get('/fapai-houses/export', {
      responseType: 'blob',
      loadingText: '正在导出法拍房源...',
    })
    const blob = new Blob([response.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const fileName = decodeURIComponent(
      String(response.headers['content-disposition'] || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || '法拍房源导出.xlsx'
    )
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    showMessage('success', '导出成功')
  } catch (error) {
    showMessage('error', error.response?.data?.message || '导出法拍房源失败')
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadDistrictOptions(), loadRows()])
  } catch (error) {
    showMessage('error', error.response?.data?.message || '初始化法拍房源失败')
  }
})
</script>

<template>
  <div class="people-page house-page">
    <header class="people-header">
      <div>
        <h2>法拍房源</h2>
      </div>
      <button class="primary" type="button" :disabled="exporting" @click="exportAllRows">
        {{ exporting ? '导出中...' : '导出全部' }}
      </button>
    </header>

    <p v-if="message.text" :class="['inline-message', message.type]">{{ message.text }}</p>

    <section class="card list-card filter-card">
      <form class="filter-grid fapai-filter-grid" @submit.prevent="searchRows">
        <label>
          <span>标题</span>
          <input v-model.trim="filters.title" placeholder="请输入房源标题" />
        </label>
        <label>
          <span>区域</span>
          <select v-model="filters.districtId">
            <option value="">全部区域</option>
            <option v-for="item in districtOptions" :key="item.districtId" :value="String(item.districtId)">
              {{ item.districtName }}
            </option>
          </select>
        </label>
        <label>
          <span>上架开始时间</span>
          <input v-model="filters.startDate" type="date" />
        </label>
        <label>
          <span>上架结束时间</span>
          <input v-model="filters.endDate" type="date" />
        </label>
        <div class="filter-actions">
          <button class="primary" type="submit" :disabled="loading">查询</button>
          <button class="ghost" type="button" :disabled="loading" @click="resetFilters">重置</button>
        </div>
      </form>
    </section>

    <section class="card list-card house-list-card fapai-list-card">
      <div class="table-wrap">
        <table class="fapai-house-table">
          <colgroup>
            <col class="col-title" />
            <col class="col-district" />
            <col class="col-build-year" />
            <col class="col-decoration" />
            <col class="col-list-time" />
            <col class="col-crawl-time" />
          </colgroup>
          <thead>
            <tr>
              <th>标题</th>
              <th>区域</th>
              <th>房屋建成时间</th>
              <th>装修类型</th>
              <th>房屋上架时间</th>
              <th>采集时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in rows" :key="item.id">
              <td class="fapai-title-cell">
                <div class="fapai-title-main">{{ item.title || '-' }}</div>
              </td>
              <td class="fapai-district-cell">
                <span class="fapai-district-chip">{{ item.districtName || '-' }}</span>
              </td>
              <td class="fapai-build-cell">
                <span class="year-pill">{{ formatBuildYear(item.buildYear) }}</span>
              </td>
              <td class="fapai-decoration-cell">
                <span class="decoration-pill">{{ item.decorationText || '-' }}</span>
              </td>
              <td class="fapai-time-cell is-primary">
                <span class="time-date">{{ formatDateLine(item.createTime) }}</span>
                <span class="time-clock">{{ formatTimeLine(item.createTime) }}</span>
              </td>
              <td class="fapai-time-cell">
                <span class="time-date">{{ formatDateLine(item.createdAt) }}</span>
                <span class="time-clock">{{ formatTimeLine(item.createdAt) }}</span>
              </td>
            </tr>
            <tr v-if="!loading && rows.length === 0">
              <td colspan="6" class="empty-cell">暂无法拍房源</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager">
        <span class="house-pager-summary">{{ pageSummary }}</span>
        <button class="ghost" type="button" :disabled="loading || pagination.page <= 1" @click="changePage(pagination.page - 1)">
          上一页
        </button>
        <span>第 {{ pagination.page }} / {{ pagination.totalPages || 1 }} 页</span>
        <button
          class="ghost"
          type="button"
          :disabled="loading || pagination.page >= (pagination.totalPages || 1)"
          @click="changePage(pagination.page + 1)"
        >
          下一页
        </button>
        <form class="pager-jump" @submit.prevent="jumpToPage">
          <span>跳至</span>
          <input
            v-model="pageJumpInput"
            type="number"
            min="1"
            :max="pagination.totalPages || 1"
            :disabled="loading"
          />
          <span>页</span>
          <button class="ghost" type="submit" :disabled="loading">跳转</button>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fapai-filter-grid {
  grid-template-columns:
    minmax(260px, 1.4fr)
    minmax(180px, 0.9fr)
    minmax(190px, 1fr)
    minmax(190px, 1fr)
    auto;
}

.fapai-filter-grid .filter-actions {
  justify-self: end;
  align-self: end;
}

.fapai-list-card {
  padding-top: 12px;
}

.fapai-house-table {
  min-width: 1200px;
}

.fapai-house-table .col-title {
  width: 36%;
}

.fapai-house-table .col-district {
  width: 12%;
}

.fapai-house-table .col-build-year {
  width: 12%;
}

.fapai-house-table .col-decoration {
  width: 12%;
}

.fapai-house-table .col-list-time {
  width: 14%;
}

.fapai-house-table .col-crawl-time {
  width: 14%;
}

.fapai-house-table thead th {
  font-size: 13px;
  letter-spacing: 0.02em;
}

.fapai-house-table th,
.fapai-house-table td {
  text-align: left;
}

.fapai-title-cell {
  min-width: 420px;
  padding-right: 20px;
}

.fapai-title-main {
  font-size: 16px;
  line-height: 1.45;
  color: #1f2430;
  word-break: break-word;
}

.fapai-district-cell,
.fapai-build-cell,
.fapai-decoration-cell {
  white-space: nowrap;
}

.fapai-district-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f7ecda;
  color: #8f5f15;
  font-size: 12px;
  font-weight: 600;
}

.year-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #f3eee4;
  color: #4b4f5d;
  font-weight: 600;
}

.decoration-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #e8f1ec;
  color: #2f6b49;
  font-weight: 600;
}

.fapai-time-cell {
  min-width: 170px;
  white-space: nowrap;
}

.time-date,
.time-clock {
  display: block;
}

.time-date {
  color: #1f2430;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.time-clock {
  margin-top: 3px;
  color: #7b8090;
  font-size: 12px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.fapai-time-cell.is-primary .time-date {
  color: #9c6511;
}

.fapai-time-cell.is-primary .time-clock {
  color: #b27a22;
}

@media (max-width: 1280px) {
  .fapai-filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fapai-filter-grid .filter-actions {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (max-width: 720px) {
  .fapai-toolbar {
    padding: 12px 14px;
  }

  .fapai-filter-grid {
    grid-template-columns: 1fr;
  }

  .fapai-title-cell {
    min-width: 300px;
  }

  .fapai-time-cell {
    min-width: 148px;
  }
}
</style>
