import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import permission from './directives/permission'

createApp(App).use(router).directive('permission', permission).mount('#app')
