import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type OnApplicationBootstrap,
} from '@nestjs/common'
import { Job, UnrecoverableError } from 'bullmq'
import { toAuthUser } from '../common/auth-user'
import { CustomersService } from '../customers/customers.service'
import { ContactsService } from '../modules/contacts/contacts.service'
import { BusinessTitleService } from '../modules/contracts/business-title.service'
import { ContractInvoiceService } from '../modules/contracts/contract-invoice.service'
import {
  ContractPaymentPlanService,
  ContractPaymentRecordService,
} from '../modules/contracts/contract-payment.service'
import type {
  ExportBuildResult,
  QueuedExportTaskPayload,
} from '../modules/import-export/export-tasks.service'
import { ExportTasksService } from '../modules/import-export/export-tasks.service'
import { LeadsService } from '../modules/leads/leads.service'
import { OpportunitiesService } from '../modules/opportunities/opportunities.service'
import { OrdersService } from '../modules/orders/orders.service'
import { ProductPriceService } from '../modules/products/product-price.service'
import { ProductsService } from '../modules/products/products.service'
import { PrismaService } from '../prisma/prisma.service'
import { AsyncJobsService, type ExportJobData } from '../async-jobs/async-jobs.service'

@Injectable()
export class ExportWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExportWorkerService.name)

  constructor(
    private readonly jobs: AsyncJobsService,
    private readonly prisma: PrismaService,
    private readonly tasks: ExportTasksService,
    private readonly customers: CustomersService,
    private readonly contacts: ContactsService,
    private readonly leads: LeadsService,
    private readonly opportunities: OpportunitiesService,
    private readonly products: ProductsService,
    private readonly prices: ProductPriceService,
    private readonly businessTitles: BusinessTitleService,
    private readonly contractInvoices: ContractInvoiceService,
    private readonly paymentPlans: ContractPaymentPlanService,
    private readonly paymentRecords: ContractPaymentRecordService,
    private readonly orders: OrdersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.jobs.startExportWorker((job) => this.process(job))
    const recovery = await this.tasks.recoverPending()
    this.logger.log(
      `异步导出 worker 已启动，恢复任务 recovered=${recovery.recovered} kept=${recovery.kept} failedLegacy=${recovery.failedLegacy}`,
    )
  }

  async process(job: Job<ExportJobData>): Promise<void> {
    const task = await this.tasks.beginAttempt(job.data.taskId)
    if (!task) return
    try {
      const payload = this.parsePayload(task.payload)
      const user = await this.loadUser(task.userId)
      const result = await this.route(task.module, user, payload)
      await this.tasks.complete(task.id, user, result)
    } catch (error) {
      const message = this.message(error)
      if (this.isBusinessError(error)) {
        await this.tasks.fail(task.id, message)
        throw new UnrecoverableError(message)
      }
      const attempts = Number(job.opts.attempts ?? 1)
      if (job.attemptsMade + 1 >= attempts) await this.tasks.fail(task.id, message)
      throw error
    }
  }

  async route(
    module: string,
    user: ReturnType<typeof toAuthUser>,
    payload: QueuedExportTaskPayload,
  ): Promise<ExportBuildResult> {
    switch (module) {
      case 'customer':
      case 'customer_pool':
        return this.customers.buildQueuedExport(user, payload)
      case 'contact':
        return this.contacts.buildQueuedExport(user, payload)
      case 'lead':
      case 'lead_pool':
        return this.leads.buildQueuedExport(user, payload)
      case 'opportunity':
        return this.opportunities.buildQueuedExport(user, payload)
      case 'product':
        return this.products.buildQueuedExport(user, payload)
      case 'price':
        return this.prices.buildQueuedExport(user, payload)
      case 'businessTitle':
        return this.businessTitles.buildQueuedExport(user, payload)
      case 'contractInvoice':
        return this.contractInvoices.buildQueuedExport(user, payload)
      case 'contractPaymentPlan':
        return this.paymentPlans.buildQueuedExport(user, payload)
      case 'contractPaymentRecord':
        return this.paymentRecords.buildQueuedExport(user, payload)
      case 'order':
        return this.orders.buildQueuedExport(user, payload)
      default:
        throw new BadRequestException(`不支持的异步导出模块：${module}`)
    }
  }

  private parsePayload(value: unknown): QueuedExportTaskPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('导出任务执行参数无效')
    }
    const payload = value as Record<string, unknown>
    if (payload['version'] !== 1 || !('query' in payload) || !('input' in payload)) {
      throw new BadRequestException('导出任务执行参数版本无效')
    }
    return payload as unknown as QueuedExportTaskPayload
  }

  private async loadUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    })
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('导出任务创建人不存在或已被禁用')
    return toAuthUser(user)
  }

  private isBusinessError(error: unknown): boolean {
    return (
      error instanceof BadRequestException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException ||
      error instanceof UnauthorizedException
    )
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
