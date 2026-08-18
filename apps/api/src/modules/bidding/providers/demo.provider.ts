import { Injectable } from '@nestjs/common'
import { BiddingItem, BiddingProvider } from './bidding-provider.interface'

const REGIONS = ['广东省', '北京市', '上海市', '浙江省', '江苏省', '四川省']
const BUYERS = ['市政务服务中心', '教育局', '人民医院', '高新区管委会', '国有资产运营公司']
const TYPES = ['招标公告', '中标公告', '更正公告']

/**
 * 演示数据源：本地生成模拟标讯，用于验证订阅、抓取去重与转线索。
 */
@Injectable()
export class DemoBiddingProvider implements BiddingProvider {
  readonly key = 'demo'
  readonly label = '演示数据源（模拟数据）'
  readonly requiresCredentials = false

  async fetch(_credentials: Record<string, unknown>, keyword: string): Promise<BiddingItem[]> {
    const today = new Date()
    const count = 2 + Math.floor(Math.random() * 3)
    return Array.from({ length: count }, (_, i) => {
      const region = REGIONS[Math.floor(Math.random() * REGIONS.length)]
      const buyer = BUYERS[Math.floor(Math.random() * BUYERS.length)]
      const publishedAt = new Date(today.getTime() - i * 24 * 3600 * 1000)
      return {
        title: `${region}${buyer}${keyword}项目${TYPES[i % TYPES.length] === '中标公告' ? '中标' : '采购'}公告（${publishedAt.toISOString().slice(0, 10)}）`,
        type: TYPES[i % TYPES.length],
        region,
        buyer: `${region}${buyer}`,
        budget: Math.round((20 + Math.random() * 480) * 10000),
        publishedAt,
        deadline: new Date(publishedAt.getTime() + 14 * 24 * 3600 * 1000),
        sourceUrl: 'https://example.com/bidding/demo',
        content: `${region}${buyer}就「${keyword}」相关项目进行公开采购，预算金额详见正文，欢迎符合条件的供应商参与投标。（演示数据）`,
      }
    })
  }
}
