export interface StoredFile {
  /** 相对存储根的路径，写入 attachments.path */
  relativePath: string
  size: number
}

export interface StorageProvider {
  save(tenantId: string, originalName: string, buffer: Buffer): Promise<StoredFile>
  resolveAbsolute(relativePath: string): string
  remove(relativePath: string): Promise<void>
}
