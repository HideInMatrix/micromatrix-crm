import { BadRequestException, Injectable } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import ExcelJS from 'exceljs'
import type { ImportType } from './dto/import-export.dto'

export interface ParsedSpreadsheetRow {
  rowNum: number
  resourceId?: string
  values: Record<string, unknown>
  errors: string[]
}

export interface SpreadsheetColumn {
  key: string
  label: string
}

@Injectable()
export class SpreadsheetService {
  async buildImportTemplate(
    fields: FieldVO[],
    importType: ImportType,
    options?: { excludeKeys?: string[] },
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('导入模板')
    const exportableFields = this.importFields(fields, options?.excludeKeys)
    const headers = [
      ...(importType === 'UPDATE' ? ['唯一ID'] : []),
      ...exportableFields.map((field) => field.label),
    ]

    sheet.addRow(headers)
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.getRow(1).font = { bold: true }
    sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(14, Math.min(28, header.length * 2 + 4)) }))

    const startColumn = importType === 'UPDATE' ? 2 : 1
    for (const [index, field] of exportableFields.entries()) {
      const columnNumber = startColumn + index
      const optionLabels = field.options?.map((item) => item.label).filter(Boolean) ?? []
      if (optionLabels.length > 0) {
        const formula = `"${optionLabels.join(',').replaceAll('"', '""')}"`
        if (formula.length <= 255) {
          for (let row = 2; row <= 501; row++) {
            sheet.getCell(row, columnNumber).dataValidation = {
              type: 'list',
              allowBlank: !field.required,
              formulae: [formula],
            }
          }
        }
      } else if (field.type === 'switch') {
        for (let row = 2; row <= 501; row++) {
          sheet.getCell(row, columnNumber).dataValidation = {
            type: 'list',
            allowBlank: !field.required,
            formulae: ['"是,否"'],
          }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
  }

  async parseImport(
    buffer: Buffer,
    fields: FieldVO[],
    importType: ImportType,
    options?: { excludeKeys?: string[] },
  ): Promise<ParsedSpreadsheetRow[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new BadRequestException('Excel 文件中没有可读取的工作表')

    const importFields = this.importFields(fields, options?.excludeKeys)
    const byLabel = new Map(importFields.map((field) => [field.label.trim(), field]))
    const byKey = new Map(importFields.map((field) => [field.key, field]))
    const headerRow = sheet.getRow(1)
    const headers = new Map<number, string>()
    const unknownHeaders: string[] = []
    let idColumn: number | null = null

    headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = this.cellText(cell.value).trim()
      if (!header) return
      if (header === '唯一ID') {
        idColumn = columnNumber
        headers.set(columnNumber, header)
        return
      }
      const field = byLabel.get(header) ?? byKey.get(header)
      if (!field) {
        unknownHeaders.push(header)
        return
      }
      headers.set(columnNumber, field.key)
    })

    if (unknownHeaders.length > 0) {
      throw new BadRequestException(`存在无法识别的表头：${unknownHeaders.join('、')}`)
    }
    if (importType === 'UPDATE' && idColumn === null) {
      throw new BadRequestException('导入更新必须包含「唯一ID」列')
    }

    const rows: ParsedSpreadsheetRow[] = []
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber)
      const hasValue = [...headers.keys()].some((column) => !this.isEmpty(row.getCell(column).value))
      if (!hasValue) continue

      const values: Record<string, unknown> = {}
      const errors: string[] = []
      const resourceId = idColumn === null ? undefined : this.cellText(row.getCell(idColumn).value).trim() || undefined
      if (importType === 'UPDATE' && !resourceId) errors.push('唯一ID不能为空')

      for (const [column, key] of headers.entries()) {
        if (key === '唯一ID') continue
        const field = byKey.get(key)
        if (!field) continue
        const raw = row.getCell(column).value
        if (this.isEmpty(raw)) {
          if (importType === 'ADD' && field.required) errors.push(`${field.label}不能为空`)
          continue
        }
        try {
          values[field.key] = this.parseFieldValue(field, raw)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `${field.label}格式不正确`)
        }
      }

      rows.push({ rowNum: rowNumber, resourceId, values, errors })
    }

    if (rows.length === 0) throw new BadRequestException('Excel 文件没有可导入的数据行')
    return rows
  }

  async buildExportWorkbook(columns: SpreadsheetColumn[], rows: Record<string, unknown>[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('导出数据')
    sheet.columns = columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: Math.max(14, Math.min(32, column.label.length * 2 + 6)),
    }))
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.getRow(1).font = { bold: true }
    for (const row of rows) {
      sheet.addRow(Object.fromEntries(columns.map((column) => [column.key, this.exportCellValue(row[column.key])])))
    }
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(columns.length).address }
    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
  }

  private importFields(fields: FieldVO[], excludeKeys: string[] = []) {
    const excluded = new Set(excludeKeys)
    return fields.filter((field) => !field.hidden && field.type !== 'formula' && !excluded.has(field.key))
  }

  private parseFieldValue(field: FieldVO, raw: unknown): unknown {
    const value = this.unwrapCellValue(raw)
    const text = this.cellText(value).trim()
    switch (field.type) {
      case 'number':
      case 'currency':
      case 'percent': {
        const number = typeof value === 'number' ? value : Number(text.replaceAll(',', ''))
        if (!Number.isFinite(number)) throw new Error(`${field.label}必须是数字`)
        return number
      }
      case 'switch': {
        if (typeof value === 'boolean') return value
        if (['是', 'true', '1', 'yes'].includes(text.toLowerCase())) return true
        if (['否', 'false', '0', 'no'].includes(text.toLowerCase())) return false
        throw new Error(`${field.label}必须填写“是”或“否”`)
      }
      case 'date':
      case 'datetime': {
        const date = value instanceof Date ? value : new Date(text)
        if (Number.isNaN(date.getTime())) throw new Error(`${field.label}日期格式不正确`)
        return date.toISOString()
      }
      case 'select':
      case 'radio': {
        const option = field.options?.find((item) => item.label === text || String(item.value) === text)
        if (!option && field.options?.length) throw new Error(`${field.label}不是有效选项`)
        return option?.value ?? text
      }
      case 'multiselect': {
        const values = text.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
        if (field.options?.length) {
          return values.map((item) => {
            const option = field.options?.find((candidate) => candidate.label === item || String(candidate.value) === item)
            if (!option) throw new Error(`${field.label}包含无效选项「${item}」`)
            return option.value
          })
        }
        return values
      }
      case 'checkbox': {
        if (field.options?.length) {
          const values = text.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
          return values.map((item) => {
            const option = field.options?.find((candidate) => candidate.label === item || String(candidate.value) === item)
            if (!option) throw new Error(`${field.label}包含无效选项「${item}」`)
            return option.value
          })
        }
        return text
      }
      case 'email':
        if (text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error(`${field.label}邮箱格式不正确`)
        return text
      default:
        return text
    }
  }

  private unwrapCellValue(value: unknown): unknown {
    if (!value || typeof value !== 'object' || value instanceof Date) return value
    const record = value as Record<string, unknown>
    if ('result' in record) return record.result
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((item) => (typeof item === 'object' && item && 'text' in item ? String((item as { text: unknown }).text) : ''))
        .join('')
    }
    if ('text' in record) return record.text
    return value
  }

  private cellText(value: unknown): string {
    const unwrapped = this.unwrapCellValue(value)
    if (unwrapped === undefined || unwrapped === null) return ''
    if (unwrapped instanceof Date) return unwrapped.toISOString()
    if (typeof unwrapped === 'object') return JSON.stringify(unwrapped)
    return String(unwrapped)
  }

  private isEmpty(value: unknown): boolean {
    return this.cellText(value).trim() === ''
  }

  private exportCellValue(value: unknown): string | number | boolean | Date | null {
    if (value === undefined || value === null) return null
    if (value instanceof Date) return value
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    if (Array.isArray(value)) return value.join('、')
    return JSON.stringify(value)
  }
}
