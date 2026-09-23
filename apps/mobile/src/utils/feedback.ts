import { showSuccessToast } from 'vant'

export function showSuccessFeedback(message: string) {
  return showSuccessToast({
    message,
    duration: 1200,
  })
}

export function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}
