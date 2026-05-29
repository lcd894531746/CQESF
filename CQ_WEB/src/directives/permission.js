import { getAuthRole, hasRoleAtMostLevel, normalizeRole } from '../constants/auth'

function hasPermission(value) {
  const permissions = Array.isArray(value) ? value : [value]
  const currentRole = getAuthRole()

  return permissions.some((permission) => {
    if (typeof permission === 'number') {
      return hasRoleAtMostLevel(permission)
    }

    const raw = String(permission || '').trim()
    if (!raw) return false

    if (raw === 'admin') return hasRoleAtMostLevel(1)
    if (raw === 'reviewer') return hasRoleAtMostLevel(2)
    if (raw === 'uploader') return hasRoleAtMostLevel(3)
    if (raw === 'sales') return normalizeRole(currentRole) === 'sales'

    return normalizeRole(raw) === currentRole
  })
}

export default {
  mounted(el, binding) {
    if (!hasPermission(binding.value)) {
      el.remove()
    }
  },
  updated(el, binding) {
    if (!hasPermission(binding.value)) {
      el.remove()
    }
  },
}
