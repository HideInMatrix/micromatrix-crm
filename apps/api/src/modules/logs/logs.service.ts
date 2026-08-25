import { Injectable } from '@nestjs/common'
import { LoginLogVO, OperationLogVO, PaginatedResult } from '@micromatrix/shared'
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
        detail: log.detail,
        ip: log.ip,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
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
        authType: log.authType as 'PASSWORD' | 'WECOM',
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
