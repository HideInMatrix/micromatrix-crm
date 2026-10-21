import type { NavigationModuleKey, TopNavigationKey } from '@micromatrix/shared'
import {
  Bell,
  CalendarDays,
  House,
  Settings,
  Users,
  Waypoints,
} from 'lucide-vue-next'
import type { Component } from 'vue'

const MODULE_ICONS: Record<NavigationModuleKey, Component> = {
  home: House,
  lead: Waypoints,
  customer: Users,
  system: Settings,
}

const TOP_NAVIGATION_ICONS: Record<TopNavigationKey, Component> = {
  event: CalendarDays,
  notify: Bell,
}

export function moduleIconOf(moduleKey: NavigationModuleKey) {
  return MODULE_ICONS[moduleKey]
}

export function topNavigationIconOf(navigationKey: TopNavigationKey) {
  return TOP_NAVIGATION_ICONS[navigationKey]
}
