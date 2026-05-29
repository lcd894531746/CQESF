<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { isUploaderOrAbove } from '../constants/auth'
import noImg from '../assets/noImg.png'
import request from '../utils/request'

const loading = ref(false)
const saving = ref(false)
const assets = ref([])
const dialogVisible = ref(false)
const editingAssetId = ref(null)
const coverInput = ref(null)
const galleryInput = ref(null)
const coverFile = ref(null)
const galleryFiles = ref([])
const previewImage = ref('')
const removedExistingGallery = ref(new Set())

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
})
const filters = reactive({
  keyword: '',
})
const assetForm = reactive({
  title: '',
  communityName: '',
  assetDesc: '',
  totalPrice: '',
  unitPrice: '',
  area: '',
  bedRoomNum: '',
  hallNum: '',
  orientation: '',
  floorState: '',
  contactName: '',
  contactPhone: '',
  status: 1,
  remark: '',
  coverImage: '',
  galleryImages: [],
})
const message = reactive({
  type: '',
  text: '',
})
const dialogMessage = reactive({
  type: '',
  text: '',
})

const isEditing = computed(() => Boolean(editingAssetId.value))
const coverPreview = computed(() => coverFile.value ? URL.createObjectURL(coverFile.value) : assetForm.coverImage)
const existingGalleryPreview = computed(() => {
  return (assetForm.galleryImages || []).filter((_, index) => !removedExistingGallery.value.has(index))
})
const newGalleryPreview = computed(() => galleryFiles.value.map((file) => URL.createObjectURL(file)))
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

function showDialogMessage(type, text) {
  dialogMessage.type = type
  dialogMessage.text = text
  window.clearTimeout(showDialogMessage.timer)
  showDialogMessage.timer = window.setTimeout(() => {
    dialogMessage.type = ''
    dialogMessage.text = ''
  }, 2500)
}

function buildParams(page = 1) {
  const params = { page }
  const keyword = filters.keyword.trim()
  if (keyword) params.keyword = keyword
  return params
}

async function loadAssets(page = 1) {
  loading.value = true
  try {
    const response = await request.get('/special-assets', { params: buildParams(page) })
    const data = response.data.data
    assets.value = data.items || []
    pagination.page = data.page || page
    pagination.pageSize = data.pageSize || 20
    pagination.total = data.total || 0
    pagination.totalPages = data.totalPages || 0
  } finally {
    loading.value = false
  }
}

async function searchAssets() {
  try {
    await loadAssets(1)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '查询特殊资产失败')
  }
}

async function resetFilters() {
  filters.keyword = ''
  await searchAssets()
}

async function changePage(nextPage) {
  if (nextPage < 1 || (pagination.totalPages && nextPage > pagination.totalPages)) return
  try {
    await loadAssets(nextPage)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '加载特殊资产失败')
  }
}

function resetForm() {
  editingAssetId.value = null
  assetForm.title = ''
  assetForm.communityName = ''
  assetForm.assetDesc = ''
  assetForm.totalPrice = ''
  assetForm.unitPrice = ''
  assetForm.area = ''
  assetForm.bedRoomNum = ''
  assetForm.hallNum = ''
  assetForm.orientation = ''
  assetForm.floorState = ''
  assetForm.contactName = ''
  assetForm.contactPhone = ''
  assetForm.status = 1
  assetForm.remark = ''
  assetForm.coverImage = ''
  assetForm.galleryImages = []
  coverFile.value = null
  galleryFiles.value = []
  removedExistingGallery.value = new Set()
  dialogMessage.type = ''
  dialogMessage.text = ''
  if (coverInput.value) coverInput.value.value = ''
  if (galleryInput.value) galleryInput.value.value = ''
}

function openCreateDialog() {
  if (!isUploaderOrAbove()) return
  resetForm()
  dialogVisible.value = true
}

function openEditDialog(asset) {
  if (!isUploaderOrAbove()) return
  resetForm()
  editingAssetId.value = asset.id
  assetForm.title = asset.title || ''
  assetForm.communityName = asset.communityName || ''
  assetForm.assetDesc = asset.assetDesc || ''
  assetForm.totalPrice = asset.totalPrice || ''
  assetForm.unitPrice = asset.unitPrice || ''
  assetForm.area = asset.area || ''
  assetForm.bedRoomNum = asset.bedRoomNum || ''
  assetForm.hallNum = asset.hallNum || ''
  assetForm.orientation = asset.orientation || ''
  assetForm.floorState = asset.floorState || ''
  assetForm.contactName = asset.contactName || ''
  assetForm.contactPhone = asset.contactPhone || ''
  assetForm.status = asset.status ?? 1
  assetForm.remark = asset.remark || ''
  assetForm.coverImage = asset.coverImage || ''
  assetForm.galleryImages = asset.galleryImages || []
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
  resetForm()
}

function handleCoverChange(event) {
  coverFile.value = event.target.files?.[0] || null
}

function handleGalleryChange(event) {
  galleryFiles.value = [
    ...galleryFiles.value,
    ...Array.from(event.target.files || []),
  ]
  if (galleryInput.value) galleryInput.value.value = ''
}

function removeCover() {
  coverFile.value = null
  assetForm.coverImage = ''
  if (coverInput.value) coverInput.value.value = ''
}

function removeExistingGalleryImage(index) {
  removedExistingGallery.value = new Set([...removedExistingGallery.value, index])
}

function removeNewGalleryImage(index) {
  galleryFiles.value = galleryFiles.value.filter((_, itemIndex) => itemIndex !== index)
}

function openImagePreview(image) {
  if (image) previewImage.value = image
}

function closeImagePreview() {
  previewImage.value = ''
}

function appendFormData(formData) {
  Object.entries(assetForm).forEach(([key, value]) => {
    if (key === 'galleryImages') return
    formData.append(key, value ?? '')
  })
  formData.append('existingGalleryImages', JSON.stringify(existingGalleryPreview.value))
  if (coverFile.value) formData.append('cover', coverFile.value)
  galleryFiles.value.forEach((file) => formData.append('gallery', file))
}

async function saveAsset() {
  if (!isUploaderOrAbove()) {
    showDialogMessage('error', '暂无操作权限')
    return
  }

  if (!assetForm.title.trim()) {
    showDialogMessage('error', '请输入资产标题')
    return
  }

  if (!assetForm.totalPrice.trim()) {
    showDialogMessage('error', '请输入总价')
    return
  }

  if (!assetForm.unitPrice.trim()) {
    showDialogMessage('error', '请输入单价')
    return
  }

  if (!String(assetForm.area).trim()) {
    showDialogMessage('error', '请输入面积')
    return
  }

  if (!String(assetForm.bedRoomNum).trim()) {
    showDialogMessage('error', '请输入户型')
    return
  }

  const formData = new FormData()
  appendFormData(formData)
  saving.value = true
  try {
    if (editingAssetId.value) {
      const response = await request.put(`/special-assets/${editingAssetId.value}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (response.data?.pending) {
        showMessage('success', response.data?.message || '已提交审核')
        closeDialog()
        await loadAssets(pagination.page)
        return
      }
      showMessage('success', '特殊资产已更新')
    } else {
      const response = await request.post('/special-assets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (response.data?.pending) {
        showMessage('success', response.data?.message || '已提交审核')
        closeDialog()
        await loadAssets(1)
        return
      }
      showMessage('success', '特殊资产已新增')
    }
    closeDialog()
    await loadAssets(editingAssetId.value ? pagination.page : 1)
  } catch (error) {
    showDialogMessage('error', error.response?.data?.message || '保存特殊资产失败')
  } finally {
    saving.value = false
  }
}

async function deleteAsset(asset) {
  if (!isUploaderOrAbove()) {
    showMessage('error', '暂无操作权限')
    return
  }

  if (!window.confirm(`确认删除「${asset.title || '该特殊资产'}」吗？`)) return
  loading.value = true
  try {
    const response = await request.delete(`/special-assets/${asset.id}`)
    if (response.data?.pending) {
      showMessage('success', response.data?.message || '已提交审核')
      return
    }
    showMessage('success', '特殊资产已删除')
    const nextPage = assets.value.length <= 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page
    await loadAssets(nextPage)
  } catch (error) {
    showMessage('error', error.response?.data?.message || '删除特殊资产失败')
  } finally {
    loading.value = false
  }
}

function displayLayout(asset) {
  if (!asset.bedRoomNum) return '-'
  return `${asset.bedRoomNum}室${asset.hallNum || 0}厅`
}

onMounted(async () => {
  try {
    await loadAssets()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '初始化特殊资产失败')
  }
})
</script>

<template>
  <div class="people-page house-page">
    <header class="people-header">
      <div>
        <h2>特殊资产列表</h2>
      </div>
      <button v-permission="'uploader'" class="primary" type="button" @click="openCreateDialog">新增资产</button>
    </header>

    <p v-if="message.text" :class="['inline-message', message.type]">{{ message.text }}</p>

    <section class="card list-card filter-card">
      <form class="filter-grid special-filter-grid" @submit.prevent="searchAssets">
        <label>
          <span>关键词</span>
          <input v-model.trim="filters.keyword" placeholder="标题、小区或描述关键词" />
        </label>
        <div class="filter-actions">
          <button class="primary" type="submit" :disabled="loading">查询</button>
          <button class="ghost" type="button" :disabled="loading" @click="resetFilters">重置</button>
        </div>
      </form>
    </section>

    <section class="card list-card house-list-card">
      <div class="table-toolbar">
        <strong>{{ pageSummary }}</strong>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>封面</th>
              <th>标题</th>
              <th>小区</th>
              <th>总价</th>
              <th>户型</th>
              <th>面积</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="asset in assets" :key="asset.id">
              <td>
                <img
                  class="house-cover clickable-image"
                  :src="asset.coverImage || noImg"
                  :alt="asset.title || '特殊资产封面'"
                  @click="openImagePreview(asset.coverImage || noImg)"
                />
              </td>
              <td>
                <strong class="house-title">{{ asset.title || '-' }}</strong>
                <p class="house-desc">{{ asset.assetDesc || '-' }}</p>
              </td>
              <td>{{ asset.communityName || '-' }}</td>
              <td>{{ asset.totalPrice || '-' }}</td>
              <td>{{ displayLayout(asset) }}</td>
              <td>{{ asset.area ? `${asset.area}㎡` : '-' }}</td>
              <td>{{ asset.status === 1 ? '展示' : '隐藏' }}</td>
              <td class="inline-actions">
                <button v-permission="'uploader'" class="mini" type="button" @click="openEditDialog(asset)">编辑</button>
                <button v-permission="'uploader'" class="mini danger" type="button" :disabled="loading" @click="deleteAsset(asset)">删除</button>
              </td>
            </tr>
            <tr v-if="!loading && assets.length === 0">
              <td colspan="8" class="empty-cell">暂无特殊资产</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager">
        <button class="ghost" type="button" :disabled="loading || pagination.page <= 1" @click="changePage(pagination.page - 1)">上一页</button>
        <span>第 {{ pagination.page }} / {{ pagination.totalPages || 1 }} 页</span>
        <button class="ghost" type="button" :disabled="loading || pagination.page >= (pagination.totalPages || 1)" @click="changePage(pagination.page + 1)">下一页</button>
      </div>
    </section>

    <div v-if="dialogVisible" class="modal-mask">
      <form class="card modal-card house-form-card" @submit.prevent="saveAsset">
        <div class="modal-fixed-header">
          <h3>{{ isEditing ? '编辑特殊资产' : '新增特殊资产' }}</h3>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closeDialog">×</button>
          <p v-if="dialogMessage.text" :class="['inline-message', dialogMessage.type]">{{ dialogMessage.text }}</p>
        </div>
        <div class="modal-scroll-body">
          <div class="house-form-grid">
            <label class="full-row">
              <span class="required-label">资产标题</span>
              <input v-model.trim="assetForm.title" placeholder="请输入资产标题" />
            </label>
            <label>
              <span>小区名称</span>
              <input v-model.trim="assetForm.communityName" placeholder="请输入小区名称" />
            </label>
            <label>
              <span>状态</span>
              <select v-model="assetForm.status">
                <option :value="1">展示</option>
                <option :value="0">隐藏</option>
              </select>
            </label>
            <label class="full-row">
              <span>资产描述</span>
              <textarea v-model.trim="assetForm.assetDesc" rows="3" placeholder="填写特殊资产说明"></textarea>
            </label>
            <label>
              <span class="required-label">总价</span>
              <input v-model.trim="assetForm.totalPrice" placeholder="如：128万" />
            </label>
            <label>
              <span class="required-label">单价</span>
              <input v-model.trim="assetForm.unitPrice" placeholder="如：12000元/平" />
            </label>
            <label>
              <span class="required-label">面积</span>
              <input v-model.trim="assetForm.area" inputmode="decimal" placeholder="如：89.5" />
            </label>
            <label>
              <span class="required-label">户型</span>
              <div class="inline-fields">
                <input v-model.trim="assetForm.bedRoomNum" inputmode="numeric" placeholder="室" />
                <input v-model.trim="assetForm.hallNum" inputmode="numeric" placeholder="厅" />
              </div>
            </label>
            <label>
              <span>朝向</span>
              <input v-model.trim="assetForm.orientation" placeholder="如：南北" />
            </label>
            <label>
              <span>楼层</span>
              <input v-model.trim="assetForm.floorState" placeholder="如：中楼层/18层" />
            </label>
            <label>
              <span>联系人</span>
              <input v-model.trim="assetForm.contactName" placeholder="联系人姓名" />
            </label>
            <label>
              <span>联系电话</span>
              <input v-model.trim="assetForm.contactPhone" placeholder="联系电话" />
            </label>
            <label class="full-row">
              <span>备注</span>
              <input v-model.trim="assetForm.remark" placeholder="可填写内部备注" />
            </label>
            <label>
              <span>封面图片</span>
              <input ref="coverInput" type="file" accept="image/*" @change="handleCoverChange" />
            </label>
            <label>
              <span>图片集合</span>
              <input ref="galleryInput" type="file" accept="image/*" multiple @change="handleGalleryChange" />
            </label>
          </div>

          <div class="house-upload-grid">
            <div>
              <p class="upload-title">封面预览</p>
              <div class="upload-preview single-preview removable-preview">
                <img
                  class="clickable-image"
                  :src="coverPreview || noImg"
                  alt="封面预览"
                  @click="openImagePreview(coverPreview || noImg)"
                />
                <button v-if="coverPreview" class="image-remove-btn" type="button" @click="removeCover">删除</button>
              </div>
            </div>
            <div>
              <p class="upload-title">图片集合</p>
              <div class="gallery-preview">
                <div v-for="(image, index) in existingGalleryPreview" :key="`old-${image}`" class="gallery-preview-item">
                  <img class="clickable-image" :src="image" alt="图片预览" @click="openImagePreview(image)" />
                  <button class="image-remove-btn" type="button" @click="removeExistingGalleryImage(assetForm.galleryImages.indexOf(image))">删除</button>
                </div>
                <div v-for="(image, index) in newGalleryPreview" :key="`new-${image}`" class="gallery-preview-item">
                  <img class="clickable-image" :src="image" alt="图片预览" @click="openImagePreview(image)" />
                  <button class="image-remove-btn" type="button" @click="removeNewGalleryImage(index)">删除</button>
                </div>
                <span v-if="existingGalleryPreview.length + newGalleryPreview.length === 0" class="gallery-empty">暂无图片</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-fixed-actions">
          <button v-permission="'uploader'" class="primary" type="submit" :disabled="saving">
            {{ saving ? '保存中...' : '保存资产' }}
          </button>
          <button class="ghost" type="button" :disabled="saving" @click="closeDialog">取消</button>
        </div>
      </form>
    </div>

    <div v-if="previewImage" class="image-preview-mask">
      <button class="preview-close" type="button" @click="closeImagePreview">关闭</button>
      <img class="image-preview-large" :src="previewImage" alt="大图预览" />
    </div>
  </div>
</template>
