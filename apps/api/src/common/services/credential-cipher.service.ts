import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface EncryptedCredential {
  ciphertext: string
  iv: string
  authTag: string
  keyVersion: number
}

/**
 * 通用凭证加密基础设施。
 *
 * 企业微信、SMTP、AI Model API Key 等业务域只依赖该公共服务，
 * 不允许业务模块之间为了复用密钥逻辑产生反向依赖。
 */
@Injectable()
export class CredentialCipherService {
  private readonly key: Buffer

  constructor(config: ConfigService) {
    const configured = config.get<string>('INTEGRATION_CREDENTIALS_KEY')?.trim()
    const isProduction = config.get<string>('NODE_ENV') === 'production'
    if (isProduction && !configured) {
      throw new Error('生产环境必须配置 INTEGRATION_CREDENTIALS_KEY')
    }
    if (configured && configured.length < 32) {
      throw new Error('INTEGRATION_CREDENTIALS_KEY 至少需要 32 个字符')
    }

    const material =
      configured ?? `micromatrix-development:${config.getOrThrow<string>('JWT_ACCESS_SECRET')}`
    this.key = createHash('sha256').update(material, 'utf8').digest()
  }

  encrypt(plaintext: string): EncryptedCredential {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: 1,
    }
  }

  decrypt(input: EncryptedCredential): string {
    if (input.keyVersion !== 1) throw new Error(`不支持的凭证密钥版本：${input.keyVersion}`)
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(input.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(input.authTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(input.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }
}
