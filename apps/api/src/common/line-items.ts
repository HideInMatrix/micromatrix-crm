import { lineAmount } from '@micromatrix/shared'
import { LineItemDto } from './dto/line-item.dto'

export function normalizeLineItems(items: LineItemDto[]) {
  const rows = items.map((item, index) => {
    const discount = item.discount ?? 100
    return {
      productId: item.productId ?? null,
      productName: item.productName,
      unit: item.unit ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount,
      amount: lineAmount({ quantity: item.quantity, unitPrice: item.unitPrice, discount }),
      sort: index,
    }
  })
  const total = Math.round(rows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100
  return { rows, total }
}
