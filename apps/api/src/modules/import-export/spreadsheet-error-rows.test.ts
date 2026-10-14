import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import ExcelJS from 'exceljs'
import { SpreadsheetService } from './spreadsheet.service'

async function loadWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  return workbook
}

test('导出检验失败的原始行：保留全部表头、源字段、数据类型、格式和源行顺序', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('原始线索')
  sheet.columns = [
    { header: '姓名', key: 'name', width: 18 },
    { header: '联系电话', key: 'phone', width: 26 },
    { header: '自定义字段', key: 'custom', width: 20 },
    { header: '备注', key: 'note', width: 32 },
  ]
  sheet.addRow(['正确数据', '13800000001', '高一', '应该排除'])
  sheet.addRow([null, 13800000002, '高二', '第3行保留数值类型'])
  sheet.getCell('B3').numFmt = '00000000000'
  sheet.getCell('C3').dataValidation = {
    type: 'list',
    formulae: ['"高一,高二"'],
  }
  sheet.addRow(['正常数据', '13800000004', '高三', '应该排除'])
  sheet.addRow(['重复线索', '13800000005', '高一', '第5行保留完整备注'])
  sheet.getCell('A1').font = { bold: true }

  const original = Buffer.from(await workbook.xlsx.writeBuffer())
  const result = await new SpreadsheetService().extractErrorRowsXlsx(original, [5, 3, 5])
  const output = await loadWorkbook(result)
  const source = (await loadWorkbook(original)).worksheets[0]!
  const target = output.worksheets[0]!

  assert.equal(target.name, '错误数据')
  assert.equal(target.rowCount, 3)
  assert.deepEqual(target.getRow(1).values, source.getRow(1).values)
  assert.deepEqual(target.getRow(2).values, source.getRow(3).values)
  assert.deepEqual(target.getRow(3).values, source.getRow(5).values)
  assert.equal(target.getCell('B2').value, 13800000002)
  assert.equal(target.getCell('B2').numFmt, '00000000000')
  assert.equal(target.getCell('C2').dataValidation.type, 'list')
  assert.equal(target.getCell('D3').value, '第5行保留完整备注')
  assert.equal(target.getColumn(2).width, 26)
  assert.equal(target.getCell('A1').font.bold, true)
  assert.equal(target.views[0]?.state, 'frozen')
})

test('拒绝无效、越界或为空的异常行号', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('导入数据')
  sheet.addRow(['姓名', '电话'])
  sheet.addRow(['张三', '13800000001'])
  const original = Buffer.from(await workbook.xlsx.writeBuffer())
  const service = new SpreadsheetService()

  for (const numbers of [[], [0], [1], [3], [2.5], [Number.NaN], [1_048_577]]) {
    await assert.rejects(service.extractErrorRowsXlsx(original, numbers), BadRequestException)
  }
})

test('客户、联系人等共享错误行下载接口只接受 JSON 数字行号数组', () => {
  const spreadsheet = new SpreadsheetService()
  assert.deepEqual(spreadsheet.parseErrorRowNumbers('[3,5,3]'), [3, 5, 3])
  for (const input of ['nope', '{}', 'null', '["3"]', '[3,null]', '[true]', '3']) {
    assert.throws(() => spreadsheet.parseErrorRowNumbers(input), BadRequestException)
  }
})
