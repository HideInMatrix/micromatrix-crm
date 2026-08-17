import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { CustomerAccessService } from '../../customers/customer-access.service'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto'

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerAccess: CustomerAccessService,
  ) {}

  async list(user: AuthUser, customerId: string) {
    if (!customerId) throw new BadRequestException('缺少 customerId')
    const access = await this.customerAccess.assertRead(user, customerId)
    if (!access.dataScope && !access.pool && access.collaborationType === 'READ_ONLY') return []
    return this.prisma.contact.findMany({
      where: {
        tenantId: user.tenantId,
        customerId,
        ...(!access.dataScope && !access.pool && access.collaborationType === 'COLLABORATION'
          ? { ownerId: user.id }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  async create(user: AuthUser, dto: CreateContactDto) {
    const access = await this.customerAccess.assertCollaborateWrite(user, dto.customerId)
    if (!access.dataScope && dto.ownerId && dto.ownerId !== user.id) {
      throw new ForbiddenException('协作用户只能将联系人负责人设为自己')
    }
    const owner = await this.resolveOwner(user, dto.ownerId)
    const { ownerId: _ownerId, ...data } = dto
    return this.prisma.contact.create({
      data: {
        ...data,
        tenantId: user.tenantId,
        ownerId: owner.id,
        deptId: owner.deptId,
      },
    })
  }

  async update(user: AuthUser, id: string, dto: UpdateContactDto) {
    const contact = await this.ensureExists(user, id)
    const access = await this.customerAccess.assertCollaborateWrite(user, contact.customerId)
    this.assertContactWriteOwner(user, access.dataScope || access.pool, contact.ownerId)

    const { customerId: _ignored, ownerId, ...rest } = dto
    if (!access.dataScope && ownerId && ownerId !== user.id) {
      throw new ForbiddenException('协作用户只能将联系人负责人设为自己')
    }
    const owner = ownerId ? await this.resolveOwner(user, ownerId) : null
    return this.prisma.contact.update({
      where: { id },
      data: {
        ...rest,
        ...(owner ? { ownerId: owner.id, deptId: owner.deptId } : {}),
      },
    })
  }

  async remove(user: AuthUser, id: string) {
    const contact = await this.ensureExists(user, id)
    const access = await this.customerAccess.assertCollaborateWrite(user, contact.customerId)
    this.assertContactWriteOwner(user, access.dataScope || access.pool, contact.ownerId)
    await this.prisma.contact.delete({ where: { id } })
    return { id, name: contact.name }
  }

  private assertContactWriteOwner(user: AuthUser, hasCustomerScope: boolean, ownerId: string | null) {
    if (hasCustomerScope || ownerId === user.id) return
    throw new ForbiddenException('协作用户只能维护自己负责的联系人')
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, deptId: true },
    })
    if (!owner) throw new BadRequestException('联系人负责人不存在或已禁用')
    return owner
  }

  private async ensureExists(user: AuthUser, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!contact) throw new NotFoundException('联系人不存在')
    return contact
  }
}
