import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CreateQuoteDto, QueryQuotesDto, UpdateQuoteDto } from './dto/quote.dto'
import { QuotesService } from './quotes.service'

@ApiTags('报价')
@ApiBearerAuth()
@RequirePermissions('menu:quote')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  @ApiOperation({ summary: '报价列表' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryQuotesDto) {
    return this.quotesService.findAll(user, query)
  }

  @Post()
  @RequirePermissions('quote:create')
  @LogOperation('quote', 'create')
  @ApiOperation({ summary: '新建报价（含明细行）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuoteDto) {
    return this.quotesService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('quote:update')
  @LogOperation('quote', 'update')
  @ApiOperation({ summary: '更新报价（仅草稿）' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateQuoteDto) {
    return this.quotesService.update(user, id, dto)
  }

  @Post(':id/confirm')
  @RequirePermissions('quote:update')
  @LogOperation('quote', 'confirm')
  @ApiOperation({ summary: '确认报价' })
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.changeStatus(user, id, 'CONFIRMED')
  }

  @Post(':id/void')
  @RequirePermissions('quote:update')
  @LogOperation('quote', 'void')
  @ApiOperation({ summary: '作废报价' })
  voidQuote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.changeStatus(user, id, 'VOID')
  }

  @Delete(':id')
  @RequirePermissions('quote:delete')
  @LogOperation('quote', 'delete')
  @ApiOperation({ summary: '删除报价' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.remove(user, id)
  }
}
