// ============ 标讯 ============

export interface BiddingSourceVO {
  id: string
  provider: string
  name: string
  enabled: boolean
  hasCredentials: boolean
  lastFetchAt: string | null
}

export interface BiddingKeywordVO {
  id: string
  keyword: string
  enabled: boolean
}

export interface BiddingInfoVO {
  id: string
  title: string
  type: string | null
  region: string | null
  buyer: string | null
  budget: number | null
  publishedAt: string | null
  deadline: string | null
  sourceUrl: string | null
  content: string | null
  source: string | null
  keyword: string | null
  convertedLeadId: string | null
  createdAt: string
}

export const BIDDING_TYPES = ['招标公告', '中标公告', '更正公告', '废标公告', '其他'] as const
