import 'dotenv/config'
import assert from 'node:assert/strict'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { ConfigService } from '@nestjs/config'
import ExcelJS from 'exceljs'
import { promises as fs } from 'node:fs'
import type { AuthUser } from '../src/common/auth-user'
import type { PrismaService } from '../src/prisma/prisma.service'
import { ExportTasksService } from '../src/modules/import-export/export-tasks.service'
import { SpreadsheetService } from '../src/modules/import-export/spreadsheet.service'
import { MetadataService } from '../src/modules/metadata/metadata.service'
import { ModuleFormsService } from '../src/modules/metadata/module-forms.service'
import { ResourceFieldValueService } from '../src/modules/metadata/resource-field-value.service'
import { ProductPriceFieldsService } from '../src/modules/products/product-price-fields.service'
import { ProductPriceService } from '../src/modules/products/product-price.service'
import { ProductsService } from '../src/modules/products/products.service'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! })
const prisma = new PrismaClient({ adapter })
const db = prisma as unknown as PrismaService
const moduleForms = new ModuleFormsService(db)
const metadata = new MetadataService(moduleForms)
const fieldValues = new ResourceFieldValueService(db, moduleForms)
const priceFields = new ProductPriceFieldsService(db, moduleForms)
const spreadsheet = new SpreadsheetService()
const exportTasks = new ExportTasksService(
  db,
  spreadsheet,
  new ConfigService({ UPLOAD_DIR: '/tmp/mmx-w361-product-price-smoke' }),
)
const products = new ProductsService(
  db,
  metadata,
  moduleForms,
  fieldValues,
  spreadsheet,
  exportTasks,
)
const prices = new ProductPriceService(
  db,
  metadata,
  moduleForms,
  fieldValues,
  priceFields,
  spreadsheet,
  exportTasks,
)

const prefix = `W361_PRODUCT_PRICE_SMOKE_${Date.now()}`
const cleanupProductIds: string[] = []
const cleanupPriceIds: string[] = []
const cleanupExportTaskIds: string[] = []

async function main() {
  const actor = await prisma.user.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tenantId: true, email: true, name: true, deptId: true, leaderId: true },
  })
  assert(actor, '需要至少一个 ACTIVE 用户才能执行产品/价格表 Smoke')
  const user: AuthUser = { ...actor, roles: [], permissions: ['*'] }

  const productForm = await products.getModuleForm(user)
  const descriptionField = productForm.fields.find((field) => field.key === 'description')
  const pictureField = productForm.fields.find((field) => field.key === 'productPic')
  assert(descriptionField && !descriptionField.system, '产品描述必须使用 product_field/blob 动态字段')
  assert(pictureField && pictureField.type === 'picture' && !pictureField.system, '产品图片必须是动态 PICTURE 字段')
  const productTemplate = await products.importTemplate(user, 'ADD')
  const productTemplateBook = new ExcelJS.Workbook()
  await productTemplateBook.xlsx.load(
    productTemplate.data as unknown as Parameters<typeof productTemplateBook.xlsx.load>[0],
  )
  const productTemplateHeaders = productTemplateBook.worksheets[0]?.getRow(1).values ?? []
  assert(!productTemplateHeaders.includes('产品图片'), 'Cordys PICTURE 字段不能进入产品 Excel 导入模板')

  const productA = await products.add(user, {
    name: `${prefix}_PRODUCT_A`,
    price: 123.45,
    status: '1',
    moduleFields: [
      { fieldId: descriptionField.id, fieldValue: '产品描述 A' },
      { fieldId: pictureField.id, fieldValue: ['smoke-picture-a', 'smoke-picture-b'] },
    ],
  })
  cleanupProductIds.push(productA.id)
  assert.equal(productA.status, '1')
  assert.equal(productA.customData['description'], '产品描述 A')
  assert.deepEqual(productA.customData['productPic'], ['smoke-picture-a', 'smoke-picture-b'])
  const pictureBlob = await prisma.productFieldBlob.findFirst({
    where: { resourceId: productA.id, fieldId: pictureField.id },
  })
  assert(pictureBlob, '产品图片必须写入 product_field_blob')
  await assert.rejects(
    () =>
      products.exportSelected(user, {
        fileName: `${prefix}_PICTURE_EXPORT_REJECT`,
        headList: ['productPic'],
        ids: [productA.id],
      }),
    /不存在或不可导出/,
    'Cordys PICTURE 字段不能被产品导出 API 绕过 UI 选择',
  )

  const productB = await products.add(user, {
    name: `${prefix}_PRODUCT_B`,
    price: 456.78,
    status: '2',
  })
  cleanupProductIds.push(productB.id)

  const productPage = await products.page(user, { current: 1, pageSize: 50, status: '1' })
  assert(productPage.list.some((item) => item.id === productA.id), '产品分页应返回上架产品')
  assert(!productPage.list.some((item) => item.id === productB.id), '产品状态筛选必须生效')

  const updatedProductA = await products.update(user, {
    id: productA.id,
    price: 222.22,
    status: '2',
    moduleFields: [{ fieldId: descriptionField.id, fieldValue: '产品描述 A2' }],
  })
  assert.equal(updatedProductA.price, 222.22)
  assert.equal(updatedProductA.customData['description'], '产品描述 A2')

  const statusField = productForm.fields.find((field) => field.key === 'status')
  assert(statusField, '产品状态字段必须存在')
  await products.batchUpdate(user, {
    ids: [productA.id, productB.id],
    fieldId: statusField.id,
    fieldValue: '1',
  })
  assert.equal((await products.get(user, productB.id)).status, '1')

  await products.editPos(user, {
    dragNodeId: productB.id,
    dropNodeId: productA.id,
    dropPosition: -1,
  })
  const sortedProducts = await prisma.product.findMany({
    where: { id: { in: [productA.id, productB.id] } },
    orderBy: { pos: 'asc' },
    select: { id: true },
  })
  assert.equal(sortedProducts[0]?.id, productB.id, '产品拖拽排序必须落库')

  const priceForm = await prices.getModuleForm(user)
  const remarkField = priceForm.fields.find((field) => field.key === 'remark')
  assert(remarkField && !remarkField.system, '价格表备注必须使用 product_price_field/blob')

  const priceA = await prices.add(user, {
    name: `${prefix}_PRICE_A`,
    status: '1',
    moduleFields: [{ fieldId: remarkField.id, fieldValue: '价格表备注 A' }],
    products: [
      {
        product: productA.id,
        amount: 199.99,
        values: { priceProductSku: 'SKU-A', priceProductTax: 6.5 },
      },
    ],
  })
  cleanupPriceIds.push(priceA.id)
  assert.equal(priceA.customData['remark'], '价格表备注 A')
  assert.equal(priceA.products.length, 1)
  assert.equal(priceA.products[0]?.productId, productA.id)
  assert.equal(priceA.products[0]?.amount, 199.99)
  assert.equal(priceA.products[0]?.values['priceProductSku'], 'SKU-A')

  const updatedPrice = await prices.update(user, {
    id: priceA.id,
    status: '2',
    moduleFields: [{ fieldId: remarkField.id, fieldValue: '价格表备注 A2' }],
    products: [
      {
        product: productB.id,
        amount: 299.88,
        values: { priceProductSku: 'SKU-B', priceProductTax: 9 },
      },
    ],
  })
  assert.equal(updatedPrice.status, '2')
  assert.equal(updatedPrice.products[0]?.productId, productB.id)
  assert.equal(updatedPrice.products[0]?.amount, 299.88)

  const copiedPrice = await prices.copy(user, priceA.id)
  cleanupPriceIds.push(copiedPrice.id)
  assert.notEqual(copiedPrice.id, priceA.id)
  assert(copiedPrice.name.startsWith(`${prefix}_PRICE_A_copy_`), '复制价格表名称应带 Cordys copy 后缀')
  assert.equal(copiedPrice.products[0]?.productId, productB.id)

  const priceStatusField = priceForm.fields.find((field) => field.key === 'status')
  assert(priceStatusField, '价格表状态字段必须存在')
  await prices.batchUpdate(user, {
    ids: [priceA.id, copiedPrice.id],
    fieldId: priceStatusField.id,
    fieldValue: '1',
  })
  assert.equal((await prices.get(user, copiedPrice.id)).status, '1')

  await prices.editPos(user, {
    dragNodeId: copiedPrice.id,
    dropNodeId: priceA.id,
    dropPosition: -1,
  })
  const sortedPrices = await prisma.productPrice.findMany({
    where: { id: { in: [priceA.id, copiedPrice.id] } },
    orderBy: { pos: 'asc' },
    select: { id: true },
  })
  assert.equal(sortedPrices[0]?.id, copiedPrice.id, '价格表拖拽排序必须落库')

  const pricePage = await prices.page(user, { current: 1, pageSize: 50, keyword: prefix })
  assert(pricePage.list.some((item) => item.id === priceA.id))
  assert(pricePage.list.some((item) => item.id === copiedPrice.id))

  const subCells = await prisma.productPriceField.findMany({
    where: { resourceId: priceA.id, refSubId: { not: null }, rowId: { not: null }, bizId: { not: null } },
  })
  assert(subCells.length >= 2, '价格表产品信息必须按 SUB_PRODUCT cell 存入 product_price_field')

  const importName = `${prefix}_PRICE_IMPORT`
  const importTemplate = await prices.importTemplate(user, 'ADD')
  const importBook = new ExcelJS.Workbook()
  await importBook.xlsx.load(importTemplate.data as unknown as Parameters<typeof importBook.xlsx.load>[0])
  const importSheet = importBook.worksheets[0]
  assert(importSheet, '价格表导入模板必须包含数据工作表')
  assert.equal(importSheet.getCell('D1').text, '产品信息', '价格表模板必须包含 SUB_PRODUCT 一级表头')
  assert.equal(importSheet.getCell('D2').text, '产品', '价格表模板必须包含产品二级表头')
  const header = new Map<string, number>()
  for (let column = 1; column <= importSheet.columnCount; column++) {
    const first = importSheet.getCell(1, column).text.trim()
    const second = importSheet.getCell(2, column).text.trim()
    if (first && first !== '产品信息') header.set(first, column)
    if (second && second !== '产品信息') header.set(second, column)
  }
  const setCell = (row: number, label: string, value: string | number) => {
    const column = header.get(label)
    assert(column, `导入模板缺少「${label}」列`)
    importSheet.getCell(row, column).value = value
  }
  setCell(3, '价格表名称', importName)
  setCell(3, '状态', '启用')
  setCell(3, '备注', '导入备注')
  setCell(3, '产品', productA.name)
  setCell(3, '产品SKU', 'IMPORT-SKU-A')
  setCell(3, '产品定价', 111.11)
  setCell(3, '税点', 5.5)
  setCell(4, '产品', productB.name)
  setCell(4, '产品SKU', 'IMPORT-SKU-B')
  setCell(4, '产品定价', 222.22)
  const importBuffer = Buffer.from(await importBook.xlsx.writeBuffer())
  const importPrecheck = await prices.precheckImportXlsx(user, importBuffer, 'ADD')
  assert.deepEqual(
    { successCount: importPrecheck.successCount, failCount: importPrecheck.failCount },
    { successCount: 1, failCount: 0 },
    '两条产品行必须聚合为一张价格表通过预检',
  )
  const importResult = await prices.importXlsx(user, importBuffer, 'ADD')
  assert.equal(importResult.successCount, 1)
  const imported = await prisma.productPrice.findFirst({
    where: { organizationId: user.tenantId, name: importName },
    select: { id: true },
  })
  assert(imported, '价格表多级表头导入必须创建主记录')
  cleanupPriceIds.push(imported.id)
  const importedDetail = await prices.get(user, imported.id)
  assert.equal(importedDetail.products.length, 2, '价格表导入必须创建两条 SUB_PRODUCT 行')
  assert.deepEqual(
    importedDetail.products
      .map((item) => item.values['priceProductSku'])
      .filter((value): value is string => typeof value === 'string')
      .sort(),
    ['IMPORT-SKU-A', 'IMPORT-SKU-B'],
    '价格表导入必须完整保留两条 SKU 子字段',
  )

  const updateTemplate = await prices.importTemplate(user, 'UPDATE')
  const updateBook = new ExcelJS.Workbook()
  await updateBook.xlsx.load(updateTemplate.data as unknown as Parameters<typeof updateBook.xlsx.load>[0])
  const updateSheet = updateBook.worksheets[0]
  assert(updateSheet, '价格表更新模板必须存在')
  const updateHeader = new Map<string, number>()
  for (let column = 1; column <= updateSheet.columnCount; column++) {
    const first = updateSheet.getCell(1, column).text.trim()
    const second = updateSheet.getCell(2, column).text.trim()
    if (first && first !== '产品信息') updateHeader.set(first, column)
    if (second && second !== '产品信息') updateHeader.set(second, column)
  }
  const setUpdateCell = (row: number, label: string, value: string | number) => {
    const column = updateHeader.get(label)
    assert(column, `更新模板缺少「${label}」列`)
    updateSheet.getCell(row, column).value = value
  }
  setUpdateCell(3, '唯一ID', imported.id)
  setUpdateCell(3, '状态', '禁用')
  setUpdateCell(3, '产品', productB.name)
  setUpdateCell(3, '产品定价', 333.33)
  setUpdateCell(4, '产品', productA.name)
  setUpdateCell(4, '产品定价', 444.44)
  const updateBuffer = Buffer.from(await updateBook.xlsx.writeBuffer())
  const updateResult = await prices.importXlsx(user, updateBuffer, 'UPDATE')
  assert.equal(updateResult.successCount, 1)
  const updatedImported = await prices.get(user, imported.id)
  assert.equal(updatedImported.status, '2')
  assert.equal(updatedImported.products.length, 2, '价格表 UPDATE 导入必须按唯一ID聚合子表行')

  const exportTask = await prices.exportSelected(user, {
    fileName: `${prefix}_EXPORT`,
    headList: ['name', 'status', 'remark', 'product', 'priceProductSku', 'amount', 'priceProductTax'],
    ids: [imported.id],
  })
  cleanupExportTaskIds.push(exportTask.id)
  assert.equal(exportTask.status, 'SUCCESS', '价格表多级表头导出任务必须成功')
  const exportRow = await prisma.exportTask.findUnique({ where: { id: exportTask.id } })
  assert(exportRow?.filePath, '价格表导出任务必须生成 XLSX 文件')
  const exportBook = new ExcelJS.Workbook()
  await exportBook.xlsx.readFile(exportRow.filePath)
  const exportSheet = exportBook.worksheets[0]
  assert(exportSheet, '价格表导出文件必须包含工作表')
  assert.equal(exportSheet.getCell('D1').text, '产品信息', '价格表导出必须使用 SUB_PRODUCT 一级表头')
  assert.equal(exportSheet.getCell('D2').text, '产品', '价格表导出必须使用产品二级表头')
  assert.equal(exportSheet.getCell('F2').text, '产品定价')

  console.log('W3.6.1 产品/价格表 Smoke 通过')
}

main()
  .finally(async () => {
    if (cleanupExportTaskIds.length) {
      const tasks = await prisma.exportTask.findMany({
        where: { id: { in: cleanupExportTaskIds } },
        select: { filePath: true },
      })
      for (const task of tasks) if (task.filePath) await fs.rm(task.filePath, { force: true })
      await prisma.exportTask.deleteMany({ where: { id: { in: cleanupExportTaskIds } } })
    }
    if (cleanupPriceIds.length) {
      await prisma.productPrice.deleteMany({ where: { id: { in: cleanupPriceIds } } })
    }
    if (cleanupProductIds.length) {
      await prisma.product.deleteMany({ where: { id: { in: cleanupProductIds } } })
    }
    await fs.rm('/tmp/mmx-w361-product-price-smoke', { recursive: true, force: true })
    await prisma.$disconnect()
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
