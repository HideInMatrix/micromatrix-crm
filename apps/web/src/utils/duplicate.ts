import {
  DUPLICATE_SOURCE_LABELS,
  type DuplicateHitVO,
} from '@micromatrix/shared'

/** 有命中时弹窗确认是否继续；取消返回 false */
export async function confirmIfDuplicates(
  hits: DuplicateHitVO[],
  action: string,
): Promise<boolean> {
  if (hits.length === 0) return true
  const lines = hits.slice(0, 8).map((hit) => {
    const source = DUPLICATE_SOURCE_LABELS[hit.source]
    const name = hit.inScope ? (hit.name ?? '-') : '（不在你的数据范围内）'
    const owner = hit.ownerName ?? '-'
    return `${source}：${name} · 负责人 ${owner}`
  })
  const extra = hits.length > 8 ? `\n…共 ${hits.length} 条` : ''
  return ElMessageBox.confirm(
    `发现 ${hits.length} 条疑似重复，是否仍要${action}？\n\n${lines.join('\n')}${extra}`,
    '查重提示',
    { type: 'warning', confirmButtonText: `仍要${action}`, cancelButtonText: '取消' },
  )
    .then(() => true)
    .catch(() => false)
}
