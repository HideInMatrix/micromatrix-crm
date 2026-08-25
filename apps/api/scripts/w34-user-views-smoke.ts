import assert from 'node:assert/strict'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../src/common/auth-user'
import { PrismaService } from '../src/prisma/prisma.service'
import { UserViewsService } from '../src/modules/user-views/user-views.service'

async function main() {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env['DATABASE_URL'] }))
  await prisma.onModuleInit()
  const service = new UserViewsService(prisma)
  const suffix = Date.now().toString(36)
  const organizationId = `w34-org-${suffix}`
  const userId = `w34-user-${suffix}`
  const user = {
    id: userId,
    tenantId: organizationId,
    email: null,
    name: 'W3.4 用户视图审计',
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: [],
  } satisfies AuthUser

  try {
    const first = await service.create(user, 'CLUE', {
      name: '重点线索',
      searchMode: 'OR',
      conditions: [
        { name: 'stage', operator: 'eq', value: ['NEW', 'FOLLOWING'], multipleValue: true },
        {
          name: 'departmentId',
          operator: 'eq',
          value: 'dept-root',
          containChildIds: ['dept-root'],
        },
      ],
    })
    const second = await service.create(user, 'CLUE', { name: '待联系线索' })
    await service.create(user, 'CUSTOMER', { name: '客户独立视图' })

    assert.deepEqual(
      (await service.list(user, 'CLUE')).map((view) => view.id),
      [second.id, first.id],
    )
    assert.deepEqual((await service.detail(user, first.id, 'CLUE')).conditions[0]?.value, [
      'NEW',
      'FOLLOWING',
    ])
    assert.deepEqual(
      (await service.detail(user, first.id, 'CLUE')).conditions[1]?.containChildIds,
      ['dept-root'],
    )
    assert.equal((await service.list(user, 'CUSTOMER')).length, 1)

    await service.toggleFixed(user, first.id, 'CLUE')
    assert.equal(
      (await service.list(user, 'CLUE')).find((view) => view.id === first.id)?.fixed,
      true,
    )

    await service.toggleEnabled(user, first.id, 'CLUE')
    await assert.rejects(() => service.resolveFilters(user, first.id, 'CLUE'), /已停用/)
    await service.toggleEnabled(user, first.id, 'CLUE')
    assert.equal((await service.resolveFilters(user, first.id, 'CLUE')).searchMode, 'OR')

    await service.editPos(user, 'CLUE', {
      orgId: organizationId,
      moveId: first.id,
      targetId: second.id,
      moveMode: 'BEFORE',
    })
    assert.deepEqual(
      (await service.list(user, 'CLUE')).map((view) => view.id),
      [first.id, second.id],
    )

    const updated = await service.update(user, 'CLUE', {
      id: first.id,
      name: '本周重点线索',
      searchMode: 'AND',
      conditions: [{ name: 'score', operator: 'gte', value: 80 }],
    })
    assert.equal(updated.name, '本周重点线索')
    assert.equal(updated.conditions[0]?.value, 80)
    assert.equal(await prisma.sysUserViewCondition.count({ where: { sysUserViewId: first.id } }), 1)

    await service.remove(user, second.id, 'CLUE')
    assert.equal((await service.list(user, 'CLUE')).length, 1)
    console.log('W3.4 user views smoke: 12 assertions passed')
  } finally {
    await prisma.sysUserView.deleteMany({ where: { organizationId } })
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
