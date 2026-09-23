import { showConfirmDialog } from 'vant'

export interface MobileConfirmDialogOptions {
  title: string
  message: string
  confirmButtonText?: string
  cancelButtonText?: string
}

export async function showActionConfirm(options: MobileConfirmDialogOptions): Promise<boolean> {
  try {
    await showConfirmDialog({
      title: options.title,
      message: options.message,
      confirmButtonText: options.confirmButtonText ?? '确认',
      cancelButtonText: options.cancelButtonText ?? '取消',
      closeOnClickOverlay: false,
    })
    return true
  } catch {
    return false
  }
}
