import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface WeComConnectionInput {
  corpId: string
  agentId: string
  appSecret: string
}

export interface WeComConnectionResult {
  success: boolean
  message: string
  providerCode: number | null
  transient?: boolean
}

export interface WeComDepartmentSnapshot {
  id: string
  externalKey: string
  name: string
  parentId: string
  parentExternalKey: string
  order: number
  isRoot: boolean
}

export interface WeComUserSnapshot {
  userId: string
  externalKey: string
  name: string
  email: string | null
  mobile: string | null
  position: string | null
  mainDepartmentId: string
  mainDepartmentExternalKey: string
  isLeader: boolean
}

export interface WeComOrganizationSnapshot {
  departments: WeComDepartmentSnapshot[]
  users: WeComUserSnapshot[]
}

export interface WeComLoginIdentity {
  userId: string
  externalKey: string
}

export interface WeComOAuthLoginIdentity extends WeComLoginIdentity {
  email: string | null
  phone: string | null
  avatarUrl: string | null
  /** 对齐 Cordys sys_user.gender：false=男，true=女。 */
  gender: boolean | null
}

export interface WeComMessageInput extends WeComConnectionInput {
  toUser: string
  content: string
}

export interface WeComMessageResult {
  success: boolean
  transient: boolean
  providerCode: number | null
  providerMessageId: string | null
  message: string
}

interface WeComResponse {
  errcode: number | null
  errmsg: string | null
  accessToken: string | null
}

export class WeComSnapshotError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'WeComSnapshotError'
  }
}

const REQUEST_TIMEOUT_MS = 8_000
const MAX_RETRIES = 2
const USER_CONCURRENCY = 5

@Injectable()
export class WeComClient {
  constructor(@Optional() private readonly config?: ConfigService) {}

  async testConnection(input: WeComConnectionInput): Promise<WeComConnectionResult> {
    const tokenResponse = await this.request(this.tokenUrl(input))
    if (!tokenResponse.ok) return tokenResponse.result
    if (!tokenResponse.data.accessToken) {
      return { success: false, message: '企业微信未返回 access token', providerCode: null }
    }

    const agentUrl = this.apiUrl('/cgi-bin/agent/get')
    agentUrl.searchParams.set('access_token', tokenResponse.data.accessToken)
    agentUrl.searchParams.set('agentid', input.agentId)
    const agentResponse = await this.request(agentUrl)
    if (!agentResponse.ok) return agentResponse.result

    return { success: true, message: '企业微信连接成功', providerCode: 0 }
  }

  async getOrganizationSnapshot(input: WeComConnectionInput): Promise<WeComOrganizationSnapshot> {
    const tokenPayload = await this.requestData(this.tokenUrl(input), 'TOKEN_REQUEST_FAILED')
    const accessToken = this.stringValue(tokenPayload['access_token'], 2_048)
    if (!accessToken) throw new WeComSnapshotError('TOKEN_MISSING', '企业微信未返回 access token')

    const departmentUrl = this.apiUrl('/cgi-bin/department/list')
    departmentUrl.searchParams.set('access_token', accessToken)
    const departmentPayload = await this.requestData(departmentUrl, 'DEPARTMENT_REQUEST_FAILED')
    const departments = this.parseDepartments(departmentPayload['department'])
    this.validateDepartmentTree(departments)

    const usersByKey = new Map<string, WeComUserSnapshot>()
    let cursor = 0
    const workers = Array.from(
      { length: Math.min(USER_CONCURRENCY, departments.length) },
      async () => {
        while (cursor < departments.length) {
          const department = departments[cursor++]
          if (!department) return
          const userUrl = this.apiUrl('/cgi-bin/user/list')
          userUrl.searchParams.set('access_token', accessToken)
          userUrl.searchParams.set('department_id', department.id)
          userUrl.searchParams.set('fetch_child', '0')
          const payload = await this.requestData(userUrl, 'USER_REQUEST_FAILED')
          for (const user of this.parseUsers(payload['userlist'], department.id)) {
            const existing = usersByKey.get(user.externalKey)
            if (existing && JSON.stringify(existing) !== JSON.stringify(user)) {
              throw new WeComSnapshotError(
                'DUPLICATE_USER_ID',
                `企业微信返回重复且不一致的成员 ID：${user.userId}`,
              )
            }
            usersByKey.set(user.externalKey, user)
          }
        }
      },
    )
    await Promise.all(workers)

    return {
      departments: departments.sort((a, b) => b.order - a.order || a.id.localeCompare(b.id)),
      users: [...usersByKey.values()].sort((a, b) => a.userId.localeCompare(b.userId)),
    }
  }

  async exchangeLoginCode(input: WeComConnectionInput, code: string): Promise<WeComLoginIdentity> {
    const tokenPayload = await this.requestData(this.tokenUrl(input), 'TOKEN_REQUEST_FAILED')
    const accessToken = this.stringValue(tokenPayload['access_token'], 2_048)
    if (!accessToken) throw new WeComSnapshotError('TOKEN_MISSING', '企业微信未返回 access token')

    const identityUrl = this.apiUrl('/cgi-bin/auth/getuserinfo')
    identityUrl.searchParams.set('access_token', accessToken)
    identityUrl.searchParams.set('code', code)
    const identityPayload = await this.requestData(identityUrl, 'LOGIN_IDENTITY_REQUEST_FAILED')
    const userId = this.stringValue(identityPayload['UserId'], 128)
    if (!userId) {
      throw new WeComSnapshotError('LOGIN_IDENTITY_MISSING', '未获取到企业微信成员身份')
    }
    return { userId, externalKey: userId.toLowerCase() }
  }

  async exchangeOAuthLoginCode(
    input: WeComConnectionInput,
    code: string,
  ): Promise<WeComOAuthLoginIdentity> {
    const tokenPayload = await this.requestData(this.tokenUrl(input), 'TOKEN_REQUEST_FAILED')
    const accessToken = this.stringValue(tokenPayload['access_token'], 2_048)
    if (!accessToken) throw new WeComSnapshotError('TOKEN_MISSING', '企业微信未返回 access token')

    const identityUrl = this.apiUrl('/cgi-bin/auth/getuserinfo')
    identityUrl.searchParams.set('access_token', accessToken)
    identityUrl.searchParams.set('code', code)
    const identityPayload = await this.requestData(identityUrl, 'LOGIN_IDENTITY_REQUEST_FAILED')
    const userId = this.stringValue(identityPayload['UserId'], 128)
    if (!userId) {
      throw new WeComSnapshotError('LOGIN_IDENTITY_MISSING', '未获取到企业微信成员身份')
    }

    const userTicket = this.stringValue(identityPayload['user_ticket'], 512)
    let profilePayload: Record<string, unknown>
    if (userTicket) {
      const detailUrl = this.apiUrl('/cgi-bin/auth/getuserdetail')
      detailUrl.searchParams.set('access_token', accessToken)
      profilePayload = await this.requestData(detailUrl, 'LOGIN_PROFILE_REQUEST_FAILED', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ticket: userTicket }),
      })
    } else {
      const profileUrl = this.apiUrl('/cgi-bin/user/get')
      profileUrl.searchParams.set('access_token', accessToken)
      profileUrl.searchParams.set('userid', userId)
      profilePayload = await this.requestData(profileUrl, 'LOGIN_PROFILE_REQUEST_FAILED')
    }

    const genderValue =
      typeof profilePayload['gender'] === 'number'
        ? profilePayload['gender']
        : Number(profilePayload['gender'])
    return {
      userId,
      externalKey: userId.toLowerCase(),
      email:
        this.stringValue(profilePayload['biz_mail'], 256) ??
        this.stringValue(profilePayload['email'], 256),
      phone: this.stringValue(profilePayload['mobile'], 32),
      avatarUrl: this.stringValue(profilePayload['avatar'], 2_048),
      gender: genderValue === 1 ? false : genderValue === 2 ? true : null,
    }
  }

  async sendTextMessage(input: WeComMessageInput): Promise<WeComMessageResult> {
    const tokenResponse = await this.request(this.tokenUrl(input))
    if (!tokenResponse.ok) {
      return this.messageFailure(
        tokenResponse.result.providerCode,
        tokenResponse.result.message,
        tokenResponse.result.transient ?? false,
      )
    }
    const accessToken = tokenResponse.data.accessToken
    if (!accessToken) return this.messageFailure(null, '企业微信未返回 access token', false)

    const url = this.apiUrl('/cgi-bin/message/send')
    url.searchParams.set('access_token', accessToken)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: input.toUser,
          agentid: Number(input.agentId),
          msgtype: 'text',
          text: { content: input.content.slice(0, 2_048) },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        return this.messageFailure(
          null,
          `企业微信服务响应异常（HTTP ${response.status}）`,
          response.status === 429 || response.status >= 500,
        )
      }
      const raw: unknown = await response.json()
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return this.messageFailure(null, '企业微信返回了无效数据', false)
      }
      const data = raw as Record<string, unknown>
      const providerCode = typeof data['errcode'] === 'number' ? data['errcode'] : null
      const providerMessageId = this.stringValue(data['msgid'], 256)
      if (providerCode === 0) {
        return {
          success: true,
          transient: false,
          providerCode,
          providerMessageId,
          message: '企业微信消息发送成功',
        }
      }
      const detail = this.stringValue(data['errmsg'], 160)
      return this.messageFailure(
        providerCode,
        `企业微信消息发送失败（${providerCode ?? '未知错误'}）${detail ? `：${detail}` : ''}`,
        providerCode === -1 || providerCode === 45009,
      )
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return this.messageFailure(
        null,
        name === 'TimeoutError' || name === 'AbortError'
          ? '企业微信消息发送超时'
          : '企业微信消息服务暂时不可用',
        true,
      )
    }
  }

  private tokenUrl(input: WeComConnectionInput): URL {
    const url = this.apiUrl('/cgi-bin/gettoken')
    url.searchParams.set('corpid', input.corpId)
    url.searchParams.set('corpsecret', input.appSecret)
    return url
  }

  private apiUrl(path: string): URL {
    const base = this.config?.get<string>('WECOM_API_BASE_URL') ?? 'https://qyapi.weixin.qq.com'
    return new URL(path, base.endsWith('/') ? base : `${base}/`)
  }

  private async request(
    url: URL,
  ): Promise<{ ok: true; data: WeComResponse } | { ok: false; result: WeComConnectionResult }> {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        return {
          ok: false,
          result: {
            success: false,
            message: `企业微信服务响应异常（HTTP ${response.status}）`,
            providerCode: null,
            transient: response.status === 429 || response.status >= 500,
          },
        }
      }

      const data = this.parseResponse(await response.json())
      if (data.errcode !== 0) {
        const detail = data.errmsg ? `：${data.errmsg.slice(0, 160)}` : ''
        return {
          ok: false,
          result: {
            success: false,
            message: `企业微信连接失败（${data.errcode ?? '未知错误'}）${detail}`,
            providerCode: data.errcode,
            transient: data.errcode === -1 || data.errcode === 45009,
          },
        }
      }
      return { ok: true, data }
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return {
        ok: false,
        result: {
          success: false,
          message:
            name === 'TimeoutError' || name === 'AbortError'
              ? '企业微信连接超时'
              : '企业微信服务暂时不可用',
          providerCode: null,
          transient: true,
        },
      }
    }
  }

  private async requestData(
    url: URL,
    errorCode: string,
    init: RequestInit = {},
    maxRetries = MAX_RETRIES,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...init,
          headers: { Accept: 'application/json', ...init.headers },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          await this.backoff(attempt)
          continue
        }
        if (!response.ok) {
          throw new WeComSnapshotError(errorCode, `企业微信服务响应异常（HTTP ${response.status}）`)
        }
        const value: unknown = await response.json()
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new WeComSnapshotError('INVALID_RESPONSE', '企业微信返回了无效数据')
        }
        const data = value as Record<string, unknown>
        const errcode = typeof data['errcode'] === 'number' ? data['errcode'] : null
        if ((errcode === 45009 || errcode === -1) && attempt < maxRetries) {
          await this.backoff(attempt)
          continue
        }
        if (errcode !== 0) {
          const detail = this.stringValue(data['errmsg'], 160)
          throw new WeComSnapshotError(
            errorCode,
            `企业微信接口调用失败（${errcode ?? '未知错误'}）${detail ? `：${detail}` : ''}`,
          )
        }
        return data
      } catch (error) {
        if (error instanceof WeComSnapshotError) throw error
        const name = error instanceof Error ? error.name : ''
        if (attempt < maxRetries) {
          await this.backoff(attempt)
          continue
        }
        throw new WeComSnapshotError(
          errorCode,
          name === 'TimeoutError' || name === 'AbortError'
            ? '企业微信组织数据请求超时'
            : '企业微信组织数据暂时不可用',
        )
      }
    }
    throw new WeComSnapshotError(errorCode, '企业微信组织数据暂时不可用')
  }

  private parseDepartments(value: unknown): WeComDepartmentSnapshot[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new WeComSnapshotError('EMPTY_DEPARTMENTS', '企业微信部门列表为空')
    }
    const seen = new Set<string>()
    return value.map((raw) => {
      const item = this.objectValue(raw, 'INVALID_DEPARTMENT')
      const id = this.idValue(item['id'], '部门 ID')
      const externalKey = id.toLowerCase()
      if (seen.has(externalKey)) {
        throw new WeComSnapshotError('DUPLICATE_DEPARTMENT_ID', `企业微信返回重复部门 ID：${id}`)
      }
      seen.add(externalKey)
      const parentId = this.idValue(item['parentid'], '父部门 ID')
      return {
        id,
        externalKey,
        name: this.requiredString(item['name'], 128, '部门名称'),
        parentId,
        parentExternalKey: parentId.toLowerCase(),
        order: this.numberValue(item['order']),
        isRoot: parentId === '0',
      }
    })
  }

  private parseUsers(value: unknown, fetchedDepartmentId: string): WeComUserSnapshot[] {
    if (!Array.isArray(value)) {
      throw new WeComSnapshotError('INVALID_USERS', '企业微信成员列表格式错误')
    }
    const users: WeComUserSnapshot[] = []
    for (const raw of value) {
      const item = this.objectValue(raw, 'INVALID_USER')
      const userId = this.requiredString(item['userid'], 128, '成员 userId')
      const departments = this.numberArray(item['department']).map(String)
      const mainDepartmentId = String(
        typeof item['main_department'] === 'number'
          ? item['main_department']
          : (departments[0] ?? fetchedDepartmentId),
      )
      if (mainDepartmentId !== fetchedDepartmentId) continue
      const leaderFlags = this.numberArray(item['is_leader_in_dept'])
      const mainIndex = departments.indexOf(mainDepartmentId)
      users.push({
        userId,
        externalKey: userId.toLowerCase(),
        name: this.requiredString(item['name'], 128, '成员名称'),
        email: this.stringValue(item['email'], 256) ?? this.stringValue(item['biz_mail'], 256),
        mobile: this.stringValue(item['mobile'], 32),
        position: this.stringValue(item['position'], 128),
        mainDepartmentId,
        mainDepartmentExternalKey: mainDepartmentId.toLowerCase(),
        isLeader: mainIndex >= 0 && leaderFlags[mainIndex] === 1,
      })
    }
    return users
  }

  private validateDepartmentTree(departments: WeComDepartmentSnapshot[]): void {
    const roots = departments.filter((department) => department.isRoot)
    if (roots.length !== 1) {
      throw new WeComSnapshotError('INVALID_ROOT_DEPARTMENT', '企业微信组织必须且只能有一个根部门')
    }
    const keys = new Set(departments.map((department) => department.externalKey))
    for (const department of departments) {
      if (!department.isRoot && !keys.has(department.parentExternalKey)) {
        throw new WeComSnapshotError(
          'MISSING_PARENT_DEPARTMENT',
          `部门“${department.name}”的上级部门不存在`,
        )
      }
    }
    const parentMap = new Map(
      departments.map((department) => [department.externalKey, department.parentExternalKey]),
    )
    for (const department of departments) {
      const visited = new Set<string>()
      let cursor: string | undefined = department.externalKey
      while (cursor && cursor !== '0') {
        if (visited.has(cursor)) {
          throw new WeComSnapshotError('DEPARTMENT_CYCLE', '企业微信部门树存在循环关系')
        }
        visited.add(cursor)
        cursor = parentMap.get(cursor)
      }
    }
  }

  private objectValue(value: unknown, code: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new WeComSnapshotError(code, '企业微信返回了无效对象')
    }
    return value as Record<string, unknown>
  }

  private idValue(value: unknown, label: string): string {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new WeComSnapshotError('INVALID_ID', `${label}格式错误`)
    }
    const id = String(value).trim()
    if (!id || id.length > 128) throw new WeComSnapshotError('INVALID_ID', `${label}格式错误`)
    return id
  }

  private requiredString(value: unknown, maxLength: number, label: string): string {
    const result = this.stringValue(value, maxLength)
    if (!result) throw new WeComSnapshotError('INVALID_TEXT', `${label}不能为空`)
    return result
  }

  private stringValue(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null
    const result = value.trim()
    if (!result) return null
    return result.slice(0, maxLength)
  }

  private numberValue(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  }

  private numberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
  }

  private parseResponse(value: unknown): WeComResponse {
    if (!value || typeof value !== 'object') {
      return { errcode: null, errmsg: null, accessToken: null }
    }
    const data = value as Record<string, unknown>
    return {
      errcode: typeof data['errcode'] === 'number' ? data['errcode'] : null,
      errmsg: typeof data['errmsg'] === 'string' ? data['errmsg'] : null,
      accessToken: typeof data['access_token'] === 'string' ? data['access_token'] : null,
    }
  }

  private messageFailure(
    providerCode: number | null,
    message: string,
    transient: boolean,
  ): WeComMessageResult {
    return {
      success: false,
      transient,
      providerCode,
      providerMessageId: null,
      message: message.slice(0, 500),
    }
  }

  private backoff(attempt: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }
}
