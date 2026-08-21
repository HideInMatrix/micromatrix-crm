import {
  NAVIGATION_MODULES,
  type ModuleConfigVO,
  type NavigationModuleKey,
} from '@micromatrix/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { moduleConfigApi } from '@/api/system'

export const useModuleConfigStore = defineStore('module-config', () => {
  const configs = ref<ModuleConfigVO[]>([])
  const loaded = ref(false)
  let loading: Promise<void> | null = null

  async function load(force = false) {
    if (loaded.value && !force) return
    if (loading && !force) return loading

    loading = moduleConfigApi
      .list()
      .then(({ data }) => {
        configs.value = data
        loaded.value = true
      })
      .finally(() => {
        loading = null
      })
    return loading
  }

  function definition(moduleKey: NavigationModuleKey) {
    return NAVIGATION_MODULES.find((item) => item.key === moduleKey)
  }

  function isEnabled(moduleKey: NavigationModuleKey) {
    const config = configs.value.find((item) => item.moduleKey === moduleKey)
    return config?.enabled ?? definition(moduleKey)?.defaultEnabled ?? false
  }

  function orderOf(moduleKey: NavigationModuleKey) {
    const config = configs.value.find((item) => item.moduleKey === moduleKey)
    return config?.sort ?? NAVIGATION_MODULES.findIndex((item) => item.key === moduleKey)
  }

  async function update(moduleKey: NavigationModuleKey, enabled: boolean) {
    const { data } = await moduleConfigApi.update(moduleKey, enabled)
    const index = configs.value.findIndex((item) => item.moduleKey === moduleKey)
    if (index >= 0) configs.value[index] = data
    else configs.value.push(data)
    return data
  }

  async function reorder(moduleKeys: NavigationModuleKey[]) {
    const { data } = await moduleConfigApi.reorder(moduleKeys)
    configs.value = data
  }

  function reset() {
    configs.value = []
    loaded.value = false
    loading = null
  }

  return { configs, loaded, load, isEnabled, orderOf, update, reorder, reset }
})
