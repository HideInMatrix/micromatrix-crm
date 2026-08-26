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
  <div class="min-h-full flex flex-col gap-4 overflow-x-hidden">
    <el-card
      shadow="never"
      class="overflow-hidden rounded-1.5 [&_.el-card__body]:!px-5 [&_.el-card__body]:!py-0"
    >
      <el-tabs
        v-model="activeTab"
        class="[&_.el-tabs__header]:!m-0 [&_.el-tabs__content]:hidden [&_.el-tabs__nav-wrap]:!overflow-hidden [&_.el-tabs__nav-scroll]:!overflow-hidden [&_.el-tabs__nav-wrap::after]:!h-0"
      >
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
