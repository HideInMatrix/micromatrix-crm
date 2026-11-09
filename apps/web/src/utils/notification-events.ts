export const NOTIFICATIONS_CHANGED_EVENT = 'crm:notifications-changed'

export function dispatchNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))
}
