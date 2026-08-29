import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CreateUserViewDto, EditUserViewPosDto, UpdateUserViewDto } from './dto/user-view.dto'
import type { UserViewResourceType } from './user-views.constants'
import { UserViewsService } from './user-views.service'

function createResourceUserViewsController(
  path: string,
  label: string,
  resourceType: UserViewResourceType,
  permissions: string[],
) {
  @ApiTags(label)
  @ApiBearerAuth()
  @RequirePermissions(...permissions)
  @Controller(path)
  class ResourceUserViewsController {
    constructor(private readonly service: UserViewsService) {}

    @Post('add')
    @ApiOperation({ summary: `添加${label}` })
    @LogOperation('userView', 'create')
    add(@CurrentUser() user: AuthUser, @Body() dto: CreateUserViewDto) {
      return this.service.create(user, resourceType, dto)
    }

    @Post('update')
    @ApiOperation({ summary: `编辑${label}` })
    @LogOperation('userView', 'update')
    update(@CurrentUser() user: AuthUser, @Body() dto: UpdateUserViewDto) {
      return this.service.update(user, resourceType, dto)
    }

    @Get('delete/:id')
    @ApiOperation({ summary: `删除${label}` })
    @LogOperation('userView', 'delete')
    remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
      return this.service.remove(user, id, resourceType)
    }

    @Get('detail/:id')
    @ApiOperation({ summary: `${label}详情` })
    detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
      return this.service.detail(user, id, resourceType)
    }

    @Get('list')
    @ApiOperation({ summary: `${label}列表` })
    list(@CurrentUser() user: AuthUser) {
      return this.service.list(user, resourceType)
    }

    @Get('fixed/:id')
    @ApiOperation({ summary: `${label}固定/取消固定` })
    fixed(@CurrentUser() user: AuthUser, @Param('id') id: string) {
      return this.service.toggleFixed(user, id, resourceType)
    }

    @Post('edit/pos')
    @ApiOperation({ summary: `${label}拖拽排序` })
    editPos(@CurrentUser() user: AuthUser, @Body() dto: EditUserViewPosDto) {
      return this.service.editPos(user, resourceType, dto)
    }

    @Get('enable/:id')
    @ApiOperation({ summary: `${label}启用/禁用` })
    enable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
      return this.service.toggleEnabled(user, id, resourceType)
    }
  }

  Object.defineProperty(ResourceUserViewsController, 'name', {
    value: `${resourceType}UserViewsController`,
  })
  return ResourceUserViewsController
}

export const ClueUserViewsController = createResourceUserViewsController(
  'lead/view',
  '线索视图',
  'CLUE',
  ['menu:lead'],
)
export const CluePoolUserViewsController = createResourceUserViewsController(
  'pool/lead/view',
  '线索池视图',
  'CLUE_POOL',
  ['menu:lead'],
)
export const CustomerUserViewsController = createResourceUserViewsController(
  'account/view',
  '客户视图',
  'CUSTOMER',
  ['customer:read'],
)
export const CustomerContactUserViewsController = createResourceUserViewsController(
  'account/contact/view',
  '联系人视图',
  'CUSTOMER_CONTACT',
  ['customer:read', 'contact:read'],
)
export const CustomerPoolUserViewsController = createResourceUserViewsController(
  'pool/account/view',
  '客户公海视图',
  'CUSTOMER_POOL',
  ['customerPool:read'],
)
export const OpportunityUserViewsController = createResourceUserViewsController(
  'opportunity/view',
  '商机视图',
  'OPPORTUNITY',
  ['menu:opportunity'],
)
export const OpportunityQuotationUserViewsController = createResourceUserViewsController(
  'opportunity/quotation/view',
  '报价单视图',
  'OPPORTUNITY_QUOTATION',
  ['menu:quote'],
)
