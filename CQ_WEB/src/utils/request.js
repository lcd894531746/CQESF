import axios from 'axios'
import { clearAuthStorage, getAuthToken } from '../constants/auth'
import { startLoading, stopLoading } from './loading'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

const request = axios.create({
  baseURL: API_BASE,
})

request.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  if (config.showLoading !== false) {
    startLoading(config.loadingText)
    config.__showGlobalLoading = true
  }
  return config
})

request.interceptors.response.use(
  (response) => {
    if (response.config.__showGlobalLoading) {
      stopLoading()
    }
    return response
  },
  (error) => {
    if (error.config?.__showGlobalLoading) {
      stopLoading()
    }
    if (error.response?.status === 401) {
      clearAuthStorage()
      if (window.location.hash !== '#/login') {
        window.location.hash = '#/login'
      }
    }
    return Promise.reject(error)
  }
)

export default request
