import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { Observable, tap } from 'rxjs'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { jsonValue } from '../../prisma/json-value'
import {
  LOG_OPERATION_KEY,
  LogOperationMeta,
  OPERATION_LOG_RESULT_META,
  type OperationLogResultMeta,
} from '../decorators/log-operation.decorator'
import { normalizeClientIp } from '../http/client-ip'

/** 全局操作日志：仅记录被 @LogOperation 标记的接口，成功后异步落库 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma8: Prisma8Service,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<LogOperationMeta | undefined>(
      LOG_OPERATION_KEY,
      context.getHandler(),
    )
    if (!meta) return next.handle()

    const request = context.switchToHttp().getRequest<Request>()
    const user = request.user

    return next.handle().pipe(
      tap((result) => {
        if (!user) return
        const target = (result ?? {}) as {
          id?: unknown
          name?: unknown
          title?: unknown
          [OPERATION_LOG_RESULT_META]?: OperationLogResultMeta
        }
        const resultMeta = target[OPERATION_LOG_RESULT_META]
        void this.prisma8.client
          .transaction(async (tx) => {
            const log = await tx.orm.public.OperationLogs.create({
              tenantId: user.tenantId,
              userId: user.id,
              userName: user.name,
              module: meta.module,
              action: meta.action,
              targetId: resultMeta?.targetId ?? (typeof target.id === 'string' ? target.id : null),
              targetName:
                resultMeta?.targetName ??
                (typeof target.name === 'string'
                  ? target.name
                  : typeof target.title === 'string'
                    ? target.title
                    : null),
              ip: normalizeClientIp(request.ip) ?? null,
            })
            if (resultMeta?.detail) {
              await tx.orm.public.OperationLogBlobs.create({
                operationLogId: log.id,
                detail: jsonValue(resultMeta.detail),
              })
            }
          })
          .catch((e) => this.logger.warn(`操作日志写入失败: ${e.message}`))
      }),
    )
  }
}
