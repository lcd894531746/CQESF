<script setup>
import { loadingState } from './utils/loading'
</script>

<template>
  <RouterView />
  <div v-if="loadingState.count > 0" class="global-loading-mask">
    <div class="global-loading-box">
      <span class="global-loading-spinner"></span>
      <span>{{ loadingState.text }}</span>
    </div>
  </div>
</template>
