<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import request from '../utils/request'

const loading = ref(false)
const logs = ref([])
const pageJumpInput = ref('1')
const pagination = reactive({
  page: 1,
  pageSize: 100,
  total: 0,
  totalPages: 0,
})

const filters = reactive({
  status: '',
})

const message = reactive({
  type: '',
  text: '',
})

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '运行中', value: 'running' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed' },
]

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

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function formatStatusLabel(status) {
  if (status === 'running') return '运行中'
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'pending') return '待执行'
  return status || '-'
}

function formatStatusClass(status) {
  if (status === 'running' || status === 'pending') return 'status-pending'
  if (status === 'success') return 'status-approved'
  if (status === 'failed') return 'status-rejected'
  return ''
}

function formatTaskType(taskType) {
  if (taskType === 'full_sync') return '全量采集入库'
  if (taskType === 'fapai_sync') return '法拍房源采集'
  return taskType || '-'
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt) return '-'
  const start = new Date(startedAt)
  if (Number.isNaN(start.getTime())) return '-'
  const end = finishedAt ? new Date(finishedAt) : new Date()
  if (Number.isNaN(end.getTime())) return '-'
  const diffMs = Math.max(end.getTime() - start.getTime(), 0)
  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}小时 ${minutes}分 ${seconds}秒`
  if (minutes > 0) return `${minutes}分 ${seconds}秒`
  return `${seconds}秒`
}

function buildParams(page = 1) {
  const params = {
    page,
    pageSize: pagination.pageSize,
  }
  if (filters.status) params.status = filters.status
  return params
}

function getSummaryValue(summary, key) {
  if (!summary || typeof summary !== 'object') return 0
  const value = Number(summary[key] || 0)
  return Number.isFinite(value) ? value : 0
}

function buildSummaryText(task) {
  const summary = task?.summary
  if (!summary || typeof summary !== 'object') return '-'

  if (task?.taskType === 'fapai_sync' || summary.task_type === 'fapai_sync') {
    const houseCount = getSummaryValue(summary, 'written_rows')
      || getSummaryValue(summary, 'normalized_rows')
      || getSummaryValue(summary, 'fetched_rows')
      || getSummaryValue(summary, 'total')
    return `房源 ${houseCount} 条`
  }

  const districts = getSummaryValue(summary, 'districtCount')
  const subAreas = getSummaryValue(summary, 'subAreaCount')
  const communities = getSummaryValue(summary, 'communityCount') || getSummaryValue(summary, 'mergedCommunityCount')
  const houses = getSummaryValue(summary, 'houseCount') || getSummaryValue(summary, 'insertedHouseCount')
  return `行政区 ${districts} / 商圈 ${subAreas} / 小区 ${communities} / 房源 ${houses}`
}

function getRowNumber(index) {
  return (pagination.page - 1) * pagination.pageSize + index + 1
}

async function loadLogs(page = 1) {
  loading.value = true
  try {
    const response = await request.get('/djl/sync/tasks', {
      params: buildParams(page),
    })
    const result = response.data?.result || {}
    logs.value = result.items || []
    pagination.page = result.page || page
    pagination.pageSize = result.pageSize || 100
    pagination.total = result.total || 0
    pagination.totalPages = result.totalPages || 0
    pageJumpInput.value = String(pagination.page)
  } finally {
    loading.value = false
  }
}

async function searchLogs() {
  try {
    await loadLogs(1)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载采集日志失败')
  }
}

async function resetFilters() {
  filters.status = ''
  await searchLogs()
}

async function changePage(nextPage) {
  if (nextPage < 1 || (pagination.totalPages && nextPage > pagination.totalPages)) return
  try {
    await loadLogs(nextPage)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载采集日志失败')
  }
}

async function jumpToPage() {
  const totalPages = pagination.totalPages || 1
  const targetPage = Math.min(Math.max(parseInt(pageJumpInput.value, 10) || 1, 1), totalPages)
  pageJumpInput.value = String(targetPage)
  await changePage(targetPage)
}

onMounted(async () => {
  try {
    await loadLogs()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '初始化采集日志失败，请确认后端已启动')
  }
})
</script>

<template>
  <div class="people-page djl-sync-page">
    <header class="people-header">
      <div>
        <h2>数据采集日志</h2>
      </div>
    </header>

    <p v-if="message.text" :class="['inline-message', message.type]">{{ message.text }}</p>

    <section class="card list-card filter-card">
      <form class="filter-grid sync-log-filter-grid" @submit.prevent="searchLogs">
        <label>
          <span>状态</span>
          <select v-model="filters.status">
            <option v-for="option in statusOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <div class="filter-actions">
          <button class="primary" type="submit" :disabled="loading">查询</button>
          <button class="ghost" type="button" :disabled="loading" @click="resetFilters">重置</button>
        </div>
      </form>
    </section>

    <section class="card list-card house-list-card">
      <div class="table-wrap">
        <table class="sync-log-table">
          <colgroup>
            <col class="col-id" />
            <col class="col-task-type" />
            <col class="col-status" />
            <col class="col-trigger-by" />
            <col class="col-started-at" />
            <col class="col-finished-at" />
            <col class="col-duration" />
            <col class="col-summary" />
            <col class="col-error" />
          </colgroup>
          <thead>
            <tr>
              <th>序号</th>
              <th>任务类型</th>
              <th>状态</th>
              <th>触发人</th>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>耗时</th>
              <th>采集结果</th>
              <th>错误信息</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in logs" :key="item.id">
              <td>{{ getRowNumber(index) }}</td>
              <td>{{ formatTaskType(item.taskType) }}</td>
              <td>
                <span :class="['status-chip', formatStatusClass(item.status)]">
                  {{ formatStatusLabel(item.status) }}
                </span>
              </td>
              <td>{{ item.triggerByName || '-' }}</td>
              <td>{{ formatDateTime(item.startedAt) }}</td>
              <td>{{ formatDateTime(item.finishedAt) }}</td>
              <td>{{ formatDuration(item.startedAt, item.finishedAt) }}</td>
              <td class="sync-summary-cell">{{ buildSummaryText(item) }}</td>
              <td class="error-cell sync-error-cell">{{ item.errorMessage || '-' }}</td>
            </tr>
            <tr v-if="!loading && logs.length === 0">
              <td colspan="9" class="empty-cell">暂无采集日志</td>
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
.sync-log-filter-grid {
  grid-template-columns: minmax(180px, 240px) auto;
}

.sync-log-filter-grid .filter-actions {
  justify-self: end;
}

.sync-log-table {
  min-width: 1400px;
  table-layout: fixed;
}

.sync-log-table .col-id {
  width: 70px;
}

.sync-log-table .col-task-type {
  width: 140px;
}

.sync-log-table .col-status {
  width: 90px;
}

.sync-log-table .col-trigger-by {
  width: 110px;
}

.sync-log-table .col-started-at {
  width: 170px;
}

.sync-log-table .col-finished-at {
  width: 170px;
}

.sync-log-table .col-duration {
  width: 110px;
}

.sync-log-table .col-summary {
  width: 280px;
}

.sync-log-table .col-error {
  width: 420px;
}

.sync-summary-cell {
  text-align: left;
  color: #3c4556;
  white-space: normal;
  word-break: break-word;
}

.sync-error-cell {
  white-space: normal;
  word-break: break-all;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .sync-log-filter-grid {
    grid-template-columns: 1fr;
  }

  .sync-log-filter-grid .filter-actions {
    justify-self: start;
  }
}
</style>
