import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { MessageTemplateService } from './message-template.service'

function serviceWithUsers(
  users: Array<{ email: string | null; phone: string | null; name: string }> = [],
) {
  const prisma = {
    user: {
      findMany: async () => users,
    },
  } as unknown as PrismaService
  return new MessageTemplateService(prisma)
}

test('消息模板语言归一化并按 Cordys 事件名 + subject 后缀渲染', async () => {
  const service = serviceWithUsers()
  assert.equal(service.normalizeLanguage('en_US'), 'en-US')
  assert.equal(service.normalizeLanguage('EN-us'), 'en-US')
  assert.equal(service.normalizeLanguage('zh_TW'), 'zh-CN')

  const zh = await service.render('tenant-a', 'CUSTOMER_ADD', {
    OPERATOR: '张三',
    name: '示例客户',
  })
  assert.equal(zh.title, '新建客户通知')
  assert.equal(zh.content, '请注意！张三新建示例客户客户给您，请知悉！')

  const en = await service.render(
    'tenant-a',
    'CUSTOMER_ADD',
    { OPERATOR: 'David', name: 'Acme' },
    'en-US',
  )
  assert.equal(en.title, 'New AccountNotification')
  assert.equal(
    en.content,
    'Attention! David created a new account Acme for you, please be informed!',
  )
})

test('消息模板处理 null、Time、User，并保留缺失变量占位符', async () => {
  const service = serviceWithUsers([
    { email: 'owner@example.com', phone: '13800000000', name: '负责人' },
  ])
  const result = await service.renderText(
    'tenant-a',
    '${ownerUser}|${updateTime}|${emptyValue}|${missing}',
    {
      ownerUser: 'owner@example.com',
      updateTime: new Date(2026, 8, 7, 12, 34, 56),
      emptyValue: null,
    },
  )
  assert.equal(result, '负责人|2026-09-07 12:34:56||${missing}')

  const rendered = await service.render('tenant-a', 'BUSINESS_QUOTATION_DELETED', {
    OPERATOR: null,
    name: 'Q-001',
  })
  assert.equal(rendered.content, '删除了Q-001报价')

  const customer = await service.render('tenant-a', 'CUSTOMER_ADD', {
    OPERATOR: '${missing}',
    name: '客户A',
    ownerUser: 'owner@example.com',
    createTime: new Date(2026, 8, 7, 12, 34, 56),
  })
  assert.equal(customer.content, '请注意！${missing}新建客户A客户给您，请知悉！')
})

test('审批模板 type/state 使用语义值并按语言资源本地化', async () => {
  const service = serviceWithUsers()
  const zh = await service.render('tenant-a', 'CONTRACT_APPROVAL', {
    type: 'contract',
    name: 'C-001',
    state: 'UNAPPROVED',
  })
  assert.equal(zh.content, '【审批结果】您发起的合同单据 C-001 ，审批已驳回。')

  const en = await service.render(
    'tenant-a',
    'BUSINESS_QUOTATION_APPROVAL',
    { type: 'quotation', name: 'Q-001', state: 'APPROVED' },
    'en-US',
  )
  assert.equal(
    en.content,
    '[Approval Result] The Quotation document Q-001 you submitted has been Approved.',
  )
})
