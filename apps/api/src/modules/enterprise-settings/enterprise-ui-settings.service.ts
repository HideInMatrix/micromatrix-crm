import { BadRequestException, Injectable } from '@nestjs/common'
import type {
  EnterpriseUiAssetSlot,
  EnterpriseUiAssetVO,
  EnterpriseUiSettingVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { AttachmentsService } from '../attachments/attachments.service'
import type { UpdateEnterpriseUiSettingDto } from './dto/ui-setting.dto'

const TARGET_TYPE = 'enterprise-ui-setting'
const DEFAULT_UI_SETTING = {
  theme: 'default',
  customTheme: '#008d91',
  style: 'default',
  customStyle: '#f9fbfb',
  title: 'MicroMatrix CRM',
  slogan: '让客户关系更清晰，让销售协作更高效',
  helpDoc: 'https://github.com/HideInMatrix/micromatrix-crm',
} as const

type AssetField =
  | 'iconAttachmentId'
  | 'loginLogoAttachmentId'
  | 'loginImageAttachmentId'
  | 'platformLogoAttachmentId'

const SLOT_FIELD: Record<EnterpriseUiAssetSlot, AssetField> = {
  icon: 'iconAttachmentId',
  loginLogo: 'loginLogoAttachmentId',
  loginImage: 'loginImageAttachmentId',
  platformLogo: 'platformLogoAttachmentId',
}

@Injectable()
export class EnterpriseUiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
  ) {}

  async get(user: AuthUser): Promise<EnterpriseUiSettingVO> {
    const row = await this.ensureRow(user.tenantId)
    return this.toVO(user.tenantId, row)
  }

  async update(
    user: AuthUser,
    input: UpdateEnterpriseUiSettingDto,
  ): Promise<EnterpriseUiSettingVO> {
    const row = await this.ensureRow(user.tenantId)
    const updated = await this.prisma.enterpriseUiSetting.update({
      where: { id: row.id },
      data: input,
    })
    return this.toVO(user.tenantId, updated)
  }

  async replaceAsset(
    user: AuthUser,
    slot: EnterpriseUiAssetSlot,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
  ): Promise<EnterpriseUiSettingVO> {
    if (!Object.hasOwn(SLOT_FIELD, slot)) throw new BadRequestException('不支持的界面资源类型')
    if (!file?.mimetype.startsWith('image/'))
      throw new BadRequestException('界面资源仅支持图片文件')
    const row = await this.ensureRow(user.tenantId)
    const field = SLOT_FIELD[slot]
    const oldAttachmentId = row[field]
    const uploaded = await this.attachments.upload(user, file, TARGET_TYPE, row.id)

    try {
      const updated = await this.prisma.enterpriseUiSetting.update({
        where: { id: row.id },
        data: { [field]: uploaded.id },
      })
      if (oldAttachmentId) {
        await this.attachments.removeFromTarget(user.tenantId, oldAttachmentId, TARGET_TYPE, row.id)
      }
      return this.toVO(user.tenantId, updated)
    } catch (error) {
      await this.attachments.removeFromTarget(user.tenantId, uploaded.id, TARGET_TYPE, row.id)
      throw error
    }
  }

  async clearAsset(user: AuthUser, slot: EnterpriseUiAssetSlot): Promise<EnterpriseUiSettingVO> {
    if (!Object.hasOwn(SLOT_FIELD, slot)) throw new BadRequestException('不支持的界面资源类型')
    const row = await this.ensureRow(user.tenantId)
    const field = SLOT_FIELD[slot]
    const oldAttachmentId = row[field]
    const updated = await this.prisma.enterpriseUiSetting.update({
      where: { id: row.id },
      data: { [field]: null },
    })
    if (oldAttachmentId) {
      await this.attachments.removeFromTarget(user.tenantId, oldAttachmentId, TARGET_TYPE, row.id)
    }
    return this.toVO(user.tenantId, updated)
  }

  private ensureRow(tenantId: string) {
    return this.prisma.enterpriseUiSetting.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId, ...DEFAULT_UI_SETTING },
    })
  }

  private async toVO(
    tenantId: string,
    row: Awaited<ReturnType<EnterpriseUiSettingsService['ensureRow']>>,
  ): Promise<EnterpriseUiSettingVO> {
    const ids = [
      row.iconAttachmentId,
      row.loginLogoAttachmentId,
      row.loginImageAttachmentId,
      row.platformLogoAttachmentId,
    ].filter((id): id is string => Boolean(id))
    const attachmentRows = ids.length
      ? await this.prisma.attachment.findMany({ where: { tenantId, id: { in: ids } } })
      : []
    const byId = new Map(attachmentRows.map((item) => [item.id, item]))
    const asset = (id: string | null): EnterpriseUiAssetVO | null => {
      if (!id) return null
      const item = byId.get(id)
      return item ? { id: item.id, name: item.name, mime: item.mime, size: item.size } : null
    }
    return {
      id: row.id,
      theme: row.theme as EnterpriseUiSettingVO['theme'],
      customTheme: row.customTheme,
      style: row.style as EnterpriseUiSettingVO['style'],
      customStyle: row.customStyle,
      title: row.title,
      slogan: row.slogan,
      helpDoc: row.helpDoc,
      icon: asset(row.iconAttachmentId),
      loginLogo: asset(row.loginLogoAttachmentId),
      loginImage: asset(row.loginImageAttachmentId),
      platformLogo: asset(row.platformLogoAttachmentId),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
