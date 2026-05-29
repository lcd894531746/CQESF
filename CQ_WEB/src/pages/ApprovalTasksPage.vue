<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import noImg from '../assets/noImg.png'
import request from '../utils/request'

const loading = ref(false)
const detailLoading = ref(false)
const processingId = ref(0)
const tasks = ref([])
const pageJumpInput = ref('1')
const detailDialogVisible = ref(false)
const activeTask = ref(null)
const previewImage = ref('')

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
})

const filters = reactive({
  status: '',
  title: '',
  createdByName: '',
  createdAtFrom: '',
  createdAtTo: '',
})

const message = reactive({
  type: '',
  text: '',
})

const statusOptions = [
  { label: '全部', value: '' },
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' },
]

const visibleTasks = computed(() => tasks.value || [])

const pageSummary = computed(() => {
  if (!pagination.total) return '共 0 条'
  const start = (pagination.page - 1) * pagination.pageSize + 1
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total)
  return `${start}-${end} / 共 ${pagination.total} 条`
})

const activeTaskReviewState = computed(() => buildTaskReviewState(activeTask.value))
const activeTaskReviewCreatedAtText = computed(() => {
  const raw = activeTask.value?.createdAt
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN', { hour12: false })
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
  if (Number.isNaN(date.getTime())) return '-'
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function getStatusLabel(status) {
  if (status === 'pending') return '待审核'
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '已驳回'
  return status || '-'
}

function getStatusClass(status) {
  if (status === 'pending') return 'status-pending'
  if (status === 'approved') return 'status-approved'
  if (status === 'rejected') return 'status-rejected'
  return ''
}

function normalizeTaskImage(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/')) return raw
  if (raw.startsWith('uploads/')) return `/${raw}`
  return raw
}

function getReviewSummary(task) {
  if (Array.isArray(task?.reviewDetails?.summaryTags) && task.reviewDetails.summaryTags.length > 0) {
    return task.reviewDetails.summaryTags
  }
  if (task?.summary) return [task.summary]
  return []
}

function getReviewSummaryText(task) {
  const summary = getReviewSummary(task)
  return summary.length ? summary.join('、') : '暂无详细内容'
}

function shouldShowDetailButton(task) {
  return task?.actionType !== 'bk_house_delete'
}

function buildTaskReviewState(task) {
  const emptyState = {
    effectivePosterPreview: '',
    effectiveGalleryPreview: [],
    reviewPosterItems: [],
    reviewGalleryPreview: [],
  }
  if (!task) return emptyState

  const fromApi = task.reviewImageState
  if (fromApi) {
    return {
      effectivePosterPreview: normalizeTaskImage(fromApi.effectivePosterPreview || ''),
      effectiveGalleryPreview: (fromApi.effectiveGalleryPreview || []).map(normalizeTaskImage).filter(Boolean),
      reviewPosterItems: (fromApi.reviewPosterItems || []).map((item) => ({
        key: item.key,
        image: normalizeTaskImage(item.image || ''),
        type: item.type,
      })),
      reviewGalleryPreview: (fromApi.reviewGalleryPreview || []).map((item) => ({
        key: item.key,
        image: normalizeTaskImage(item.image || ''),
        type: item.type,
      })),
    }
  }

  const payload = task.payload || {}
  const reviewPosterItems = []
  const posterImage = normalizeTaskImage(payload.posterImageUrl || payload.posterFileName || '')
  if (posterImage) {
    reviewPosterItems.push({
      key: `fallback-poster-${posterImage}`,
      image: posterImage,
      type: 'added',
    })
  } else if (payload.posterRemoved) {
    reviewPosterItems.push({
      key: 'fallback-poster-deleted',
      image: '',
      type: 'deleted',
    })
  }

  const reviewGalleryPreview = Array.isArray(payload.galleryImageUrls)
    ? payload.galleryImageUrls
        .map((item, index) => ({
          key: `fallback-gallery-${index}-${item}`,
          image: normalizeTaskImage(item),
          type: 'added',
        }))
        .filter((item) => item.image)
    : []

  return {
    effectivePosterPreview: '',
    effectiveGalleryPreview: [],
    reviewPosterItems,
    reviewGalleryPreview,
  }
}

function hasReviewChanges(state) {
  return Boolean(state.reviewPosterItems.length || state.reviewGalleryPreview.length)
}

function buildParams(page = 1) {
  const params = {
    page,
    pageSize: pagination.pageSize,
  }
  Object.entries(filters).forEach(([key, value]) => {
    const trimmedValue = String(value || '').trim()
    if (trimmedValue) {
      params[key] = trimmedValue
    }
  })
  return params
}

async function loadTasks(page = 1) {
  loading.value = true
  try {
    const response = await request.get('/approval-tasks', {
      params: buildParams(page),
    })
    const result = response.data?.result || {}
    tasks.value = result.items || []
    pagination.page = result.page || page
    pagination.pageSize = result.pageSize || 20
    pagination.total = result.total || 0
    pagination.totalPages = result.totalPages || 0
    pageJumpInput.value = String(pagination.page)
  } finally {
    loading.value = false
  }
}

async function searchTasks() {
  try {
    await loadTasks(1)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载审核任务失败')
  }
}

async function resetFilters() {
  filters.status = ''
  filters.title = ''
  filters.createdByName = ''
  filters.createdAtFrom = ''
  filters.createdAtTo = ''
  await searchTasks()
}

async function changePage(nextPage) {
  if (nextPage < 1 || (pagination.totalPages && nextPage > pagination.totalPages)) {
    return
  }

  try {
    await loadTasks(nextPage)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载审核任务失败')
  }
}

async function jumpToPage() {
  const totalPages = pagination.totalPages || 1
  const targetPage = Math.min(Math.max(parseInt(pageJumpInput.value, 10) || 1, 1), totalPages)
  pageJumpInput.value = String(targetPage)
  await changePage(targetPage)
}

async function reviewTask(task, action) {
  if (!task?.id || processingId.value) return
  processingId.value = task.id
  try {
    const response = await request.post(`/approval-tasks/${task.id}/${action}`, {
      reviewNote: '',
    })
    showMessage('success', response.data?.message || (action === 'approve' ? '审核已通过' : '审核已驳回'))
    await loadTasks(pagination.page)
    if (activeTask.value?.id === task.id) {
      const currentTask = tasks.value.find((item) => item.id === task.id) || null
      if (!currentTask) {
        closeDetailDialog()
      } else {
        activeTask.value = currentTask
        if (shouldShowDetailButton(currentTask)) {
          await loadTaskDetail(currentTask.id)
        }
      }
    }
  } catch (error) {
    showMessage('error', error.response?.data?.message || '处理审核任务失败')
  } finally {
    processingId.value = 0
  }
}

function rowIndex(index) {
  return (pagination.page - 1) * pagination.pageSize + index + 1
}

async function loadTaskDetail(taskId) {
  if (!taskId) return
  detailLoading.value = true
  try {
    const response = await request.get(`/approval-tasks/${taskId}`, {
      showLoading: false,
    })
    activeTask.value = response.data?.data || activeTask.value
  } finally {
    detailLoading.value = false
  }
}

async function openDetailDialog(task) {
  activeTask.value = task
  detailDialogVisible.value = true
  try {
    await loadTaskDetail(task.id)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载审核详情失败')
  }
}

function closeDetailDialog() {
  detailDialogVisible.value = false
  detailLoading.value = false
  activeTask.value = null
}

function openImagePreview(image) {
  if (!image) return
  previewImage.value = image
}

function closeImagePreview() {
  previewImage.value = ''
}

onMounted(async () => {
  try {
    await loadTasks()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载审核任务失败')
  }
})
</script>

<template>
  <div class="people-page">
    <header class="people-header">
      <div>
        <h2>审核任务</h2>
      </div>
    </header>

    <p v-if="message.text" :class="['inline-message', message.type]">{{ message.text }}</p>

    <section class="card list-card filter-card">
      <form class="filter-grid approval-filter-grid" @submit.prevent="searchTasks">
        <label>
          <span>状态</span>
          <select v-model="filters.status">
            <option v-for="option in statusOptions" :key="option.value || 'all'" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>标题</span>
          <input v-model.trim="filters.title" placeholder="输入数据标题关键词" />
        </label>
        <label>
          <span>发起人</span>
          <input v-model.trim="filters.createdByName" placeholder="输入姓名或手机号" />
        </label>
        <label>
          <span>申请开始时间</span>
          <input v-model="filters.createdAtFrom" type="date" />
        </label>
        <label>
          <span>申请结束时间</span>
          <input v-model="filters.createdAtTo" type="date" />
        </label>
        <div class="filter-actions">
          <button class="primary" type="submit" :disabled="loading">查询</button>
          <button class="ghost" type="button" :disabled="loading" @click="resetFilters">重置</button>
        </div>
      </form>
    </section>

    <section class="card list-card people-list-card">
      <div class="table-wrap">
        <table class="approval-task-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>数据标题</th>
              <th>审核类型</th>
              <th>审核内容</th>
              <th>发起人</th>
              <th>发起账号</th>
              <th>状态</th>
              <th>申请时间</th>
              <th>审核账号</th>
              <th>审核时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(task, index) in visibleTasks" :key="task.id">
              <td>{{ rowIndex(index) }}</td>
              <td>{{ task.targetTitle || '-' }}</td>
              <td>{{ task.actionTypeLabel || '-' }}</td>
              <td class="approval-summary-cell">
                <div class="approval-summary-text" :title="getReviewSummaryText(task)">
                  {{ getReviewSummaryText(task) }}
                </div>
                <button v-if="shouldShowDetailButton(task)" class="link-btn" type="button" @click="openDetailDialog(task)">查看详情</button>
              </td>
              <td>{{ task.createdByName || '-' }}</td>
              <td>{{ task.createdByPhone || '-' }}</td>
              <td>
                <span :class="['status-chip', getStatusClass(task.status)]">
                  {{ getStatusLabel(task.status) }}
                </span>
              </td>
              <td>{{ formatDateTime(task.createdAt) }}</td>
              <td>{{ task.reviewedByPhone || '-' }}</td>
              <td>{{ formatDateTime(task.reviewedAt) }}</td>
              <td class="inline-actions">
                <template v-if="task.status === 'pending'">
                  <button class="mini" type="button" :disabled="processingId === task.id" @click="reviewTask(task, 'approve')">通过</button>
                  <button class="mini danger" type="button" :disabled="processingId === task.id" @click="reviewTask(task, 'reject')">驳回</button>
                </template>
                <span v-else></span>
              </td>
            </tr>
            <tr v-if="!loading && visibleTasks.length === 0">
              <td colspan="11" class="empty-cell">暂无审核任务</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager">
        <span class="approval-pager-summary">{{ pageSummary }}</span>
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

    <div v-if="detailDialogVisible && activeTask" class="modal-mask">
      <div class="card modal-card image-modal-card approval-image-modal-card">
        <div class="image-modal-header">
          <div>
            <h3>审核房源图片</h3>
            <p class="modal-subtitle">{{ activeTask.targetTitle || '-' }} · {{ activeTask.actionTypeLabel || '-' }}</p>
          </div>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closeDetailDialog">×</button>
        </div>

        <div class="image-modal-body">
          <div v-if="detailLoading" class="approval-detail-loading">
            <span class="approval-detail-loading-spinner"></span>
            <span>加载审核详情中...</span>
          </div>
          <div class="image-modal-layout">
            <div class="image-modal-main">
              <div class="image-field cover-edit-field">
                <div class="image-field-head">
                  <span>当前生效封面</span>
                </div>
                <div class="upload-preview single-preview removable-preview cover-preview-box">
                  <img
                    v-if="activeTaskReviewState.effectivePosterPreview"
                    class="clickable-image"
                    :src="activeTaskReviewState.effectivePosterPreview"
                    alt="封面预览"
                    @click="openImagePreview(activeTaskReviewState.effectivePosterPreview)"
                  />
                  <img v-else class="large-placeholder placeholder-image" :src="noImg" alt="暂无封面" />
                </div>
              </div>

              <div class="image-modal-gallery-section current-gallery-section">
                <div class="image-field gallery-field">
                  <div class="image-field-head gallery-field-head">
                    <span>生效图片集合</span>
                    <span class="file-picker-meta">
                      {{ activeTaskReviewState.effectiveGalleryPreview.length > 0 ? `共 ${activeTaskReviewState.effectiveGalleryPreview.length} 张` : '暂无图片' }}
                    </span>
                  </div>
                </div>
                <div class="gallery-preview image-modal-gallery-preview">
                  <div
                    v-for="(image, index) in activeTaskReviewState.effectiveGalleryPreview"
                    :key="`${image}-${index}`"
                    class="gallery-preview-item"
                  >
                    <img class="clickable-image" :src="image" alt="图片预览" @click="openImagePreview(image)" />
                  </div>
                  <span v-if="activeTaskReviewState.effectiveGalleryPreview.length === 0" class="gallery-empty">暂无图片</span>
                </div>
              </div>
            </div>

            <aside class="image-modal-aside">
              <div class="pending-review-block review-cover-block">
                <div class="image-field-head pending-review-head">
                  <span>封面审核</span>
                  <em v-if="activeTaskReviewCreatedAtText">提交时间：{{ activeTaskReviewCreatedAtText }}</em>
                </div>
                <div v-if="activeTaskReviewState.reviewPosterItems.length > 0" class="review-cover-preview-list">
                  <div
                    v-for="item in activeTaskReviewState.reviewPosterItems"
                    :key="item.key"
                    class="upload-preview single-preview readonly-preview removable-preview review-cover-preview"
                  >
                    <span class="review-cover-type-badge">
                      {{ item.type === 'deleted' ? '待删除' : '待上传' }}
                    </span>
                    <img
                      v-if="item.image"
                      class="clickable-image"
                      :src="item.image"
                      :alt="item.type === 'deleted' ? '待删除封面' : '待上传封面'"
                      @click="openImagePreview(item.image)"
                    />
                    <img v-else class="large-placeholder placeholder-image" :src="noImg" alt="暂无封面" />
                  </div>
                </div>
                <div v-else class="review-empty-state review-empty-state-compact">
                  <div class="review-empty-icon">审</div>
                  <div class="review-empty-copy">
                    <strong>当前没有封面审核</strong>
                    <span>审核中的封面会显示在这里。</span>
                  </div>
                </div>
              </div>

              <div class="pending-review-block review-gallery-block">
                <div class="image-field-head pending-review-head">
                  <span>图片集合审核</span>
                  <em v-if="activeTaskReviewCreatedAtText">提交时间：{{ activeTaskReviewCreatedAtText }}</em>
                </div>
                <template v-if="activeTaskReviewState.reviewGalleryPreview.length > 0">
                  <div class="image-field gallery-field">
                    <div class="image-field-head gallery-field-head">
                      <span>审核中的图片集合</span>
                      <span class="file-picker-meta">共 {{ activeTaskReviewState.reviewGalleryPreview.length }} 张</span>
                    </div>
                  </div>
                  <div class="gallery-preview review-gallery-preview">
                    <div v-for="item in activeTaskReviewState.reviewGalleryPreview" :key="item.key" class="gallery-preview-item">
                      <img class="clickable-image" :src="item.image" alt="待审核图片预览" @click="openImagePreview(item.image)" />
                    </div>
                  </div>
                </template>
                <div v-else class="review-empty-state">
                  <div class="review-empty-icon">审</div>
                  <div class="review-empty-copy">
                    <strong>当前没有图片集合审核</strong>
                    <span>审核中的图片集合会显示在这里。</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>

    <div v-if="previewImage" class="image-preview-mask">
      <button class="preview-close" type="button" @click="closeImagePreview">关闭</button>
      <img class="image-preview-large" :src="previewImage" alt="大图预览" />
    </div>
  </div>
</template>

<style scoped>
.approval-filter-grid {
  display: grid;
  grid-template-columns: 1.1fr 1.1fr 1.1fr 1fr 1fr auto;
  gap: 16px;
  align-items: end;
}

.approval-filter-grid label {
  margin-bottom: 0;
}

.approval-filter-grid .filter-actions {
  align-self: end;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.approval-pager-summary {
  color: #4b4f5d;
  white-space: nowrap;
}

.approval-task-table th:nth-child(4),
.approval-task-table td:nth-child(4) {
  min-width: 220px;
  width: 220px;
}

.approval-summary-cell {
  vertical-align: middle;
}

.approval-summary-text {
  display: -webkit-box;
  overflow: hidden;
  color: #5a5e6e;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.link-btn {
  margin-top: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: #c17a08;
  font-size: 13px;
  font-weight: 600;
}

.review-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.review-status-badge.pending {
  color: #9a6700;
  background: #fff4d6;
}

.review-status-badge.done {
  color: #0f6b46;
  background: #dcfce7;
}

.review-status-badge.rejected {
  color: #b42318;
  background: #fee4e2;
}

.approval-task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  padding: 0 34px 18px;
  border-bottom: 1px solid #eee4d4;
  color: #5a5e6e;
}

.approval-image-modal-card {
  width: min(1480px, calc(100vw - 48px));
}

.approval-detail-loading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  color: #7b5b26;
  font-size: 14px;
}

.approval-detail-loading-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(193, 122, 8, 0.2);
  border-top-color: #c17a08;
  animation: approval-spin 0.8s linear infinite;
}

.pending-review-block {
  min-height: 0;
  padding: 18px;
  border: 1px solid #f0d48a;
  border-radius: 18px;
  background: #fffaf0;
}

.pending-review-head {
  margin-bottom: 14px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.image-modal-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 24px;
  align-items: start;
}

.image-modal-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.image-modal-aside {
  align-self: start;
  min-width: 320px;
  max-width: 420px;
  width: 100%;
  padding-left: 24px;
  border-left: 1px solid #eadfce;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.cover-edit-field {
  max-width: none;
}

.cover-preview-box,
.review-cover-preview {
  width: min(100%, 340px);
  margin-bottom: 12px;
}

.cover-preview-box img,
.cover-preview-box .large-placeholder,
.review-cover-preview img,
.review-cover-preview .large-placeholder {
  width: 100%;
  aspect-ratio: 1 / 1;
  height: auto;
  min-height: 0;
  border-radius: 18px;
}

.image-modal-gallery-preview {
  margin-top: 10px;
  grid-template-columns: repeat(5, 96px);
  justify-content: flex-start;
}

.image-modal-gallery-section {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.current-gallery-section {
  margin-bottom: 0;
}

.review-cover-preview-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.review-gallery-preview {
  margin-bottom: 0;
  grid-template-columns: repeat(auto-fill, 96px);
  justify-content: flex-start;
}

.review-cover-preview {
  width: 100%;
  margin-bottom: 0;
}

.review-cover-type-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(31, 35, 45, 0.72);
  color: #fffdfa;
  font-size: 12px;
  line-height: 1;
}

.review-empty-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border: 1px dashed #e7cf9b;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.68);
  text-align: center;
  padding: 24px;
}

.review-empty-state-compact {
  min-height: 220px;
}

.review-empty-icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: #f4e0b7;
  color: #8b5e00;
  font-size: 24px;
  font-weight: 800;
}

.review-empty-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-empty-copy strong {
  color: #6f4e12;
  font-size: 15px;
  font-weight: 700;
}

.review-empty-copy span {
  color: #8b7a5b;
  font-size: 13px;
  line-height: 1.6;
}

@keyframes approval-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1600px) {
  .approval-filter-grid {
    grid-template-columns: repeat(3, minmax(220px, 1fr));
  }
}

@media (max-width: 1100px) {
  .approval-filter-grid {
    grid-template-columns: repeat(2, minmax(200px, 1fr));
  }

  .image-modal-layout {
    grid-template-columns: 1fr;
  }

  .image-modal-aside {
    min-width: 0;
    max-width: none;
    padding-left: 0;
    border-left: none;
    padding-top: 24px;
    border-top: 1px solid #eadfce;
  }
}

@media (max-width: 720px) {
  .approval-filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
