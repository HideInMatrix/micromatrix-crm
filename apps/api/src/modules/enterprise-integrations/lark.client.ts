import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  OrganizationSnapshotError,
  type OrganizationDepartmentSnapshot,
  type OrganizationSnapshot,
  type OrganizationUserSnapshot,
} from './organization-snapshot'

export interface LarkConnectionInput {
  corpId: string
  agentId: string
  appSecret: string
  redirectUrl: string
}

export interface LarkConnectionResult {
  success: boolean
  message: string
  providerCode: number | null
  transient?: boolean
}

export interface LarkMessageResult extends LarkConnectionResult {
  providerMessageId: string | null
}

export interface LarkOAuthLoginIdentity {
  userId: string
  externalKey: string
  unionId: string | null
  email: string | null
  phone: string | null
  avatarUrl: string | null
  gender: boolean | null
}

export class LarkSnapshotError extends OrganizationSnapshotError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'LarkSnapshotError'
  }
}

const REQUEST_TIMEOUT_MS = 8_000
const MAX_PAGES = 1_000
const USER_PAGE_SIZE = 50

@Injectable()
export class LarkClient {
  constructor(@Optional() private readonly config?: ConfigService) {}

  async testConnection(input: LarkConnectionInput): Promise<LarkConnectionResult> {
    try {
      const token = await this.getTenantAccessToken(input)
      return token
        ? { success: true, message: '飞书连接成功', providerCode: 0 }
        : { success: false, message: '飞书未返回 tenant access token', providerCode: null }
    } catch (error) {
      return {
        success: false,
        message: this.errorMessage(error),
        providerCode: this.providerCode(error),
        transient: true,
      }
    }
  }

  async getTenantAccessToken(
    input: Pick<LarkConnectionInput, 'agentId' | 'appSecret'>,
  ): Promise<string> {
    const payload = await this.fetchJson(
      this.url('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'),
      { app_id: input.agentId, app_secret: input.appSecret },
    )
    this.assertSuccess(payload, 'TOKEN_REQUEST_FAILED')
    const token = this.stringValue(payload['tenant_access_token'])
    if (!token) throw new LarkSnapshotError('TOKEN_MISSING', '飞书未返回 tenant access token')
    return token
  }

  async getOrganizationSnapshot(input: LarkConnectionInput): Promise<OrganizationSnapshot> {
    const token = await this.getTenantAccessToken(input)
    const tenant = await this.getTenantInfo(token)
    const children = await this.getAllDepartments(token)
    const root: OrganizationDepartmentSnapshot = {
      id: '0',
      externalKey: '0',
      name: tenant.name || '公司名称',
      parentId: 'NONE',
      parentExternalKey: 'none',
      order: 0,
      isRoot: true,
    }
    const departments = [root, ...children]
    const departmentKeys = new Set(departments.map((department) => department.externalKey))
    const usersByKey = new Map<string, OrganizationUserSnapshot>()

    for (const department of departments) {
      const users = await this.getDepartmentUsers(token, department.id)
      for (const item of users) {
        const openId = this.requiredString(item['open_id'], 128, '成员 open_id')
        const externalKey = openId.toLowerCase()
        const orders = Array.isArray(item['orders']) ? item['orders'] : []
        const primaryOrder = orders
          .map((raw) => this.optionalObject(raw))
          .find((order) => order?.['is_primary_dept'] === true)
        const primaryDepartmentId = primaryOrder
          ? this.stringValue(primaryOrder['department_id'], 128).trim()
          : ''
        if (!primaryDepartmentId || primaryDepartmentId !== department.id) continue
        if (!departmentKeys.has(primaryDepartmentId.toLowerCase())) {
          throw new LarkSnapshotError(
            'MISSING_PRIMARY_DEPARTMENT',
            `飞书成员“${this.stringValue(item['name']) || openId}”的主部门不存在`,
          )
        }

        const status = this.optionalObject(item['status'])
        if (status?.['is_resigned'] === true || status?.['is_activated'] === false) continue
        const avatar = this.optionalObject(item['avatar'])
        const next: OrganizationUserSnapshot = {
          userId: openId,
          externalKey,
          unionId: this.stringValue(item['union_id'], 128) || null,
          name: this.requiredString(item['name'], 128, '成员名称'),
          email: this.stringValue(item['email'], 256) || null,
          mobile: this.normalizeMobile(this.stringValue(item['mobile'], 32)) || null,
          position: this.stringValue(item['work_station'], 128) || null,
          mainDepartmentId: primaryDepartmentId,
          mainDepartmentExternalKey: primaryDepartmentId.toLowerCase(),
          isLeader:
            this.stringValue(item['leader_user_id'], 128).toLowerCase() ===
            this.stringValue(item['user_id'], 128).toLowerCase(),
        }
        usersByKey.set(externalKey, usersByKey.get(externalKey) ?? next)
        if (avatar) void avatar
      }
    }

    return {
      departments: departments.sort((a, b) => b.order - a.order || a.id.localeCompare(b.id)),
      users: [...usersByKey.values()].sort((a, b) => a.userId.localeCompare(b.userId)),
    }
  }

  async exchangeOAuthLoginCode(
    input: LarkConnectionInput,
    code: string,
    redirectUrl = input.redirectUrl,
  ): Promise<LarkOAuthLoginIdentity> {
    const tokenPayload = await this.fetchJson(
      this.url('https://open.feishu.cn/open-apis/authen/v2/oauth/token'),
      {
        grant_type: 'authorization_code',
        client_id: input.agentId,
        client_secret: input.appSecret,
        code,
        redirect_uri: redirectUrl,
      },
    )
    this.assertSuccess(tokenPayload, 'OAUTH_USER_TOKEN_FAILED')
    const tokenData = this.unwrapData(tokenPayload)
    const accessToken = this.stringValue(tokenData['access_token'] ?? tokenPayload['access_token'])
    if (!accessToken) {
      throw new LarkSnapshotError('OAUTH_USER_TOKEN_MISSING', '飞书未返回用户 access token')
    }

    const profilePayload = await this.fetchJson(
      this.url('https://open.feishu.cn/open-apis/authen/v1/user_info'),
      undefined,
      { Authorization: `Bearer ${accessToken}` },
      'GET',
    )
    this.assertSuccess(profilePayload, 'OAUTH_USER_INFO_FAILED')
    const profile = this.unwrapData(profilePayload)
    const openId = this.requiredString(profile['open_id'], 128, 'open_id')
    const genderValue = this.numberValue(profile['gender'])
    return {
      userId: openId,
      externalKey: openId.toLowerCase(),
      unionId: this.stringValue(profile['union_id'], 128) || null,
      email: this.stringValue(profile['email'], 256) || null,
      phone: this.normalizeMobile(this.stringValue(profile['mobile'], 32)) || null,
      avatarUrl:
        this.stringValue(profile['avatar_url'], 1_000) ||
        this.stringValue(profile['avatar_big'], 1_000) ||
        null,
      gender: genderValue === 1 ? true : genderValue === 2 ? false : null,
    }
  }

  async sendTextMessage(
    input: LarkConnectionInput & { toUser: string; content: string },
  ): Promise<LarkMessageResult> {
    try {
      const token = await this.getTenantAccessToken(input)
      const payload = await this.fetchJson(
        this.url('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id'),
        {
          receive_id: input.toUser,
          msg_type: 'text',
          content: JSON.stringify({ text: input.content }),
        },
        { Authorization: `Bearer ${token}` },
      )
      const code = this.numberValue(payload['code']) ?? 0
      const success = code === 0
      const data = this.unwrapData(payload)
      return {
        success,
        transient: !success && this.isTransient(code),
        providerCode: code,
        providerMessageId:
          this.stringValue(data['message_id'] ?? payload['message_id'], 256) || null,
        message: success
          ? '飞书消息发送成功'
          : this.stringValue(payload['msg'] ?? payload['message']) || '飞书消息发送失败',
      }
    } catch (error) {
      return {
        success: false,
        transient: true,
        providerCode: this.providerCode(error),
        providerMessageId: null,
        message: this.errorMessage(error),
      }
    }
  }

  private async getTenantInfo(token: string): Promise<{ name: string }> {
    const payload = await this.fetchJson(
      this.url('https://open.feishu.cn/open-apis/tenant/v2/tenant/query'),
      undefined,
      { Authorization: `Bearer ${token}` },
      'GET',
    )
    this.assertSuccess(payload, 'TENANT_REQUEST_FAILED')
    const data = this.unwrapData(payload)
    const tenant = this.optionalObject(data['tenant']) ?? {}
    return { name: this.stringValue(tenant['name'], 128) }
  }

  private async getAllDepartments(token: string): Promise<OrganizationDepartmentSnapshot[]> {
    const departments: OrganizationDepartmentSnapshot[] = []
    let pageToken = ''
    let loop = 0
    do {
      if (++loop > MAX_PAGES) {
        throw new LarkSnapshotError('TOO_MANY_DEPARTMENT_PAGES', '飞书部门分页超过安全上限')
      }
      const url = this.url(
        `https://open.feishu.cn/open-apis/contact/v3/departments/0/children?fetch_child=true${
          pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
        }`,
      )
      const payload = await this.fetchJson(
        url,
        undefined,
        { Authorization: `Bearer ${token}` },
        'GET',
      )
      this.assertSuccess(payload, 'DEPARTMENT_LIST_FAILED')
      const data = this.unwrapData(payload)
      const items = Array.isArray(data['items']) ? data['items'] : []
      for (const raw of items) {
        const item = this.objectValue(raw, 'INVALID_DEPARTMENT')
        const id = this.requiredString(item['open_department_id'], 128, '部门 open_department_id')
        const parentId = this.stringValue(item['parent_department_id'], 128).trim() || '0'
        departments.push({
          id,
          externalKey: id.toLowerCase(),
          name: this.requiredString(item['name'], 128, '部门名称'),
          parentId,
          parentExternalKey: parentId.toLowerCase(),
          order: this.numberValue(item['order']) ?? 0,
          isRoot: id === '0',
        })
      }
      pageToken = data['has_more'] === true ? this.stringValue(data['page_token'], 512) : ''
      if (data['has_more'] === true && !pageToken) {
        throw new LarkSnapshotError('INVALID_DEPARTMENT_CURSOR', '飞书部门分页游标无效')
      }
    } while (pageToken)

    const keys = new Set(['0', ...departments.map((department) => department.externalKey)])
    for (const department of departments) {
      if (!keys.has(department.parentExternalKey)) {
        throw new LarkSnapshotError(
          'MISSING_PARENT_DEPARTMENT',
          `飞书部门“${department.name}”的上级部门不存在`,
        )
      }
    }
    return departments
  }

  private async getDepartmentUsers(
    token: string,
    departmentId: string,
  ): Promise<Record<string, unknown>[]> {
    const users: Record<string, unknown>[] = []
    let pageToken = ''
    let loop = 0
    do {
      if (++loop > MAX_PAGES) {
        throw new LarkSnapshotError('TOO_MANY_USER_PAGES', '飞书成员分页超过安全上限')
      }
      const url = this.url(
        `https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?department_id=${encodeURIComponent(
          departmentId,
        )}&page_size=${USER_PAGE_SIZE}${
          pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
        }`,
      )
      const payload = await this.fetchJson(
        url,
        undefined,
        { Authorization: `Bearer ${token}` },
        'GET',
      )
      this.assertSuccess(payload, 'USER_REQUEST_FAILED')
      const data = this.unwrapData(payload)
      const items = Array.isArray(data['items']) ? data['items'] : []
      users.push(...items.map((item) => this.objectValue(item, 'INVALID_USER')))
      pageToken = data['has_more'] === true ? this.stringValue(data['page_token'], 512) : ''
      if (data['has_more'] === true && !pageToken) {
        throw new LarkSnapshotError('INVALID_USER_CURSOR', '飞书成员分页游标无效')
      }
    } while (pageToken)
    return users
  }

  private assertSuccess(payload: Record<string, unknown>, code: string): void {
    const providerCode = this.numberValue(payload['code']) ?? 0
    if (providerCode !== 0) {
      const error = new LarkSnapshotError(
        code,
        this.stringValue(payload['msg'] ?? payload['message']) || `飞书接口错误 ${providerCode}`,
      ) as LarkSnapshotError & { providerCode?: number }
      error.providerCode = providerCode
      throw error
    }
  }

  private async fetchJson(
    url: URL,
    body?: unknown,
    headers?: Record<string, string>,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
      const text = await response.text()
      const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      if (!response.ok) {
        throw new Error(
          `飞书 HTTP ${response.status}: ${this.stringValue(payload['msg'] ?? payload['message']) || response.statusText}`,
        )
      }
      return payload
    } finally {
      clearTimeout(timer)
    }
  }

  private url(defaultUrl: string): URL {
    const proxyBase = this.config?.get<string>('LARK_API_BASE')?.trim()
    if (!proxyBase) return new URL(defaultUrl)
    const target = new URL(defaultUrl)
    const base = new URL(proxyBase)
    base.pathname = target.pathname
    base.search = target.search
    return base
  }

  private unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
    return this.optionalObject(payload['data']) ?? payload
  }

  private stringValue(value: unknown, maxLength = 2_048): string {
    return typeof value === 'string'
      ? value.slice(0, maxLength)
      : value == null
        ? ''
        : String(value).slice(0, maxLength)
  }

  private requiredString(value: unknown, maxLength: number, label: string): string {
    const result = this.stringValue(value, maxLength).trim()
    if (!result) throw new LarkSnapshotError('INVALID_RESPONSE', `飞书返回的${label}为空`)
    return result
  }

  private objectValue(value: unknown, code: string): Record<string, unknown> {
    const result = this.optionalObject(value)
    if (!result) throw new LarkSnapshotError(code, '飞书返回的数据结构无效')
    return result
  }

  private optionalObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  private numberValue(value: unknown): number | null {
    const result = Number(value)
    return Number.isFinite(result) ? result : null
  }

  private normalizeMobile(value: string): string {
    const result = value.trim()
    return result.length > 11 ? result.slice(-11) : result
  }

  private isTransient(code: number | null): boolean {
    return code === null || code === 99991400 || code === 99991663 || code >= 50000000
  }

  private providerCode(error: unknown): number | null {
    return typeof error === 'object' && error !== null && 'providerCode' in error
      ? this.numberValue((error as { providerCode?: unknown }).providerCode)
      : null
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
  }
}
