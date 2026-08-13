import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto'

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, customerId: string) {
    if (!customerId) throw new BadRequestException('缺少 customerId')
    return this.prisma.contact.findMany({
      where: { tenantId: user.tenantId, customerId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async create(user: AuthUser, dto: CreateContactDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId: user.tenantId },
    })
    if (!customer) throw new BadRequestException('客户不存在')
    return this.prisma.contact.create({
      data: { ...dto, tenantId: user.tenantId },
    })
  }

  async update(user: AuthUser, id: string, dto: UpdateContactDto) {
    await this.ensureExists(user, id)
    const { customerId: _ignored, ...rest } = dto
    return this.prisma.contact.update({ where: { id }, data: rest })
  }

  async remove(user: AuthUser, id: string) {
    const contact = await this.ensureExists(user, id)
    await this.prisma.contact.delete({ where: { id } })
    return { id, name: contact.name }
  }

  private async ensureExists(user: AuthUser, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!contact) throw new NotFoundException('联系人不存在')
    return contact
  }
}
