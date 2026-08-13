/** 标讯数据源适配器返回的标准条目 */
export interface BiddingItem {
  title: string
  type?: string
  region?: string
  buyer?: string
  budget?: number
  publishedAt?: Date
  deadline?: Date
  sourceUrl?: string
  content?: string
}

/**
 * 标讯数据源适配器接口。
 * 接入真实数据源（剑鱼/千里马等商业 API）时实现本接口并在 registry 注册即可，
 * 凭证由 BiddingSource.credentials 提供。
 */
export interface BiddingProvider {
  /** 适配器标识（存储在 BiddingSource.provider） */
  readonly key: string
  readonly label: string
  /** 是否需要配置凭证 */
  readonly requiresCredentials: boolean
  /** 按关键词拉取最新标讯 */
  fetch(credentials: Record<string, unknown>, keyword: string): Promise<BiddingItem[]>
}
