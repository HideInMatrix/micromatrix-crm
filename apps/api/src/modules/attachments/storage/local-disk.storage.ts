import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { StoredFile, StorageProvider } from './storage-provider'

export class LocalDiskStorage implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  async save(tenantId: string, originalName: string, buffer: Buffer): Promise<StoredFile> {
    const now = new Date()
    const ext = path.extname(originalName).slice(0, 12)
    const relativePath = path.posix.join(
      tenantId,
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      `${randomUUID()}${ext}`,
    )
    const abs = this.resolveAbsolute(relativePath)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, buffer)
    return { relativePath, size: buffer.length }
  }

  resolveAbsolute(relativePath: string): string {
    const root = path.resolve(this.rootDir)
    const abs = path.resolve(root, relativePath)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error('非法存储路径')
    }
    return abs
  }

  async remove(relativePath: string): Promise<void> {
    await unlink(this.resolveAbsolute(relativePath)).catch(() => undefined)
  }
}
