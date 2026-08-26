<script setup lang="ts">
import { ref } from 'vue'
import UiSettingsPanel from './enterprise-settings/UiSettingsPanel.vue'
import ThirdPartySettingsPanel from './enterprise-settings/ThirdPartySettingsPanel.vue'
import MailSettingsPanel from './enterprise-settings/MailSettingsPanel.vue'
import AiModelSettingsPanel from './enterprise-settings/AiModelSettingsPanel.vue'
import TermSettingsPanel from './enterprise-settings/TermSettingsPanel.vue'
import GlobalTaskSettingsPanel from './enterprise-settings/GlobalTaskSettingsPanel.vue'

const activeTab = ref('pageSettings')
</script>

<template>
  <div class="enterprise-settings-page">
    <el-card shadow="never" class="tabs-card">
      <el-tabs v-model="activeTab" class="settings-tabs">
        <el-tab-pane label="界面设置" name="pageSettings" />
        <el-tab-pane label="第三方" name="syncOrganization" />
        <el-tab-pane label="邮件设置" name="mailSettings" />
        <el-tab-pane label="模型设置" name="modelSettings" />
        <el-tab-pane label="术语设置" name="termSettings" />
        <el-tab-pane label="全局任务" name="globalTask" />
      </el-tabs>
    </el-card>

    <UiSettingsPanel v-if="activeTab === 'pageSettings'" />
    <ThirdPartySettingsPanel v-else-if="activeTab === 'syncOrganization'" />
    <MailSettingsPanel v-else-if="activeTab === 'mailSettings'" />
    <AiModelSettingsPanel v-else-if="activeTab === 'modelSettings'" />
    <TermSettingsPanel v-else-if="activeTab === 'termSettings'" />
    <GlobalTaskSettingsPanel v-else-if="activeTab === 'globalTask'" />
  </div>
</template>

<style scoped>
.enterprise-settings-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tabs-card {
  border-radius: 6px;
}

.tabs-card :deep(.el-card__body) {
  padding: 0 20px;
}

.settings-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.settings-tabs :deep(.el-tabs__content) {
  display: none;
}

.settings-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 0;
}
</style>
