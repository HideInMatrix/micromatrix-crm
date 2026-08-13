import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { Observable, tap } from 'rxjs'
import { PrismaService } from '../../prisma/prisma.service'
import {
  LOG_OPERATION_KEY,
  LogOperationMeta,
} from '../decorators/log-operation.decorator'

/** 全局操作日志：仅记录被 @LogOperation 标记的接口，成功后异步落库 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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
        const target = (result ?? {}) as { id?: unknown; name?: unknown; title?: unknown }
        void this.prisma.operationLog
          .create({
            data: {
              tenantId: user.tenantId,
              userId: user.id,
              userName: user.name,
              module: meta.module,
              action: meta.action,
              targetId: typeof target.id === 'string' ? target.id : undefined,
              targetName:
                typeof target.name === 'string'
                  ? target.name
                  : typeof target.title === 'string'
                    ? target.title
                    : undefined,
              ip: request.ip,
            },
          })
          .catch((e) => this.logger.warn(`操作日志写入失败: ${e.message}`))
      }),
    )
  }
}
