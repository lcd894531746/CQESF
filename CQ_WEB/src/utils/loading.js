import { reactive } from 'vue'

export const loadingState = reactive({
  count: 0,
  text: '加载中...',
})

export function startLoading(text = '加载中...') {
  loadingState.count += 1
  loadingState.text = text
}

export function stopLoading() {
  loadingState.count = Math.max(loadingState.count - 1, 0)
  if (loadingState.count === 0) {
    loadingState.text = '加载中...'
  }
}
