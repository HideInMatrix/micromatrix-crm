import { Injectable, NotFoundException } from '@nestjs/common'
import {
  LoginLogVO,
  OperationLogDetailVO,
  OperationLogVO,
  PaginatedResult,
} from '@micromatrix/shared'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { QueryLoginLogsDto, QueryOperationLogsDto } from './dto/query-logs.dto'

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async operationLogs(
    tenantId: string,
    query: QueryOperationLogsDto,
  ): Promise<PaginatedResult<OperationLogVO>> {
    const { page = 1, pageSize = 10, module, keyword } = query
    const where: Prisma.OperationLogWhereInput = {
      tenantId,
      ...(module ? { module } : {}),
      ...(keyword
        ? {
            OR: [
              { userName: { contains: keyword, mode: 'insensitive' } },
              { targetName: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          userName: true,
          module: true,
          action: true,
          targetName: true,
          ip: true,
          createdAt: true,
        },
      }),
      this.prisma.operationLog.count({ where }),
    ])

    return {
      items: items.map((log) => ({
        id: log.id,
        userName: log.userName,
        module: log.module,
        action: log.action,
        targetName: log.targetName,
        ip: log.ip,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    }
  }

  async operationLogDetail(tenantId: string, id: string): Promise<OperationLogDetailVO> {
    const log = await this.prisma.operationLog.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        userName: true,
        module: true,
        action: true,
        targetId: true,
        targetName: true,
        ip: true,
        createdAt: true,
        blob: { select: { detail: true } },
      },
    })
    if (!log) throw new NotFoundException('操作日志不存在')

    return {
      id: log.id,
      userName: log.userName,
      module: log.module,
      action: log.action,
      targetId: log.targetId,
      targetName: log.targetName,
      detail: log.blob?.detail ?? null,
      ip: log.ip,
      createdAt: log.createdAt.toISOString(),
    }
  }

  async loginLogs(
    tenantId: string,
    query: QueryLoginLogsDto,
  ): Promise<PaginatedResult<LoginLogVO>> {
    const { page = 1, pageSize = 10, keyword } = query
    const where: Prisma.LoginLogWhereInput = {
      tenantId,
      ...(keyword ? { email: { contains: keyword, mode: 'insensitive' } } : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.loginLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.loginLog.count({ where }),
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
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    }
  }
}
