<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { getAuthToken, isSales, isUploaderOrAbove } from '../constants/auth'
import noImg from '../assets/noImg.png'
import request from '../utils/request'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const API_PROXY_TARGET = import.meta.env.VITE_PROXY_TARGET || ''
const UPLOAD_BASE_URL = (() => {
  if (/^https?:\/\//i.test(API_PROXY_TARGET)) {
    return API_PROXY_TARGET.replace(/\/$/, '')
  }
  if (/^https?:\/\//i.test(API_BASE)) {
    try {
      return new URL(API_BASE).origin
    } catch {
      return ''
    }
  }
  return ''
})()
const loading = ref(false)
const savingImages = ref(false)
const houses = ref([])
const pageJumpInput = ref('')
const imageDialogVisible = ref(false)
const editingHouse = ref(null)
const posterInput = ref(null)
const galleryInput = ref(null)
const createCoverInput = ref(null)
const posterFile = ref(null)
const posterRemoved = ref(false)
const galleryFiles = ref([])
const currentGalleryDraft = ref([])
const createCoverFile = ref(null)
const previewImage = ref('')
const createDialogVisible = ref(false)
const savingHouse = ref(false)
const fallbackDistrictOptions = ['渝中区', '南岸区', '大渡口区', '九龙坡区', '沙坪坝区', '巴南区', '两江新区']
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
})
const districtOptions = ref([...fallbackDistrictOptions])
const filters = reactive({
  title: '',
  districtName: '',
  minPrice: '',
  maxPrice: '',
  todayOnly: '',
})
const message = reactive({
  type: '',
  text: '',
})
const houseForm = reactive({
  title: '',
  communityName: '',
  districtName: '',
  totalPrice: '',
  unitPrice: '',
  houseDesc: '',
})

const effectivePosterSource = computed(() => normalizeImageUrl(editingHouse.value?.posterImage || ''))

const effectivePosterPreview = computed(() => {
  if (imageDialogLocked.value) {
    return pendingReviewPosterRemoved.value ? '' : effectivePosterSource.value
  }
  return posterRemoved.value ? '' : effectivePosterSource.value
})

const posterFileName = computed(() => {
  if (posterFile.value?.name) return posterFile.value.name
  if (posterRemoved.value) return '已标记删除'
  return '未选择'
})

const createCoverPreview = computed(() => {
  if (createCoverFile.value) {
    return URL.createObjectURL(createCoverFile.value)
  }
  return ''
})

const createCoverFileName = computed(() => createCoverFile.value?.name || '未选择')

const galleryFileSummary = computed(() => {
  const count = galleryFiles.value.length
  return count > 0 ? `已选择 ${count} 张` : '未选择'
})

const imageDialogLocked = computed(() => Boolean(editingHouse.value?.pendingImageReview))

const pendingReviewPosterPreview = computed(() => {
  return normalizeImageUrl(editingHouse.value?.pendingImageReview?.posterImage || '')
})

const pendingReviewPosterRemoved = computed(() => Boolean(editingHouse.value?.pendingImageReview?.posterRemoved))

const pendingReviewGalleryPreview = computed(() => {
  return (editingHouse.value?.pendingImageReview?.galleryImages || []).map(normalizeImageUrl)
})

const effectiveGallerySource = computed(() => editingHouse.value?.galleryImages || [])

function normalizeImageKey(url) {
  return normalizeImageUrl(url)
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function diffImages(source = [], target = []) {
  const targetSet = new Set(target.map(normalizeImageKey))
  return source.filter((item) => !targetSet.has(normalizeImageKey(item)))
}

const effectiveGalleryPreview = computed(() => {
  const effectiveImages = effectiveGallerySource.value.map(normalizeImageUrl)
  if (imageDialogLocked.value) {
    const pendingDeleted = diffImages(effectiveImages, pendingReviewGalleryPreview.value)
    const deletedSet = new Set(pendingDeleted.map(normalizeImageKey))
    return effectiveImages.filter((item) => !deletedSet.has(normalizeImageKey(item)))
  }
  return currentGalleryDraft.value.map(normalizeImageUrl)
})

const reviewPosterItems = computed(() => {
  if (imageDialogLocked.value) {
    const items = []
    if (pendingReviewPosterRemoved.value && effectivePosterSource.value) {
      items.push({
        key: `locked-poster-deleted-${effectivePosterSource.value}`,
        image: effectivePosterSource.value,
        type: 'deleted',
      })
    }
    const pendingPoster = pendingReviewPosterPreview.value
    if (pendingPoster && pendingPoster !== effectivePosterSource.value) {
      items.push({
        key: `locked-poster-added-${pendingPoster}`,
        image: pendingPoster,
        type: 'added',
      })
    }
    return items
  }
  const items = []
  if (posterRemoved.value && effectivePosterSource.value) {
    items.push({
      key: `draft-poster-deleted-${effectivePosterSource.value}`,
      image: effectivePosterSource.value,
      type: 'deleted',
    })
  }
  if (posterFile.value) {
    items.push({
      key: `draft-poster-added-${posterFile.value.name}-${posterFile.value.size}`,
      image: URL.createObjectURL(posterFile.value),
      type: 'added',
    })
  }
  return items
})

const reviewGalleryPreview = computed(() => {
  if (imageDialogLocked.value) {
    const effectiveImages = effectiveGallerySource.value.map(normalizeImageUrl)
    const pendingImages = pendingReviewGalleryPreview.value
    const pendingDeleted = diffImages(effectiveImages, pendingImages)
    const pendingAdded = diffImages(pendingImages, effectiveImages)
    return [
      ...pendingDeleted.map((image, index) => ({
        key: `locked-deleted-${index}-${image}`,
        image,
        type: 'deleted',
      })),
      ...pendingAdded.map((image, index) => ({
        key: `locked-added-${index}-${image}`,
        image,
        type: 'added',
      })),
    ]
  }
  const effectiveImages = effectiveGallerySource.value.map(normalizeImageUrl)
  const currentImages = currentGalleryDraft.value.map(normalizeImageUrl)
  const pendingDeleted = diffImages(effectiveImages, currentImages)
  const pendingAdded = galleryFiles.value.map((file, fileIndex) => ({
    key: `draft-added-${fileIndex}-${file.name}-${file.size}`,
    image: URL.createObjectURL(file),
    type: 'added',
    fileIndex,
  }))
  return [
    ...pendingDeleted.map((image, index) => ({
      key: `draft-deleted-${index}-${image}`,
      image,
      type: 'deleted',
    })),
    ...pendingAdded,
  ]
})

const effectiveGalleryTitle = computed(() => '生效图片集合')

const effectiveGallerySummary = computed(() => (
  effectiveGalleryPreview.value.length > 0 ? `共 ${effectiveGalleryPreview.value.length} 张` : '暂无图片'
))

const reviewGalleryTitle = computed(() => (
  imageDialogLocked.value ? '审核中的图片集合' : '待提交审核图片'
))

const reviewGallerySummary = computed(() => (
  reviewGalleryPreview.value.length > 0 ? `共 ${reviewGalleryPreview.value.length} 张` : '暂无待审核图片'
))

const hasReviewChanges = computed(() => reviewPosterItems.value.length > 0 || reviewGalleryPreview.value.length > 0)

const reviewSectionTitle = computed(() => (
  imageDialogLocked.value ? '审核中的待生效图片' : '待提交审核变更'
))

const pendingReviewCreatedAtText = computed(() => {
  const raw = editingHouse.value?.pendingImageReview?.createdAt
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN', { hour12: false })
})

function isDeleteReviewPending(house) {
  return house?.approvalType === '删除审核' && house?.approvalStatus === '审核中'
}

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

function buildParams(page = 1) {
  const params = { page }
  Object.entries(filters).forEach(([key, value]) => {
    if (key === 'todayOnly') {
      if (value) {
        params[key] = value
      }
      return
    }
    const trimmedValue = String(value || '').trim()
    if (trimmedValue) {
      params[key] = trimmedValue
    }
  })
  return params
}

async function loadHouses(page = 1) {
  loading.value = true
  try {
    const response = await request.get('/bk/ershou/list', {
      params: buildParams(page),
    })
    const result = response.data.result
    houses.value = result.items || []
    pagination.page = result.page || page
    pagination.pageSize = result.pageSize || 20
    pagination.total = result.total || 0
    pagination.totalPages = result.totalPages || 0
    pageJumpInput.value = String(pagination.page)
  } finally {
    loading.value = false
  }
}

async function searchHouses() {
  try {
    await loadHouses(1)
  } catch (error) {
    showMessage('error', error.response?.data?.error || '查询房屋列表失败')
  }
}

async function resetFilters() {
  filters.title = ''
  filters.districtName = ''
  filters.minPrice = ''
  filters.maxPrice = ''
  filters.todayOnly = ''
  await searchHouses()
}

async function changePage(nextPage) {
  if (nextPage < 1 || (pagination.totalPages && nextPage > pagination.totalPages)) {
    return
  }

  try {
    await loadHouses(nextPage)
  } catch (error) {
    showMessage('error', error.response?.data?.error || '加载房屋列表失败')
  }
}

async function jumpToPage() {
  const totalPages = pagination.totalPages || 1
  const targetPage = Math.min(Math.max(parseInt(pageJumpInput.value, 10) || 1, 1), totalPages)
  pageJumpInput.value = String(targetPage)
  await changePage(targetPage)
}

function displayPrice(house) {
  const total = [house.totalPriceText, house.totalPriceUnit].filter(Boolean).join('')
  return total || '-'
}

function displayArea(house) {
  const area = Number(house.buildAreaSqm)
  if (!Number.isFinite(area) || area <= 0) return '-'
  return `${area}㎡`
}

function displayBuildingYear(house) {
  const year = String(house.buildingYear || '').trim()
  return year || '-'
}

function displayCommunityLine(house) {
  return [house.communityName, house.districtName, house.subAreaName].filter(Boolean).join(' / ') || '-'
}

function resetHouseForm() {
  houseForm.title = ''
  houseForm.communityName = ''
  houseForm.districtName = ''
  houseForm.totalPrice = ''
  houseForm.unitPrice = ''
  houseForm.houseDesc = ''
  createCoverFile.value = null
  if (createCoverInput.value) createCoverInput.value.value = ''
}

function displayCover(house) {
  return normalizeImageUrl(house.posterImage || '')
}

function isTodayNewHouse(house) {
  const raw = String(house?.createdAt || '').trim()
  if (!raw) return false
  const createdAt = new Date(raw)
  if (Number.isNaN(createdAt.getTime())) return false
  const now = new Date()
  const createdDay = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate())
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((currentDay.getTime() - createdDay.getTime()) / (24 * 60 * 60 * 1000))
  return diffDays >= 0 && diffDays <= 1
}

function normalizeImageUrl(url) {
  const normalized = String(url || '').trim().replace(/^http:\/\/shanlan\.xyz\/uploads\//i, 'https://shanlan.xyz/uploads/')
  if (/^\/uploads\//.test(normalized) && UPLOAD_BASE_URL) {
    return `${UPLOAD_BASE_URL}${normalized}`
  }
  return normalized
}

function proxyRemoteImageUrl(url) {
  const normalized = normalizeImageUrl(url)
  if (!normalized || normalized.startsWith('/')) return normalized
  if (/^https:\/\/shanlan\.xyz\/uploads\//.test(normalized)) return normalized
  const token = getAuthToken()
  const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : ''
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(normalized)}${tokenQuery}`
}

function openImagePreview(image) {
  if (image) {
    previewImage.value = image
  }
}

function closeImagePreview() {
  previewImage.value = ''
}

function openCreateHouseDialog() {
  if (isSales()) return
  resetHouseForm()
  createDialogVisible.value = true
}

function closeCreateHouseDialog() {
  createDialogVisible.value = false
  resetHouseForm()
}

function handleCreateCoverChange(event) {
  createCoverFile.value = event.target.files?.[0] || null
}

function removeCreateCover() {
  createCoverFile.value = null
  if (createCoverInput.value) createCoverInput.value.value = ''
}

function openImageDialog(house) {
  if (!isUploaderOrAbove()) return
  if (isDeleteReviewPending(house)) {
    showMessage('error', '删除审核中的房源不允许编辑图片')
    return
  }
  editingHouse.value = house
  posterFile.value = null
  posterRemoved.value = false
  galleryFiles.value = []
  currentGalleryDraft.value = [...(house?.galleryImages || [])]
  imageDialogVisible.value = true
}

function closeImageDialog() {
  imageDialogVisible.value = false
  editingHouse.value = null
  posterFile.value = null
  posterRemoved.value = false
  galleryFiles.value = []
  currentGalleryDraft.value = []
  if (posterInput.value) posterInput.value.value = ''
  if (galleryInput.value) galleryInput.value.value = ''
}

function handlePosterChange(event) {
  posterFile.value = event.target.files?.[0] || null
}

function handleGalleryChange(event) {
  if (imageDialogLocked.value) return
  galleryFiles.value = [
    ...galleryFiles.value,
    ...Array.from(event.target.files || []),
  ]
  if (galleryInput.value) galleryInput.value.value = ''
}

function removePoster() {
  if (imageDialogLocked.value) return
  posterRemoved.value = Boolean(effectivePosterSource.value)
}

function removeGalleryImage(index) {
  if (imageDialogLocked.value) return
  if (index < currentGalleryDraft.value.length) {
    currentGalleryDraft.value = currentGalleryDraft.value.filter((_, itemIndex) => itemIndex !== index)
    return
  }
  const localIndex = index - currentGalleryDraft.value.length
  galleryFiles.value = galleryFiles.value.filter((_, itemIndex) => itemIndex !== localIndex)
}

function restoreGalleryImage(image) {
  const sourceImages = effectiveGallerySource.value
  const sourceIndex = sourceImages.findIndex((item) => normalizeImageKey(item) === normalizeImageKey(image))
  if (sourceIndex === -1) return

  const draftKeys = currentGalleryDraft.value.map((item) => normalizeImageKey(item))
  if (draftKeys.includes(normalizeImageKey(sourceImages[sourceIndex]))) return

  let insertAt = 0
  for (let index = 0; index < sourceIndex; index += 1) {
    if (draftKeys.includes(normalizeImageKey(sourceImages[index]))) {
      insertAt += 1
    }
  }

  currentGalleryDraft.value = [
    ...currentGalleryDraft.value.slice(0, insertAt),
    sourceImages[sourceIndex],
    ...currentGalleryDraft.value.slice(insertAt),
  ]
}

function removeReviewPosterItem(item) {
  if (imageDialogLocked.value) return
  if (item.type === 'added') {
    posterFile.value = null
    if (posterInput.value) posterInput.value.value = ''
    return
  }
  posterRemoved.value = false
}

function removeReviewGalleryItem(item) {
  if (imageDialogLocked.value) return
  if (item.type === 'deleted') {
    restoreGalleryImage(item.image)
    return
  }
  if (typeof item.fileIndex === 'number') {
    galleryFiles.value = galleryFiles.value.filter((_, itemIndex) => itemIndex !== item.fileIndex)
  }
}

async function saveHouseImages() {
  if (!isUploaderOrAbove()) {
    showMessage('error', '暂无操作权限')
    return
  }

  if (imageDialogLocked.value) {
    showMessage('error', '当前已有整套图片在审核中，请等待审核完成后再操作')
    return
  }

  const hasPosterChanged = Boolean(posterFile.value) || posterRemoved.value
  const hasGalleryChanged = JSON.stringify(currentGalleryDraft.value) !== JSON.stringify(editingHouse.value?.galleryImages || [])

  if (!editingHouse.value || (!hasPosterChanged && galleryFiles.value.length === 0 && !hasGalleryChanged)) {
    showMessage('error', '请先调整图片后再提交')
    return
  }

  const formData = new FormData()
  if (posterFile.value) {
    formData.append('poster', posterFile.value)
  }
  formData.append('posterRemoved', posterRemoved.value ? '1' : '0')
  formData.append('existingGalleryImages', JSON.stringify(currentGalleryDraft.value))
  galleryFiles.value.forEach((file) => {
    formData.append('gallery', file)
  })

  savingImages.value = true
  try {
    const response = await request.post(
      `/bk/ershou/list/${editingHouse.value.id}/images`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
    if (response.data?.pending) {
      const house = houses.value.find((item) => item.id === editingHouse.value.id)
      if (house) {
        house.approvalType = '图片审核'
        house.approvalStatus = '审核中'
        const payload = response.data?.data?.payload || {}
        const pendingPosterImage = normalizeImageUrl(
          payload.posterImageUrl || (posterFile.value ? URL.createObjectURL(posterFile.value) : '')
        )
        house.pendingImageReview = {
          status: 'pending',
          createdAt: response.data?.data?.createdAt || new Date().toISOString(),
          posterImage: pendingPosterImage,
          posterRemoved: posterRemoved.value || isTruthyFlag(payload.posterRemoved),
          galleryImages: (payload.galleryImageUrls || []).map(normalizeImageUrl),
        }
      }
      showMessage('success', response.data?.message || '已提交审核')
      closeImageDialog()
      return
    }
    const data = response.data.data
    const house = houses.value.find((item) => item.id === editingHouse.value.id)
    if (house) {
      house.posterImage = normalizeImageUrl(data.posterImage)
      house.originalCoverPic = normalizeImageUrl(data.originalCoverPic || house.originalCoverPic || '')
      house.galleryImages = (data.galleryImages || []).map(normalizeImageUrl)
      house.pendingImageReview = null
      house.approvalType = ''
      house.approvalStatus = ''
    }
    showMessage('success', '房源图片已更新')
    closeImageDialog()
  } catch (error) {
    showMessage('error', error.response?.data?.message || error.response?.data?.error || '上传图片失败')
  } finally {
    savingImages.value = false
  }
}

async function deleteHouse(house) {
  if (!isUploaderOrAbove()) {
    showMessage('error', '暂无操作权限')
    return
  }

  if (!house?.id) return
  const title = house.title || '该房源'
  if (!window.confirm(`确认删除「${title}」吗？`)) {
    return
  }

  loading.value = true
  try {
    const response = await request.delete(`/bk/ershou/list/${house.id}`)
    if (response.data?.pending) {
      const currentHouse = houses.value.find((item) => item.id === house.id)
      if (currentHouse) {
        currentHouse.approvalType = '删除审核'
        currentHouse.approvalStatus = '审核中'
      }
      showMessage('success', response.data?.message || '已提交审核')
      return
    }
    showMessage('success', '房源已删除')
    const nextPage = houses.value.length <= 1 && pagination.page > 1
      ? pagination.page - 1
      : pagination.page
    await loadHouses(nextPage)
  } catch (error) {
    showMessage('error', error.response?.data?.message || error.response?.data?.error || '删除房源失败')
  } finally {
    loading.value = false
  }
}

async function loadDistrictOptions() {
  try {
    const response = await request.get('/bk/ershou/district-options')
    const items = response.data?.result?.items || []
    const nextOptions = Array.from(new Set(
      items
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ))
    districtOptions.value = nextOptions.length > 0 ? nextOptions : [...fallbackDistrictOptions]
  } catch (error) {
    districtOptions.value = [...fallbackDistrictOptions]
  }
}

async function saveHouse() {
  if (isSales()) {
    showMessage('error', '销售暂无上传房屋权限')
    return
  }

  if (!houseForm.title) {
    showMessage('error', '请输入房源标题')
    return
  }
  if (!houseForm.districtName) {
    showMessage('error', '请选择区域')
    return
  }
  if (!houseForm.totalPrice) {
    showMessage('error', '请输入总价')
    return
  }

  const formData = new FormData()
  formData.append('title', houseForm.title)
  formData.append('communityName', houseForm.communityName)
  formData.append('districtName', houseForm.districtName)
  formData.append('totalPrice', houseForm.totalPrice)
  formData.append('unitPrice', houseForm.unitPrice)
  formData.append('houseDesc', houseForm.houseDesc)
  if (createCoverFile.value) {
    formData.append('cover', createCoverFile.value)
  }

  savingHouse.value = true
  try {
    await request.post('/bk/ershou/list', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    showMessage('success', '房源新增成功')
    closeCreateHouseDialog()
    await loadHouses(1)
  } catch (error) {
    showMessage('error', error.response?.data?.message || error.response?.data?.error || '新增房源失败')
  } finally {
    savingHouse.value = false
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadDistrictOptions(), loadHouses()])
  } catch (error) {
    showMessage('error', error.response?.data?.error || '初始化房屋列表失败，请确认后端和数据库已启动')
  }
})
</script>

<template>
  <div class="people-page house-page">
    <header class="people-header">
      <div>
        <h2>房屋列表</h2>
      </div>
      <div class="header-actions">
        <button v-if="!isSales()" class="primary" type="button" @click="openCreateHouseDialog">上传房屋</button>
      </div>
    </header>

    <p v-if="message.text" :class="['inline-message', message.type]">{{ message.text }}</p>

    <section class="card list-card filter-card">
      <form class="filter-grid house-filter-grid" @submit.prevent="searchHouses">
        <label class="filter-title-field">
          <span>标题</span>
          <input v-model.trim="filters.title" placeholder="输入房源标题关键词" />
        </label>
        <label class="filter-price-field">
          <span>最低总价</span>
          <input v-model.trim="filters.minPrice" inputmode="decimal" placeholder="如：80" />
        </label>
        <label class="filter-price-field">
          <span>最高总价</span>
          <input v-model.trim="filters.maxPrice" inputmode="decimal" placeholder="如：200" />
        </label>
        <label class="filter-district-field">
          <span>区域</span>
          <select v-model="filters.districtName">
            <option value="">全部区域</option>
            <option v-for="district in districtOptions" :key="district" :value="district">
              {{ district }}
            </option>
          </select>
        </label>
        <label class="filter-today-field">
          <span>今日上新</span>
          <select v-model="filters.todayOnly">
            <option value="">全部</option>
            <option value="1">仅看今日上新</option>
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
        <table>
          <thead>
            <tr>
              <th>封面</th>
              <th>标题</th>
              <th>年份</th>
              <th>小区</th>
              <th>面积</th>
              <th>总价</th>
              <th>单价</th>
              <th>审核信息</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="house in houses" :key="house.id">
              <td>
                <div class="house-cover-wrap">
                  <span v-if="isTodayNewHouse(house)" class="house-new-badge">上新</span>
                  <img
                    v-if="displayCover(house)"
                    class="house-cover clickable-image"
                    :src="displayCover(house)"
                    :alt="house.title || '房源封面'"
                    @click="openImagePreview(displayCover(house))"
                  />
                  <img v-else class="house-cover placeholder-image" :src="noImg" alt="暂无封面" />
                </div>
              </td>
              <td>
                <strong class="house-title">{{ house.title || '-' }}</strong>
                <p class="house-desc">{{ house.listingDesc || '-' }}</p>
              </td>
              <td>{{ displayBuildingYear(house) }}</td>
              <td>{{ displayCommunityLine(house) }}</td>
              <td>{{ displayArea(house) }}</td>
              <td>{{ displayPrice(house) }}</td>
              <td>{{ house.unitPriceText || '-' }}</td>
              <td>
                <span
                  v-if="house.approvalStatus"
                  :class="[
                    'review-status-badge',
                    house.approvalStatus === '审核中'
                      ? 'pending'
                      : house.approvalStatus === '已驳回'
                        ? 'rejected'
                        : 'done',
                  ]"
                >
                  {{ house.approvalType ? `${house.approvalType} · ${house.approvalStatus}` : house.approvalStatus }}
                </span>
              </td>
              <td class="inline-actions">
                <button
                  v-permission="'uploader'"
                  class="mini"
                  type="button"
                  :disabled="isDeleteReviewPending(house)"
                  @click="openImageDialog(house)"
                >
                  编辑
                </button>
                <button v-permission="'uploader'" class="mini danger" type="button" :disabled="loading" @click="deleteHouse(house)">删除</button>
              </td>
            </tr>
            <tr v-if="!loading && houses.length === 0">
              <td colspan="9" class="empty-cell">暂无房屋数据</td>
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

    <div v-if="imageDialogVisible" class="modal-mask">
      <form class="card modal-card image-modal-card" @submit.prevent="saveHouseImages">
        <div class="image-modal-header">
          <div>
            <h3>编辑房源图片</h3>
            <p class="modal-subtitle">{{ editingHouse?.title || '-' }}</p>
          </div>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closeImageDialog">×</button>
        </div>

        <div class="image-modal-body">
          <div class="image-modal-layout">
            <div class="image-modal-main">
              <div class="image-field cover-edit-field">
                <div class="image-field-head">
                  <span>当前生效封面</span>
                </div>
                <div class="upload-preview single-preview removable-preview cover-preview-box">
                  <img
                    v-if="effectivePosterPreview"
                    class="clickable-image"
                    :src="effectivePosterPreview"
                    alt="封面预览"
                    @click="openImagePreview(effectivePosterPreview)"
                  />
                  <button
                    v-if="!imageDialogLocked && effectivePosterPreview"
                    class="image-remove-btn"
                    type="button"
                    @click="removePoster"
                  >
                    删除
                  </button>
                  <img v-if="!effectivePosterPreview" class="large-placeholder placeholder-image" :src="noImg" alt="暂无封面" />
                </div>
                <div class="image-field-actions">
                  <label class="file-picker-btn">
                    选择图片
                    <input ref="posterInput" type="file" accept="image/*" :disabled="imageDialogLocked" @change="handlePosterChange" />
                  </label>
                  <span class="file-picker-meta">{{ posterFileName }}</span>
                </div>
              </div>

              <div class="image-modal-gallery-section current-gallery-section">
                <div class="image-field gallery-field">
                  <div class="image-field-head gallery-field-head">
                    <span>{{ effectiveGalleryTitle }}</span>
                    <span class="file-picker-meta">{{ effectiveGallerySummary }}</span>
                    <label class="file-picker-btn">
                      选择图片
                      <input ref="galleryInput" type="file" accept="image/*" multiple :disabled="imageDialogLocked" @change="handleGalleryChange" />
                    </label>
                  </div>
                </div>
                <div class="gallery-preview image-modal-gallery-preview">
                  <div v-for="(image, index) in effectiveGalleryPreview" :key="`${image}-${index}`" class="gallery-preview-item">
                    <img
                      class="clickable-image"
                      :src="image"
                      alt="图片预览"
                      @click="openImagePreview(image)"
                    />
                    <button v-if="!imageDialogLocked" class="image-remove-btn" type="button" @click="removeGalleryImage(index)">删除</button>
                  </div>
                  <span v-if="effectiveGalleryPreview.length === 0" class="gallery-empty">暂无图片</span>
                </div>
              </div>
            </div>

            <aside class="image-modal-aside">
              <div class="pending-review-block review-cover-block">
                <div class="image-field-head pending-review-head">
                  <span>{{ imageDialogLocked ? '封面审核' : '待提交审核封面' }}</span>
                  <em v-if="pendingReviewCreatedAtText">提交时间：{{ pendingReviewCreatedAtText }}</em>
                </div>
                <div v-if="reviewPosterItems.length > 0" class="review-cover-preview-list">
                  <div
                    v-for="item in reviewPosterItems"
                    :key="item.key"
                    class="upload-preview single-preview readonly-preview removable-preview review-cover-preview"
                  >
                    <span class="review-cover-type-badge">
                      {{ item.type === 'deleted' ? '待删除' : '待上传' }}
                    </span>
                    <img
                      class="clickable-image"
                      :src="item.image"
                      :alt="item.type === 'deleted' ? '待删除封面' : '待上传封面'"
                      @click="openImagePreview(item.image)"
                    />
                    <button
                      v-if="!imageDialogLocked"
                      class="image-remove-btn"
                      type="button"
                      @click="removeReviewPosterItem(item)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div v-else class="review-empty-state review-empty-state-compact">
                  <div class="review-empty-icon">审</div>
                  <div class="review-empty-copy">
                    <strong>{{ imageDialogLocked ? '当前没有封面审核' : '当前没有待提交封面变更' }}</strong>
                    <span>{{ imageDialogLocked ? '审核中的封面会显示在这里。' : '上传新封面后，会显示在这里。' }}</span>
                  </div>
                </div>
              </div>

              <div class="pending-review-block review-gallery-block">
                <div class="image-field-head pending-review-head">
                  <span>{{ imageDialogLocked ? '图片集合审核' : '待提交审核图片集合' }}</span>
                  <em v-if="pendingReviewCreatedAtText">提交时间：{{ pendingReviewCreatedAtText }}</em>
                </div>
                <template v-if="reviewGalleryPreview.length > 0">
                  <div class="image-field gallery-field">
                    <div class="image-field-head gallery-field-head">
                      <span>{{ reviewGalleryTitle }}</span>
                      <span class="file-picker-meta">{{ reviewGallerySummary }}</span>
                    </div>
                  </div>
                  <div class="gallery-preview review-gallery-preview">
                    <div v-for="item in reviewGalleryPreview" :key="item.key" class="gallery-preview-item">
                      <img
                        class="clickable-image"
                        :src="item.image"
                        alt="待审核图片预览"
                        @click="openImagePreview(item.image)"
                      />
                      <button
                        v-if="!imageDialogLocked"
                        class="image-remove-btn"
                        type="button"
                        @click="removeReviewGalleryItem(item)"
                      >
                        删除
                      </button>
                    </div>
                    <span v-if="reviewGalleryPreview.length === 0" class="gallery-empty">暂无待审核图片</span>
                  </div>
                </template>
                <div v-else class="review-empty-state">
                  <div class="review-empty-icon">审</div>
                  <div class="review-empty-copy">
                    <strong>{{ imageDialogLocked ? '当前没有图片集合审核' : '当前没有待提交图片变更' }}</strong>
                    <span>{{ imageDialogLocked ? '审核中的图片集合会显示在这里。' : '删除或上传图片后，待审核图片会显示在这里。' }}</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div class="actions image-modal-actions">
          <button v-permission="'uploader'" class="primary" type="submit" :disabled="savingImages">
            {{ savingImages ? '上传中...' : '保存图片' }}
          </button>
          <button class="ghost" type="button" :disabled="savingImages" @click="closeImageDialog">取消</button>
        </div>
      </form>
    </div>

    <div v-if="createDialogVisible" class="modal-mask">
      <form class="card modal-card house-form-card" @submit.prevent="saveHouse">
        <div class="image-modal-header">
          <div>
            <h3>上传房屋</h3>
            <p class="modal-subtitle">当前除销售外均可上传房屋</p>
          </div>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closeCreateHouseDialog">×</button>
        </div>

        <div class="image-modal-body">
          <div class="house-form-grid">
            <label>
              <span class="required-label">房源标题</span>
              <input v-model.trim="houseForm.title" placeholder="请输入房源标题" />
            </label>
            <label>
              <span>小区名称</span>
              <input v-model.trim="houseForm.communityName" placeholder="请输入小区名称" />
            </label>
            <label>
              <span class="required-label">区域</span>
              <select v-model="houseForm.districtName">
                <option value="">请选择区域</option>
                <option v-for="district in districtOptions" :key="district" :value="district">
                  {{ district }}
                </option>
              </select>
            </label>
            <label>
              <span class="required-label">总价</span>
              <input v-model.trim="houseForm.totalPrice" inputmode="decimal" placeholder="如：88" />
            </label>
            <label>
              <span>单价</span>
              <input v-model.trim="houseForm.unitPrice" placeholder="如：9800元/平" />
            </label>
            <label class="full-span">
              <span>封面图</span>
              <div class="image-field create-cover-field">
                <div class="upload-preview single-preview removable-preview">
                  <img
                    v-if="createCoverPreview"
                    class="clickable-image"
                    :src="createCoverPreview"
                    alt="封面预览"
                    @click="openImagePreview(createCoverPreview)"
                  />
                  <button v-if="createCoverFile" class="image-remove-btn" type="button" @click="removeCreateCover">删除</button>
                  <img v-if="!createCoverPreview" class="large-placeholder placeholder-image" :src="noImg" alt="暂无封面" />
                </div>
                <div class="image-field-actions">
                  <label class="file-picker-btn">
                    选择图片
                    <input ref="createCoverInput" type="file" accept="image/*" @change="handleCreateCoverChange" />
                  </label>
                  <span class="file-picker-meta">{{ createCoverFileName }}</span>
                </div>
              </div>
            </label>
            <label class="full-span">
              <span>房源描述</span>
              <textarea v-model.trim="houseForm.houseDesc" rows="4" placeholder="如：2室1厅 / 89平 / 南"></textarea>
            </label>
          </div>
        </div>

        <div class="actions image-modal-actions">
          <button v-if="!isSales()" class="primary" type="submit" :disabled="savingHouse">
            {{ savingHouse ? '保存中...' : '保存房屋' }}
          </button>
          <button class="ghost" type="button" :disabled="savingHouse" @click="closeCreateHouseDialog">取消</button>
        </div>
      </form>
    </div>

    <div v-if="previewImage" class="image-preview-mask">
      <button class="preview-close" type="button" @click="closeImagePreview">关闭</button>
      <img class="image-preview-large" :src="previewImage" alt="大图预览" />
    </div>
  </div>
</template>

<style scoped>
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

.house-pager-summary {
  color: #4b4f5d;
  white-space: nowrap;
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

.review-cover-field {
  margin-bottom: 18px;
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

.image-modal-card {
  width: min(1320px, calc(100vw - 48px));
  max-width: none;
}

.house-filter-grid {
  grid-template-columns:
    minmax(220px, 320px)
    minmax(92px, 112px)
    minmax(92px, 112px)
    minmax(130px, 156px)
    minmax(120px, 138px)
    auto;
  gap: 12px;
  align-items: end;
}

.house-filter-grid label {
  min-width: 0;
}

.house-filter-grid label > span {
  display: inline-block;
  margin-bottom: 8px;
  font-size: 13px;
  white-space: nowrap;
}

.house-filter-grid input,
.house-filter-grid select {
  width: 100%;
}

.house-filter-grid .filter-actions {
  align-self: end;
  display: flex;
  flex-wrap: nowrap;
  white-space: nowrap;
  justify-self: end;
}

.house-filter-grid .filter-actions button {
  min-width: 0;
  padding-inline: 18px;
}

.house-cover-wrap {
  position: relative;
  display: block;
  width: 92px;
  height: 68px;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 8px;
  line-height: 0;
}

.house-new-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ff6b4a, #ff8247);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 8px 18px rgba(255, 107, 74, 0.24);
  pointer-events: none;
}

@media (max-width: 1080px) {
  .house-filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .house-filter-grid .filter-actions {
    grid-column: 1 / -1;
  }

  .image-modal-layout {
    grid-template-columns: 1fr;
    gap: 22px;
  }

  .image-modal-main {
    gap: 22px;
  }

  .image-modal-aside {
    min-width: 0;
    max-width: none;
    padding-left: 0;
    border-left: none;
    border-top: 1px solid #eadfce;
    padding-top: 22px;
  }
}

@media (max-width: 720px) {
  .house-filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
