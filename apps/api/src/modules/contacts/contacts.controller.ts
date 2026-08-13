import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { ContactsService } from './contacts.service'
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto'

@ApiTags('联系人')
@ApiBearerAuth()
@RequirePermissions('menu:customer')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @ApiOperation({ summary: '客户的联系人列表' })
  list(@CurrentUser() user: AuthUser, @Query('customerId') customerId: string) {
    return this.contactsService.list(user, customerId)
  }

  @Post()
  @RequirePermissions('contact:create')
  @LogOperation('contact', 'create')
  @ApiOperation({ summary: '新建联系人' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.contactsService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('contact:update')
  @LogOperation('contact', 'update')
  @ApiOperation({ summary: '更新联系人' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(user, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('contact:delete')
  @LogOperation('contact', 'delete')
  @ApiOperation({ summary: '删除联系人' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contactsService.remove(user, id)
  }
}
