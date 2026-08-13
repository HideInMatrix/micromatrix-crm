import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CreateProductDto, QueryProductsDto, UpdateProductDto } from './dto/product.dto'
import { ProductsService } from './products.service'

@ApiTags('产品')
@ApiBearerAuth()
@RequirePermissions('menu:product')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: '产品列表' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryProductsDto) {
    return this.productsService.findAll(user, query)
  }

  @Post()
  @RequirePermissions('product:create')
  @LogOperation('product', 'create')
  @ApiOperation({ summary: '新建产品' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.productsService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('product:update')
  @LogOperation('product', 'update')
  @ApiOperation({ summary: '更新产品' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(user, id, dto)
  }

  @Post(':id/toggle-status')
  @RequirePermissions('product:update')
  @LogOperation('product', 'toggleStatus')
  @ApiOperation({ summary: '上架/下架' })
  toggleStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.productsService.toggleStatus(user, id)
  }

  @Delete(':id')
  @RequirePermissions('product:delete')
  @LogOperation('product', 'delete')
  @ApiOperation({ summary: '删除产品' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.productsService.remove(user, id)
  }
}
