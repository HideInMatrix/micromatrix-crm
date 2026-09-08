import { PrismaPg } from '@prisma/adapter-pg'

export function createPrismaPgAdapter(connectionString: string) {
  try {
    const url = new URL(connectionString)
    const schema = url.searchParams.get('schema')?.trim() || undefined
    url.searchParams.delete('schema')
    return new PrismaPg({ connectionString: url.toString() }, schema ? { schema } : undefined)
  } catch {
    return new PrismaPg({ connectionString })
  }
}
