import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { AuthModule } from './auth/auth.module'
import { CommonModule } from './common/common.module'
import { ApprovalsModule } from './modules/approvals/approvals.module'
import { BiddingModule } from './modules/bidding/bidding.module'
import { AuthGuard } from './common/guards/auth.guard'
import { OperationLogInterceptor } from './common/interceptors/operation-log.interceptor'
import { CustomersModule } from './customers/customers.module'
import { HealthController } from './health/health.controller'
import { ContactsModule } from './modules/contacts/contacts.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { DepartmentsModule } from './modules/departments/departments.module'
import { FollowUpsModule } from './modules/follow-ups/follow-ups.module'
import { LeadsModule } from './modules/leads/leads.module'
import { OrdersModule } from './modules/orders/orders.module'
import { ProductsModule } from './modules/products/products.module'
import { QuotesModule } from './modules/quotes/quotes.module'
import { LogsModule } from './modules/logs/logs.module'
import { MembersModule } from './modules/members/members.module'
import { MetadataModule } from './modules/metadata/metadata.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { OpportunitiesModule } from './modules/opportunities/opportunities.module'
import { PoolRulesModule } from './modules/pool-rules/pool-rules.module'
import { RolesModule } from './modules/roles/roles.module'
import { SettingsModule } from './modules/settings/settings.module'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    AuthModule,
    NotificationsModule,
    MetadataModule,
    ApprovalsModule,
    CustomersModule,
    ContactsModule,
    LeadsModule,
    FollowUpsModule,
    OpportunitiesModule,
    ProductsModule,
    QuotesModule,
    ContractsModule,
    OrdersModule,
    BiddingModule,
    DashboardModule,
    PoolRulesModule,
    DepartmentsModule,
    MembersModule,
    RolesModule,
    LogsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor },
  ],
})
export class AppModule {}
