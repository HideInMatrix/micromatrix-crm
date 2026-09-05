<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import UiSettingsPanel from './components/UiSettingsPanel.vue'
import ThirdPartySettingsPanel from './components/ThirdPartySettingsPanel.vue'
import MailSettingsPanel from './components/MailSettingsPanel.vue'
import AiModelSettingsPanel from './components/AiModelSettingsPanel.vue'
import TermSettingsPanel from './components/TermSettingsPanel.vue'
import GlobalTaskSettingsPanel from './components/GlobalTaskSettingsPanel.vue'

const route = useRoute()
const activeSection = computed(() => {
  if (route.path.endsWith('/third-party')) return 'thirdParty'
  if (route.path.endsWith('/mail')) return 'mail'
  if (route.path.endsWith('/models')) return 'models'
  if (route.path.endsWith('/terms')) return 'terms'
  if (route.path.endsWith('/global-tasks')) return 'globalTasks'
  return 'ui'
})
</script>

<template>
  <div class="min-h-full overflow-x-hidden">
    <UiSettingsPanel v-if="activeSection === 'ui'" />
    <ThirdPartySettingsPanel v-else-if="activeSection === 'thirdParty'" />
    <MailSettingsPanel v-else-if="activeSection === 'mail'" />
    <AiModelSettingsPanel v-else-if="activeSection === 'models'" />
    <TermSettingsPanel v-else-if="activeSection === 'terms'" />
    <GlobalTaskSettingsPanel v-else-if="activeSection === 'globalTasks'" />
  </div>
</template>
