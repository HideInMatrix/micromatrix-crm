import { Injectable, NotFoundException } from '@nestjs/common'
import {
  LoginLogVO,
  OperationLogDetailVO,
  OperationLogVO,
  PaginatedResult,
} from '@micromatrix/shared'
import { or } from '@prisma/orm-postgres/orm-client'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import { prisma8TimestampToISOString } from '../../prisma/prisma8-temporal.js'
import { QueryLoginLogsDto, QueryOperationLogsDto } from './dto/query-logs.dto'

@Injectable()
export class LogsService {
  constructor(private readonly prisma8: Prisma8Service) {}

  async operationLogs(
    tenantId: string,
    query: QueryOperationLogsDto,
  ): Promise<PaginatedResult<OperationLogVO>> {
    const { page = 1, pageSize = 10, module, keyword } = query
    const normalized = keyword?.trim()
    const scoped = this.prisma8.client.orm.public.OperationLogs.where({
      tenantId,
      ...(module ? { module } : {}),
    })
    const filtered = normalized
      ? scoped.where((log) =>
          or(
            log.userName.ilike(`%${normalized}%`),
            log.targetName.ilike(`%${normalized}%`),
          ),
        )
      : scoped
    const [items, aggregate] = await Promise.all([
      filtered
        .select('id', 'userName', 'module', 'action', 'targetName', 'ip', 'createdAt')
        .orderBy((log) => log.createdAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      filtered.aggregate((agg) => ({ total: agg.count() })),
    ])

    return {
      items: items.map((log) => ({
        id: log.id,
        userName: log.userName,
        module: log.module,
        action: log.action,
        targetName: log.targetName,
        ip: log.ip,
        createdAt: prisma8TimestampToISOString(log.createdAt),
      })),
      total: aggregate.total,
      page,
      pageSize,
    }
  }

  async operationLogDetail(tenantId: string, id: string): Promise<OperationLogDetailVO> {
    const log = await this.prisma8.client.orm.public.OperationLogs.where({ id, tenantId })
      .select('id', 'userName', 'module', 'action', 'targetId', 'targetName', 'ip', 'createdAt')
      .first()
    if (!log) throw new NotFoundException('操作日志不存在')
    const blob = await this.prisma8.client.orm.public.OperationLogBlobs.where({
      operationLogId: log.id,
    })
      .select('detail')
      .first()

    return {
      id: log.id,
      userName: log.userName,
      module: log.module,
      action: log.action,
      targetId: log.targetId,
      targetName: log.targetName,
      detail: blob?.detail ?? null,
      ip: log.ip,
      createdAt: prisma8TimestampToISOString(log.createdAt),
    }
  }

  async loginLogs(
    tenantId: string,
    query: QueryLoginLogsDto,
  ): Promise<PaginatedResult<LoginLogVO>> {
    const { page = 1, pageSize = 10, keyword } = query
    const normalized = keyword?.trim()
    const scoped = this.prisma8.client.orm.public.LoginLogs.where({ tenantId })
    const filtered = normalized
      ? scoped.where((log) => log.email.ilike(`%${normalized}%`))
      : scoped
    const [items, aggregate] = await Promise.all([
      filtered
        .orderBy((log) => log.createdAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      filtered.aggregate((agg) => ({ total: agg.count() })),
    ])

    return {
      items: items.map((log) => ({
        id: log.id,
        email: log.email,
        authType: log.authType as 'PASSWORD' | 'WECOM' | 'WECOM_OAUTH2',
        externalSubject: log.externalSubject,
        ip: log.ip,
        userAgent: log.userAgent,
        success: log.success,
        message: log.message,
        createdAt: prisma8TimestampToISOString(log.createdAt),
      })),
      total: aggregate.total,
      page,
      pageSize,
    }
  }
}
