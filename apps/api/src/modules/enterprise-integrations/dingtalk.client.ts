import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  OrganizationSnapshotError,
  type OrganizationDepartmentSnapshot,
  type OrganizationSnapshot,
  type OrganizationUserSnapshot,
} from './organization-snapshot'

export interface DingTalkConnectionInput {
  corpId: string
  clientId: string
  agentId: string
  appSecret: string
}

export interface DingTalkConnectionResult {
  success: boolean
  message: string
  providerCode: number | null
  transient?: boolean
}

export interface DingTalkMessageResult extends DingTalkConnectionResult {
  providerMessageId: string | null
}

export interface DingTalkOAuthLoginIdentity {
  userId: string
  externalKey: string
  unionId: string
  email: string | null
  phone: string | null
  avatarUrl: string | null
  gender: boolean | null
}

export class DingTalkSnapshotError extends OrganizationSnapshotError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'DingTalkSnapshotError'
  }
}

const REQUEST_TIMEOUT_MS = 8_000
const MAX_DEPARTMENTS = 10_000
const USER_PAGE_SIZE = 100

@Injectable()
export class DingTalkClient {
  constructor(@Optional() private readonly config?: ConfigService) {}

  async testConnection(input: DingTalkConnectionInput): Promise<DingTalkConnectionResult> {
    try {
      const token = await this.getAccessToken(input)
      return token
        ? { success: true, message: '钉钉连接成功', providerCode: 0 }
        : { success: false, message: '钉钉未返回 access token', providerCode: null }
    } catch (error) {
      return {
        success: false,
        message: this.errorMessage(error),
        providerCode: null,
        transient: true,
      }
    }
  }

  async sendTextMessage(
    input: DingTalkConnectionInput & { toUser: string; content: string },
  ): Promise<DingTalkMessageResult> {
    try {
      const accessToken = await this.getAccessToken(input)
      const response = await this.fetchJson(
        this.url(
          `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(accessToken)}`,
        ),
        {
          agent_id: input.agentId,
          userid_list: input.toUser,
          to_all_user: false,
          msg: { msgtype: 'text', text: { content: input.content } },
        },
      )
      const code = this.numberValue(response['errcode'])
      const success = code === 0
      return {
        success,
        transient: !success && this.isTransient(code),
        providerCode: code,
        providerMessageId: this.stringValue(response['task_id']) || null,
        message: success
          ? '钉钉消息发送成功'
          : this.stringValue(response['errmsg']) || '钉钉消息发送失败',
      }
    } catch (error) {
      return {
        success: false,
        transient: true,
        providerCode: null,
        providerMessageId: null,
        message: this.errorMessage(error),
      }
    }
  }

  async getOrganizationSnapshot(input: DingTalkConnectionInput): Promise<OrganizationSnapshot> {
    const accessToken = await this.getAccessToken(input)
    const departments = await this.getDepartments(accessToken)
    const departmentKeys = new Set(departments.map((department) => department.externalKey))
    const usersByKey = new Map<string, OrganizationUserSnapshot>()

    for (const department of departments) {
      let cursor = 0
      let hasMore = true
      while (hasMore) {
        const result = await this.fetchOapiResult(
          `/topapi/v2/user/list?access_token=${encodeURIComponent(accessToken)}`,
          { dept_id: Number(department.id), cursor, size: USER_PAGE_SIZE },
          'USER_REQUEST_FAILED',
        )
        const list = Array.isArray(result['list']) ? result['list'] : []
        for (const raw of list) {
          const item = this.objectValue(raw, 'INVALID_USER')
          const userId = this.requiredString(item['userid'], 128, '成员 userid')
          const externalKey = userId.toLowerCase()
          const departmentIds = Array.isArray(item['dept_id_list'])
            ? item['dept_id_list']
                .map((value) => this.idValue(value))
                .filter((value): value is string => Boolean(value))
            : []
          const mainDepartmentId =
            departmentIds.find((id) => departmentKeys.has(id.toLowerCase())) ?? department.id
          const leaderFlags = Array.isArray(item['leader_in_dept']) ? item['leader_in_dept'] : []
          const next: OrganizationUserSnapshot = {
            userId,
            externalKey,
            unionId: this.stringValue(item['unionid'], 128) || null,
            name: this.requiredString(item['name'], 128, '成员名称'),
            email: this.stringValue(item['email'], 256) || null,
            mobile: this.stringValue(item['mobile'], 32) || null,
            position: this.stringValue(item['title'], 128) || null,
            mainDepartmentId,
            mainDepartmentExternalKey: mainDepartmentId.toLowerCase(),
            isLeader:
              item['leader'] === true ||
              leaderFlags.some((value) => value === true || Number(value) === 1),
          }
          const existing = usersByKey.get(externalKey)
          usersByKey.set(
            externalKey,
            existing
              ? {
                  ...existing,
                  ...next,
                  mainDepartmentId: existing.mainDepartmentId,
                  mainDepartmentExternalKey: existing.mainDepartmentExternalKey,
                  isLeader: existing.isLeader || next.isLeader,
                }
              : next,
          )
        }
        hasMore = result['has_more'] === true
        if (hasMore) {
          const nextCursor = Number(result['next_cursor'])
          if (!Number.isFinite(nextCursor) || nextCursor === cursor) {
            throw new DingTalkSnapshotError('INVALID_USER_CURSOR', '钉钉成员分页游标无效')
          }
          cursor = nextCursor
        }
      }
    }

    return {
      departments: departments.sort((a, b) => b.order - a.order || a.id.localeCompare(b.id)),
      users: [...usersByKey.values()].sort((a, b) => a.userId.localeCompare(b.userId)),
    }
  }

  async exchangeOAuthLoginCode(
    input: DingTalkConnectionInput,
    code: string,
  ): Promise<DingTalkOAuthLoginIdentity> {
    const userTokenPayload = await this.fetchJson(
      this.url('https://api.dingtalk.com/v1.0/oauth2/userAccessToken'),
      {
        clientId: input.clientId,
        clientSecret: input.appSecret,
        code,
        grantType: 'authorization_code',
      },
    )
    const userAccessToken = this.stringValue(
      userTokenPayload['accessToken'] ?? userTokenPayload['access_token'],
    )
    if (!userAccessToken) {
      throw new DingTalkSnapshotError(
        'OAUTH_USER_TOKEN_MISSING',
        this.stringValue(userTokenPayload['message']) || '钉钉未返回用户 access token',
      )
    }

    const profile = await this.fetchJson(
      this.url('https://api.dingtalk.com/v1.0/contact/users/me'),
      undefined,
      { Authorization: `Bearer ${userAccessToken}` },
      'GET',
    )
    const unionId = this.requiredString(profile['unionId'] ?? profile['unionid'], 128, 'unionId')
    const accessToken = await this.getAccessToken(input)
    const userResult = await this.fetchOapiResult(
      `/topapi/user/getbyunionid?access_token=${encodeURIComponent(accessToken)}`,
      { unionid: unionId },
      'OAUTH_USERID_RESOLVE_FAILED',
    )
    const userId = this.requiredString(userResult['userid'] ?? userResult['user_id'], 128, 'userid')
    return {
      userId,
      externalKey: userId.toLowerCase(),
      unionId,
      email: this.stringValue(profile['email'], 256) || null,
      phone:
        this.stringValue(profile['mobile'], 32) || this.stringValue(profile['phone'], 32) || null,
      avatarUrl:
        this.stringValue(profile['avatarUrl'], 1_000) ||
        this.stringValue(profile['avatar'], 1_000) ||
        null,
      gender: null,
    }
  }

  async getAccessToken(
    input: Pick<DingTalkConnectionInput, 'clientId' | 'appSecret'>,
  ): Promise<string> {
    const payload = await this.fetchJson(
      this.url('https://api.dingtalk.com/v1.0/oauth2/accessToken'),
      { appKey: input.clientId, appSecret: input.appSecret },
    )
    const accessToken = this.stringValue(payload['accessToken'] ?? payload['access_token'])
    if (!accessToken) {
      throw new Error(this.stringValue(payload['message']) || '钉钉未返回 access token')
    }
    return accessToken
  }

  private async getDepartments(accessToken: string): Promise<OrganizationDepartmentSnapshot[]> {
    const ids: string[] = ['1']
    const seen = new Set(ids)
    let cursor = 0
    while (cursor < ids.length) {
      if (ids.length > MAX_DEPARTMENTS) {
        throw new DingTalkSnapshotError('TOO_MANY_DEPARTMENTS', '钉钉部门数量超过同步安全上限')
      }
      const id = ids[cursor++]!
      const result = await this.fetchOapiResult(
        `/topapi/v2/department/listsubid?access_token=${encodeURIComponent(accessToken)}`,
        { dept_id: Number(id) },
        'DEPARTMENT_LIST_FAILED',
      )
      const children = Array.isArray(result['dept_id_list']) ? result['dept_id_list'] : []
      for (const value of children) {
        const childId = this.idValue(value)
        if (!childId || seen.has(childId)) continue
        seen.add(childId)
        ids.push(childId)
      }
    }

    const departments: OrganizationDepartmentSnapshot[] = []
    for (const id of ids) {
      const result = await this.fetchOapiResult(
        `/topapi/v2/department/get?access_token=${encodeURIComponent(accessToken)}`,
        { dept_id: Number(id), language: 'zh_CN' },
        'DEPARTMENT_DETAIL_FAILED',
      )
      const parentId = id === '1' ? '0' : this.idValue(result['parent_id']) || '1'
      departments.push({
        id,
        externalKey: id.toLowerCase(),
        name: this.requiredString(result['name'], 128, '部门名称'),
        parentId,
        parentExternalKey: parentId.toLowerCase(),
        order: this.numberValue(result['order']) ?? 0,
        isRoot: id === '1',
      })
    }
    const keys = new Set(departments.map((department) => department.externalKey))
    for (const department of departments) {
      if (!department.isRoot && !keys.has(department.parentExternalKey)) {
        throw new DingTalkSnapshotError(
          'MISSING_PARENT_DEPARTMENT',
          `钉钉部门“${department.name}”的上级部门不存在`,
        )
      }
    }
    return departments
  }

  private async fetchOapiResult(
    pathAndQuery: string,
    body: unknown,
    errorCode: string,
  ): Promise<Record<string, unknown>> {
    const payload = await this.fetchJson(this.url(`https://oapi.dingtalk.com${pathAndQuery}`), body)
    const providerCode = this.numberValue(payload['errcode'])
    if (providerCode !== 0) {
      throw new DingTalkSnapshotError(
        errorCode,
        this.stringValue(payload['errmsg']) || `钉钉接口错误 ${providerCode ?? 'unknown'}`,
      )
    }
    const result = payload['result']
    return result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {}
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
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      if (!response.ok) {
        throw new Error(
          `钉钉 HTTP ${response.status}: ${this.stringValue(parsed['message']) || response.statusText}`,
        )
      }
      return parsed
    } finally {
      clearTimeout(timer)
    }
  }

  private url(defaultUrl: string): URL {
    const proxyBase = this.config?.get<string>('DINGTALK_API_BASE')?.trim()
    if (!proxyBase) return new URL(defaultUrl)
    const target = new URL(defaultUrl)
    const base = new URL(proxyBase)
    base.pathname = target.pathname
    base.search = target.search
    return base
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
    if (!result) throw new DingTalkSnapshotError('INVALID_RESPONSE', `钉钉返回的${label}为空`)
    return result
  }

  private objectValue(value: unknown, code: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new DingTalkSnapshotError(code, '钉钉返回的数据结构无效')
    }
    return value as Record<string, unknown>
  }

  private idValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 128)
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
    return null
  }

  private numberValue(value: unknown): number | null {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  private isTransient(code: number | null): boolean {
    return code === null || [88, 130101, 130102, 50002].includes(code)
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
  }
}
