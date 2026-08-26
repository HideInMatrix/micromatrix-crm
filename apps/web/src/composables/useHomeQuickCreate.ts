import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 首页快捷入口跨页复用业务模块原有新增表单。
 * create/from 查询参数只消费一次；新增成功后回首页，由首页重新加载真实统计。
 */
export function useHomeQuickCreate() {
  const route = useRoute()
  const router = useRouter()
  const returnHomeAfterCreate = ref(false)

  async function consume(openCreate: () => void) {
    if (route.query.create !== '1') return false
    returnHomeAfterCreate.value = route.query.from === 'home'
    const query = { ...route.query }
    delete query.create
    delete query.from
    await router.replace({ path: route.path, query })
    openCreate()
    return true
  }

  async function completeCreated() {
    if (!returnHomeAfterCreate.value) return false
    returnHomeAfterCreate.value = false
    await router.push('/dashboard')
    return true
  }

  return { consume, completeCreated }
}
