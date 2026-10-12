<script setup lang="ts">
import CrmInfoAlert from '@/components/CrmInfoAlert.vue'

const currentPassword = defineModel<string>('currentPassword', { required: true })
const newPassword = defineModel<string>('newPassword', { required: true })
const confirmPassword = defineModel<string>('confirmPassword', { required: true })
</script>

<template>
  <div class="password-form-fields">
    <CrmInfoAlert>如忘记密码，请企微扫码登录或联系上海公司。</CrmInfoAlert>

    <el-form
      class="password-form mx-auto mt-5 w-[312px] max-w-full"
      label-position="right"
      label-width="92px"
    >
      <el-form-item label="当前密码" required>
        <el-input
          v-model="currentPassword"
          class="!w-[220px]"
          type="password"
          show-password
          autocomplete="current-password"
          placeholder="请输入当前密码"
        />
      </el-form-item>
      <el-form-item label="新密码" required>
        <el-input
          v-model="newPassword"
          class="!w-[220px]"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="请输入新密码"
        />
      </el-form-item>
      <el-form-item label="确认新密码" required>
        <el-input
          v-model="confirmPassword"
          class="!w-[220px]"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="请再次输入新密码"
        />
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.password-form :deep(.el-form-item__label) {
  justify-content: flex-end;
  padding-right: 4px;
  height: 38px;
  line-height: 38px;
  text-align: right;
  font-size: 14px;
  color: #333333;
}

.password-form :deep(.el-input__wrapper) {
  height: 38px;
  border: 1px solid #e4e7ed;
  box-shadow: none;
}

.password-form :deep(.el-input__wrapper:hover) {
  box-shadow: none;
}

.password-form :deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none;
}
</style>
