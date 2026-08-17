import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  CreateResourceCapacityDto,
  CreateResourcePoolDto,
  type PoolModule,
  UpdateResourceCapacityDto,
  UpdateResourcePoolDto,
} from './dto/resource-pool.dto'
import { ResourcePoolsService } from './resource-pools.service'

@ApiTags('多公海/多线索池')
@ApiBearerAuth()
@Controller()
export class ResourcePoolsController {
  constructor(private readonly service: ResourcePoolsService) {}

  @Get('resource-pools')
  @RequirePermissions('system:pool')
  @ApiOperation({ summary: '池配置列表' })
  list(@CurrentUser() user: AuthUser, @Query('module') module: PoolModule) {
    return this.service.list(user, module)
  }

  @Get('resource-pools/options')
  @ApiOperation({ summary: '当前用户可访问的池选项' })
  options(@CurrentUser() user: AuthUser, @Query('module') module: PoolModule) {
    return this.service.options(user, module)
  }

  @Post('resource-pools')
  @RequirePermissions('system:pool')
  @LogOperation('resourcePool', 'create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateResourcePoolDto) {
    return this.service.create(user, dto)
  }

  @Patch('resource-pools/:id')
  @RequirePermissions('system:pool')
  @LogOperation('resourcePool', 'update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateResourcePoolDto) {
    return this.service.update(user, id, dto)
  }

  @Post('resource-pools/:id/toggle')
  @RequirePermissions('system:pool')
  @LogOperation('resourcePool', 'toggle')
  toggle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.toggle(user, id)
  }

  @Delete('resource-pools/:id')
  @RequirePermissions('system:pool')
  @LogOperation('resourcePool', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Get('resource-capacities')
  @RequirePermissions('system:pool')
  @ApiOperation({ summary: '库容配置列表' })
  listCapacities(@CurrentUser() user: AuthUser, @Query('module') module: PoolModule) {
    return this.service.listCapacities(user, module)
  }

  @Post('resource-capacities')
  @RequirePermissions('system:pool')
  @LogOperation('resourceCapacity', 'create')
  createCapacity(@CurrentUser() user: AuthUser, @Body() dto: CreateResourceCapacityDto) {
    return this.service.createCapacity(user, dto)
  }

  @Patch('resource-capacities/:id')
  @RequirePermissions('system:pool')
  @LogOperation('resourceCapacity', 'update')
  updateCapacity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateResourceCapacityDto,
  ) {
    return this.service.updateCapacity(user, id, dto)
  }

  @Delete('resource-capacities/:id')
  @RequirePermissions('system:pool')
  @LogOperation('resourceCapacity', 'delete')
  removeCapacity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeCapacity(user, id)
  }
}
