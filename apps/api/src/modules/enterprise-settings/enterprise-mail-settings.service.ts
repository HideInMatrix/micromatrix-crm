import { BadRequestException, Injectable } from '@nestjs/common'
import type { EnterpriseMailSettingVO, EnterpriseMailTestVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { SaveEnterpriseMailSettingDto } from './dto/mail-setting.dto'
import { SmtpProbeService } from './smtp-probe.service'

@Injectable()
export class EnterpriseMailSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly smtpProbe: SmtpProbeService,
  ) {}

  async get(tenantId: string): Promise<EnterpriseMailSettingVO> {
    const row = await this.prisma.enterpriseMailSetting.findUnique({ where: { tenantId } })
    if (!row) {
      return {
        configured: false,
        host: '',
        port: 465,
        account: '',
        passwordConfigured: false,
        from: '',
        recipient: '',
        ssl: true,
        tls: false,
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastTestedAt: null,
        updatedAt: null,
      }
    }
    return this.toVO(row)
  }

  async save(
    user: AuthUser,
    input: SaveEnterpriseMailSettingDto,
  ): Promise<EnterpriseMailSettingVO> {
    this.validateTransport(input)
    const existing = await this.prisma.enterpriseMailSetting.findUnique({
      where: { tenantId: user.tenantId },
    })
    const password = input.password?.trim() ?? ''
    const encrypted = password ? this.cipher.encrypt(password) : null
    const credential = encrypted ?? this.existingCredential(existing)

    const row = await this.prisma.enterpriseMailSetting.upsert({
      where: { tenantId: user.tenantId },
      create: {
        tenantId: user.tenantId,
        host: input.host,
        port: input.port,
        account: input.account,
        fromAddress: input.from,
        recipient: input.recipient,
        ssl: input.ssl,
        tls: input.tls,
        ...(credential && {
          passwordCiphertext: credential.ciphertext,
          passwordIv: credential.iv,
          passwordAuthTag: credential.authTag,
          passwordKeyVersion: credential.keyVersion,
        }),
      },
      update: {
        host: input.host,
        port: input.port,
        account: input.account,
        fromAddress: input.from,
        recipient: input.recipient,
        ssl: input.ssl,
        tls: input.tls,
        ...(credential && {
          passwordCiphertext: credential.ciphertext,
          passwordIv: credential.iv,
          passwordAuthTag: credential.authTag,
          passwordKeyVersion: credential.keyVersion,
        }),
      },
    })
    return this.toVO(row)
  }

  async test(user: AuthUser, input: SaveEnterpriseMailSettingDto): Promise<EnterpriseMailTestVO> {
    this.validateTransport(input)
    const existing = await this.prisma.enterpriseMailSetting.findUnique({
      where: { tenantId: user.tenantId },
    })
    const submitted = input.password?.trim() ?? ''
    const password = submitted || this.decryptExisting(existing)
    const testedAt = new Date()

    try {
      await this.smtpProbe.test({
        host: input.host,
        port: input.port,
        account: input.account,
        password,
        ssl: input.ssl,
        tls: input.tls,
      })
      await this.storeTestResult(
        user.tenantId,
        existing?.id ?? null,
        true,
        'SMTP 连接与认证成功',
        testedAt,
      )
      return { success: true, message: 'SMTP 连接与认证成功', testedAt: testedAt.toISOString() }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SMTP 连接测试失败'
      if (existing) await this.storeTestResult(user.tenantId, existing.id, false, message, testedAt)
      throw error
    }
  }

  private validateTransport(input: SaveEnterpriseMailSettingDto) {
    if (input.ssl && input.tls) throw new BadRequestException('SSL 与 STARTTLS 不能同时启用')
  }

  private existingCredential(
    row: {
      passwordCiphertext: string | null
      passwordIv: string | null
      passwordAuthTag: string | null
      passwordKeyVersion: number | null
    } | null,
  ) {
    if (
      !row?.passwordCiphertext ||
      !row.passwordIv ||
      !row.passwordAuthTag ||
      row.passwordKeyVersion === null
    ) {
      return null
    }
    return {
      ciphertext: row.passwordCiphertext,
      iv: row.passwordIv,
      authTag: row.passwordAuthTag,
      keyVersion: row.passwordKeyVersion,
    }
  }

  private decryptExisting(row: Parameters<EnterpriseMailSettingsService['existingCredential']>[0]) {
    const credential = this.existingCredential(row)
    return credential ? this.cipher.decrypt(credential) : ''
  }

  private async storeTestResult(
    tenantId: string,
    id: string | null,
    success: boolean,
    message: string,
    testedAt: Date,
  ) {
    if (!id) return
    await this.prisma.enterpriseMailSetting.update({
      where: { id, tenantId },
      data: { lastTestSucceeded: success, lastTestMessage: message, lastTestedAt: testedAt },
    })
  }

  private toVO(row: {
    host: string
    port: number
    account: string
    passwordCiphertext: string | null
    fromAddress: string
    recipient: string
    ssl: boolean
    tls: boolean
    lastTestSucceeded: boolean | null
    lastTestMessage: string | null
    lastTestedAt: Date | null
    updatedAt: Date
  }): EnterpriseMailSettingVO {
    return {
      configured: true,
      host: row.host,
      port: row.port,
      account: row.account,
      passwordConfigured: Boolean(row.passwordCiphertext),
      from: row.fromAddress,
      recipient: row.recipient,
      ssl: row.ssl,
      tls: row.tls,
      lastTestSucceeded: row.lastTestSucceeded,
      lastTestMessage: row.lastTestMessage,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
