<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { getRoleLabel, isAdmin, ROLE_ADMIN, ROLE_REVIEWER, ROLE_UPLOADER, ROLE_SALES } from '../constants/auth'
import apiRequest from '../utils/request'

const loading = ref(false)
const people = ref([])
const peopleDialogVisible = ref(false)
const passwordDialogVisible = ref(false)
const roleOptions = [
  { label: '管理员（1级）', value: ROLE_ADMIN },
  { label: '审核员（2级）', value: ROLE_REVIEWER },
  { label: '图片上传专员（3级）', value: ROLE_UPLOADER },
  { label: '销售（4级）', value: ROLE_SALES },
]

const message = reactive({
  type: '',
  text: '',
})
const peopleForm = reactive({
  id: null,
  name: '',
  phone: '',
  role: '',
  status: 1,
  remark: '',
})
const passwordForm = reactive({
  personId: null,
  personName: '',
  password: '',
  confirmPassword: '',
})

const isEditingPerson = computed(() => Boolean(peopleForm.id))

function showMessage(type, text) {
  message.type = type
  message.text = text
  window.clearTimeout(showMessage.timer)
  showMessage.timer = window.setTimeout(() => {
    message.type = ''
    message.text = ''
  }, 2500)
}

async function requestData(url, options = {}) {
  loading.value = true
  try {
    const response = await apiRequest({
      url,
      ...options,
    })
    return response.data
  } finally {
    loading.value = false
  }
}

async function loadPeople() {
  const result = await requestData('/system-staff/list')
  people.value = result.data || []
}

function resetPeopleForm() {
  peopleForm.id = null
  peopleForm.name = ''
  peopleForm.phone = ''
  peopleForm.role = ''
  peopleForm.status = 1
  peopleForm.remark = ''
}

function openCreatePerson() {
  if (!isAdmin()) return
  resetPeopleForm()
  peopleDialogVisible.value = true
}

function openEditPerson(person) {
  if (!isAdmin()) return
  peopleForm.id = person.id
  peopleForm.name = person.name
  peopleForm.phone = person.phone
  peopleForm.role = person.role
  peopleForm.status = person.status
  peopleForm.remark = person.remark || ''
  peopleDialogVisible.value = true
}

function closePeopleDialog() {
  peopleDialogVisible.value = false
  resetPeopleForm()
}

function openPasswordDialog(person) {
  if (!isAdmin()) return
  passwordForm.personId = person.id
  passwordForm.personName = person.name
  passwordForm.password = ''
  passwordForm.confirmPassword = ''
  passwordDialogVisible.value = true
}

function closePasswordDialog() {
  passwordDialogVisible.value = false
  passwordForm.personId = null
  passwordForm.personName = ''
  passwordForm.password = ''
  passwordForm.confirmPassword = ''
}

async function savePerson() {
  if (!isAdmin()) {
    showMessage('error', '暂无操作权限')
    return
  }

  const payload = {
    name: peopleForm.name,
    phone: peopleForm.phone,
    role: peopleForm.role,
    status: Number(peopleForm.status),
    remark: peopleForm.remark,
  }

  try {
    if (peopleForm.id) {
      await requestData(`/system-staff/update/${peopleForm.id}`, { method: 'put', data: payload })
      showMessage('success', '人员信息已更新')
    } else {
      await requestData('/system-staff/create', { method: 'post', data: payload })
      showMessage('success', '人员已新增')
    }
    closePeopleDialog()
    await loadPeople()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '保存人员失败')
  }
}

async function deletePerson(id) {
  if (!isAdmin()) {
    showMessage('error', '暂无操作权限')
    return
  }

  if (!window.confirm('确认删除这条人员信息吗？')) {
    return
  }

  try {
    await requestData(`/system-staff/delete/${id}`, { method: 'delete' })
    showMessage('success', '人员已删除')
    await loadPeople()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '删除人员失败')
  }
}

async function updatePersonPassword() {
  if (!isAdmin()) {
    showMessage('error', '暂无操作权限')
    return
  }

  if (!passwordForm.password) {
    showMessage('error', '请输入新密码')
    return
  }

  if (passwordForm.password !== passwordForm.confirmPassword) {
    showMessage('error', '两次输入的密码不一致')
    return
  }

  try {
    await requestData(`/system-staff/password/${passwordForm.personId}`, {
      method: 'put',
      data: { password: passwordForm.password },
    })
    showMessage('success', '密码已修改')
    closePasswordDialog()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '修改密码失败')
  }
}

onMounted(async () => {
  try {
    await loadPeople()
  } catch (error) {
    showMessage('error', error.response?.data?.message || '初始化失败，请确认后端和数据库已启动')
  }
})
</script>

<template>
  <div class="people-page">
    <header class="people-header">
      <div>
        <h2>账号列表</h2>
      </div>
      <button v-permission="'admin'" class="primary" type="button" @click="openCreatePerson">新增人员</button>
    </header>

    <p v-if="message.text" :class="['inline-message', message.type]">{{ message.text }}</p>

    <section class="card list-card people-list-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>手机号</th>
              <th>OpenID</th>
              <th>角色</th>
              <th>状态</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="person in people" :key="person.id">
              <td>{{ person.name }}</td>
              <td>{{ person.phone }}</td>
              <td>{{ person.wechat_openid || '-' }}</td>
              <td>{{ getRoleLabel(person.role) }}</td>
              <td>{{ person.status === 1 ? '在职' : '停用' }}</td>
              <td>{{ person.remark || '-' }}</td>
              <td class="inline-actions">
                <button v-permission="'admin'" class="mini" type="button" @click="openEditPerson(person)">编辑</button>
                <button v-permission="'admin'" class="mini" type="button" @click="openPasswordDialog(person)">改密码</button>
                <button v-permission="'admin'" class="mini danger" type="button" @click="deletePerson(person.id)">删除</button>
              </td>
            </tr>
            <tr v-if="!loading && people.length === 0">
              <td colspan="7" class="empty-cell">暂无人员数据</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="peopleDialogVisible" class="modal-mask">
      <form class="card modal-card" @submit.prevent="savePerson">
        <div class="modal-title-row">
          <h3>{{ isEditingPerson ? '编辑人员' : '新增人员' }}</h3>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closePeopleDialog">×</button>
        </div>
        <label>
          <span class="required-label">姓名</span>
          <input v-model.trim="peopleForm.name" placeholder="请输入姓名" />
        </label>
        <label>
          <span class="required-label">手机号</span>
          <input v-model.trim="peopleForm.phone" placeholder="请输入手机号" />
        </label>
        <label>
          <span class="required-label">角色</span>
          <select v-model="peopleForm.role">
            <option value="" disabled>请选择角色</option>
            <option v-for="option in roleOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>状态</span>
          <select v-model="peopleForm.status">
            <option :value="1">在职</option>
            <option :value="0">停用</option>
          </select>
        </label>
        <label>
          <span>备注</span>
          <textarea v-model.trim="peopleForm.remark" rows="3" placeholder="可填写说明"></textarea>
        </label>
        <div class="actions">
          <button v-permission="'admin'" class="primary" type="submit">{{ isEditingPerson ? '保存修改' : '新增人员' }}</button>
          <button class="ghost" type="button" @click="closePeopleDialog">取消</button>
        </div>
      </form>
    </div>

    <div v-if="passwordDialogVisible" class="modal-mask">
      <form class="card modal-card" @submit.prevent="updatePersonPassword">
        <div class="modal-title-row">
          <h3>修改密码</h3>
          <button class="modal-close-btn" type="button" aria-label="关闭弹窗" @click="closePasswordDialog">×</button>
        </div>
        <p class="modal-subtitle">当前人员：{{ passwordForm.personName }}</p>
        <label>
          <span class="required-label">新密码</span>
          <input v-model="passwordForm.password" type="password" autocomplete="new-password" placeholder="请输入新密码" />
        </label>
        <label>
          <span class="required-label">确认密码</span>
          <input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" />
        </label>
        <div class="actions">
          <button v-permission="'admin'" class="primary" type="submit">保存密码</button>
          <button class="ghost" type="button" @click="closePasswordDialog">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>
