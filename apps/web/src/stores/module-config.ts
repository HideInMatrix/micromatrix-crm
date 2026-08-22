import {
  NAVIGATION_MODULES,
  TOP_NAVIGATION_DEFINITIONS,
  type ModuleConfigVO,
  type NavigationModuleKey,
  type TopNavigationConfigVO,
  type TopNavigationKey,
} from '@micromatrix/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { moduleConfigApi } from '@/api/system'

export const useModuleConfigStore = defineStore('module-config', () => {
  const configs = ref<ModuleConfigVO[]>([])
  const topNavigationConfigs = ref<TopNavigationConfigVO[]>([])
  const loaded = ref(false)
  let loading: Promise<void> | null = null

  async function load(force = false) {
    if (loaded.value && !force) return
    if (loading && !force) return loading

    loading = Promise.all([moduleConfigApi.list(), moduleConfigApi.listTopNavigation()])
      .then(([modules, topNavigation]) => {
        configs.value = modules.data
        topNavigationConfigs.value = topNavigation.data
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

  function topNavigationDefinition(navigationKey: TopNavigationKey) {
    return TOP_NAVIGATION_DEFINITIONS.find((item) => item.key === navigationKey)
  }

  function topNavigationOrderOf(navigationKey: TopNavigationKey) {
    const config = topNavigationConfigs.value.find((item) => item.navigationKey === navigationKey)
    return (
      config?.sort ?? TOP_NAVIGATION_DEFINITIONS.findIndex((item) => item.key === navigationKey) + 1
    )
  }

  function isTopNavigationEnabled(navigationKey: TopNavigationKey) {
    const config = topNavigationConfigs.value.find((item) => item.navigationKey === navigationKey)
    return config?.enabled ?? topNavigationDefinition(navigationKey)?.defaultEnabled ?? false
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

  async function reorderTopNavigation(navigationKeys: TopNavigationKey[]) {
    const { data } = await moduleConfigApi.reorderTopNavigation(navigationKeys)
    topNavigationConfigs.value = data
  }

  function reset() {
    configs.value = []
    topNavigationConfigs.value = []
    loaded.value = false
    loading = null
  }

  return {
    configs,
    topNavigationConfigs,
    loaded,
    load,
    isEnabled,
    orderOf,
    update,
    reorder,
    topNavigationOrderOf,
    isTopNavigationEnabled,
    reorderTopNavigation,
    reset,
  }
})
