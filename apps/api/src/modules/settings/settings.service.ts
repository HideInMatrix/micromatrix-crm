import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(tenantId: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemSetting.findMany({ where: { tenantId } })
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  async updateAll(tenantId: string, entries: Record<string, unknown>) {
    const keys = Object.keys(entries)
    await this.prisma.$transaction(
      keys.map((key) =>
        this.prisma.systemSetting.upsert({
          where: { tenantId_key: { tenantId, key } },
          update: { value: entries[key] as Prisma.InputJsonValue },
          create: { tenantId, key, value: entries[key] as Prisma.InputJsonValue },
        }),
      ),
    )
    return this.getAll(tenantId)
  }
}
