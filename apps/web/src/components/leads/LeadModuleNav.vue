<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ active: 'lead' | 'pool' }>()

const auth = useAuthStore()
const router = useRouter()

function navigate(name: string | number) {
  if (name === props.active) return
  if (name === 'pool') {
    if (auth.hasPerm('leadPool:read')) void router.push('/leads/pool')
    return
  }
  if (name === 'lead') void router.push('/leads')
}
</script>

<template>
  <el-tabs :model-value="active" @tab-change="navigate">
    <el-tab-pane label="线索" name="lead" />
    <el-tab-pane v-if="auth.hasPerm('leadPool:read')" label="线索池" name="pool" />
  </el-tabs>
</template>
