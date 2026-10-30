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
      width: 270,
      className: 'mobile-action-confirm-dialog',
      overlayClass: 'mobile-action-confirm-overlay',
      messageAlign: 'center',
      confirmButtonText: options.confirmButtonText ?? '确认',
      cancelButtonText: options.cancelButtonText ?? '取消',
      confirmButtonColor: '#F04438',
      cancelButtonColor: '#666666',
      closeOnClickOverlay: false,
    })
    return true
  } catch {
    return false
  }
}
