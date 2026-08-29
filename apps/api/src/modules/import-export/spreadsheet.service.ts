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

export interface ParsedSubTableSpreadsheetRow {
  rowNum: number
  resourceId?: string
  values: Record<string, unknown>
  subValues: Record<string, unknown>
  errors: string[]
}

export interface SubTableExportGroup {
  values: Record<string, unknown>
  subRows: Record<string, unknown>[]
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

  async buildSubTableImportTemplate(
    mainFields: FieldVO[],
    subFields: FieldVO[],
    importType: ImportType,
    parentLabel: string,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('导入模板')
    const masters = this.importFields(mainFields)
    const children = subFields.filter((field) => !['formula', 'picture'].includes(field.type))
    let column = 1

    if (importType === 'UPDATE') {
      sheet.mergeCells(1, column, 2, column)
      sheet.getCell(1, column).value = '唯一ID'
      sheet.getColumn(column).width = 24
      column++
    }

    for (const field of masters) {
      sheet.mergeCells(1, column, 2, column)
      sheet.getCell(1, column).value = field.label
      sheet.getColumn(column).width = Math.max(14, Math.min(28, field.label.length * 2 + 4))
      this.applyDataValidation(sheet, field, column, 3)
      column++
    }

    const subStart = column
    for (const field of children) {
      sheet.getCell(2, column).value = field.label
      sheet.getColumn(column).width = Math.max(14, Math.min(28, field.label.length * 2 + 4))
      this.applyDataValidation(sheet, field, column, 3)
      column++
    }
    if (children.length > 0) {
      sheet.mergeCells(1, subStart, 1, column - 1)
      sheet.getCell(1, subStart).value = parentLabel
    }

    sheet.views = [{ state: 'frozen', ySplit: 2 }]
    for (const rowNumber of [1, 2]) {
      const row = sheet.getRow(rowNumber)
      row.font = { bold: true }
      row.alignment = { vertical: 'middle', horizontal: 'center' }
    }
    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
  }

  async parseSubTableImport(
    buffer: Buffer,
    mainFields: FieldVO[],
    subFields: FieldVO[],
    importType: ImportType,
    parentLabel: string,
  ): Promise<ParsedSubTableSpreadsheetRow[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new BadRequestException('Excel 文件中没有可读取的工作表')

    const masters = this.importFields(mainFields)
    const children = subFields.filter((field) => !['formula', 'picture'].includes(field.type))
    const mainByLabel = new Map(masters.map((field) => [field.label.trim(), field]))
    const mainByKey = new Map(masters.map((field) => [field.key, field]))
    const subByLabel = new Map(children.map((field) => [field.label.trim(), field]))
    const subByKey = new Map(children.map((field) => [field.key, field]))
    const columns = new Map<number, { kind: 'id' | 'main' | 'sub'; key: string }>()
    const unknownHeaders = new Set<string>()
    let idColumn: number | null = null

    for (let column = 1; column <= sheet.columnCount; column++) {
      const top = this.cellText(sheet.getCell(1, column).value).trim()
      const bottom = this.cellText(sheet.getCell(2, column).value).trim()
      if (top === '唯一ID' || bottom === '唯一ID') {
        idColumn = column
        columns.set(column, { kind: 'id', key: '唯一ID' })
        continue
      }
      const child = subByLabel.get(bottom) ?? subByKey.get(bottom)
      if (child) {
        columns.set(column, { kind: 'sub', key: child.key })
        continue
      }
      const master =
        mainByLabel.get(top) ?? mainByKey.get(top) ?? mainByLabel.get(bottom) ?? mainByKey.get(bottom)
      if (master) {
        columns.set(column, { kind: 'main', key: master.key })
        continue
      }
      for (const header of [top, bottom]) {
        if (header && header !== parentLabel) unknownHeaders.add(header)
      }
    }

    if (unknownHeaders.size > 0) {
      throw new BadRequestException(`存在无法识别的表头：${[...unknownHeaders].join('、')}`)
    }
    if (importType === 'UPDATE' && idColumn === null) {
      throw new BadRequestException('导入更新必须包含「唯一ID」列')
    }

    const rows: ParsedSubTableSpreadsheetRow[] = []
    for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber)
      if (![...columns.keys()].some((item) => !this.isEmpty(row.getCell(item).value))) continue
      const values: Record<string, unknown> = {}
      const subValues: Record<string, unknown> = {}
      const errors: string[] = []
      const resourceId = idColumn === null ? undefined : this.cellText(row.getCell(idColumn).value).trim() || undefined

      for (const [column, meta] of columns) {
        if (meta.kind === 'id') continue
        const field = meta.kind === 'main' ? mainByKey.get(meta.key) : subByKey.get(meta.key)
        if (!field) continue
        const raw = row.getCell(column).value
        if (this.isEmpty(raw)) continue
        try {
          const value = this.parseFieldValue(field, raw)
          if (meta.kind === 'main') values[field.key] = value
          else subValues[field.key] = value
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `${field.label}格式不正确`)
        }
      }
      rows.push({ rowNum: rowNumber, resourceId, values, subValues, errors })
    }
    if (rows.length === 0) throw new BadRequestException('Excel 文件没有可导入的数据行')
    return rows
  }

  async buildSubTableExportWorkbook(
    mainColumns: SpreadsheetColumn[],
    subColumns: SpreadsheetColumn[],
    groups: SubTableExportGroup[],
    parentLabel: string,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('导出数据')
    let column = 1
    for (const item of mainColumns) {
      sheet.mergeCells(1, column, 2, column)
      sheet.getCell(1, column).value = item.label
      sheet.getColumn(column).width = Math.max(14, Math.min(32, item.label.length * 2 + 6))
      column++
    }
    const subStart = column
    for (const item of subColumns) {
      sheet.getCell(2, column).value = item.label
      sheet.getColumn(column).width = Math.max(14, Math.min(32, item.label.length * 2 + 6))
      column++
    }
    if (subColumns.length > 0) {
      sheet.mergeCells(1, subStart, 1, column - 1)
      sheet.getCell(1, subStart).value = parentLabel
    }
    sheet.views = [{ state: 'frozen', ySplit: 2 }]
    for (const rowNumber of [1, 2]) {
      const row = sheet.getRow(rowNumber)
      row.font = { bold: true }
      row.alignment = { vertical: 'middle', horizontal: 'center' }
    }

    let rowNumber = 3
    for (const group of groups) {
      const subRows = group.subRows.length > 0 ? group.subRows : [{}]
      const start = rowNumber
      for (const subRow of subRows) {
        let dataColumn = 1
        if (rowNumber === start) {
          for (const item of mainColumns) {
            sheet.getCell(rowNumber, dataColumn).value = this.exportCellValue(group.values[item.key])
            dataColumn++
          }
        } else {
          dataColumn += mainColumns.length
        }
        for (const item of subColumns) {
          sheet.getCell(rowNumber, dataColumn).value = this.exportCellValue(subRow[item.key])
          dataColumn++
        }
        rowNumber++
      }
      if (subRows.length > 1) {
        const end = rowNumber - 1
        for (let mainColumn = 1; mainColumn <= mainColumns.length; mainColumn++) {
          sheet.mergeCells(start, mainColumn, end, mainColumn)
          sheet.getCell(start, mainColumn).alignment = { vertical: 'middle' }
        }
      }
    }
    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
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
    return fields.filter(
      (field) =>
        !field.hidden &&
        field.type !== 'formula' &&
        field.type !== 'picture' &&
        !excluded.has(field.key),
    )
  }

  private applyDataValidation(
    sheet: ExcelJS.Worksheet,
    field: FieldVO,
    columnNumber: number,
    startRow: number,
  ) {
    const optionLabels = field.options?.map((item) => item.label).filter(Boolean) ?? []
    const formula =
      optionLabels.length > 0
        ? `"${optionLabels.join(',').replaceAll('"', '""')}"`
        : field.type === 'switch'
          ? '"是,否"'
          : null
    if (!formula || formula.length > 255) return
    for (let row = startRow; row < startRow + 500; row++) {
      sheet.getCell(row, columnNumber).dataValidation = {
        type: 'list',
        allowBlank: !field.required,
        formulae: [formula],
      }
    }
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
