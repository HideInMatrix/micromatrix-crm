<script setup lang="ts">
import { lineAmount, type LineItemVO, type ProductVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { productApi } from '@/api/deal'

const items = defineModel<LineItemVO[]>({ required: true })
const props = defineProps<{ readonly?: boolean }>()

const products = ref<ProductVO[]>([])

const total = computed(() =>
  Math.round(items.value.reduce((sum, item) => sum + itemAmount(item), 0) * 100) / 100,
)

function itemAmount(item: LineItemVO): number {
  return lineAmount(item)
}

function addRow() {
  items.value.push({
    productId: null,
    productName: '',
    unit: null,
    quantity: 1,
    unitPrice: 0,
    discount: 100,
    amount: 0,
  })
}

function removeRow(index: number) {
  items.value.splice(index, 1)
}

/** 选择产品自动带出名称/单位/单价 */
function handleProductSelect(item: LineItemVO, productId: string | null) {
  item.productId = productId
  const product = products.value.find((p) => p.id === productId)
  if (product) {
    item.productName = product.name
    item.unit = product.unit
    item.unitPrice = product.price
  }
}

onMounted(async () => {
  const { data } = await productApi.list({ page: 1, pageSize: 100, status: 'ON' })
  products.value = data.items
})
</script>

<template>
  <div class="w-full">
    <div
      class="grid grid-cols-[1fr_90px_110px_90px_110px_50px] gap-2 text-xs text-[var(--el-text-color-secondary)] px-1 pb-1"
    >
      <span>产品/项目</span>
      <span>数量</span>
      <span>单价</span>
      <span>折扣%</span>
      <span>金额</span>
      <span />
    </div>

    <div
      v-for="(item, index) in items"
      :key="index"
      class="grid grid-cols-[1fr_90px_110px_90px_110px_50px] gap-2 items-center mb-2"
    >
      <div class="flex gap-1">
        <el-select
          :model-value="item.productId ?? undefined"
          filterable
          clearable
          placeholder="选产品"
          class="!w-28 shrink-0"
          :disabled="props.readonly"
          @update:model-value="handleProductSelect(item, $event || null)"
        >
          <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-input
          v-model="item.productName"
          placeholder="或输入名称"
          :disabled="props.readonly"
        />
      </div>
      <el-input-number
        v-model="item.quantity"
        :min="0"
        :precision="2"
        :controls="false"
        :disabled="props.readonly"
        class="!w-full"
      />
      <el-input-number
        v-model="item.unitPrice"
        :min="0"
        :precision="2"
        :controls="false"
        :disabled="props.readonly"
        class="!w-full"
      />
      <el-input-number
        v-model="item.discount"
        :min="0"
        :max="100"
        :precision="0"
        :controls="false"
        :disabled="props.readonly"
        class="!w-full"
      />
      <div class="text-sm text-right pr-1">¥{{ itemAmount(item).toLocaleString('zh-CN') }}</div>
      <el-button
        v-if="!props.readonly"
        link
        type="danger"
        @click="removeRow(index)"
      >
        删
      </el-button>
    </div>

    <div class="flex-between mt-2">
      <el-button v-if="!props.readonly" link type="primary" @click="addRow">+ 添加明细行</el-button>
      <span v-else />
      <span class="text-sm">
        合计：<span class="font-bold text-[var(--el-color-danger)]">¥{{ total.toLocaleString('zh-CN') }}</span>
      </span>
    </div>
  </div>
</template>
