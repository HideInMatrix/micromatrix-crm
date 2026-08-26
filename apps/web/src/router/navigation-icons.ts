import type { NavigationModuleKey, TopNavigationKey } from '@micromatrix/shared'
import {
  Bell,
  Bot,
  CalendarDays,
  CircleHelp,
  ClipboardList,
  FileSignature,
  FileText,
  Handshake,
  House,
  Info,
  Languages,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Target,
  Users,
  Waypoints,
} from 'lucide-vue-next'
import type { Component } from 'vue'

const MODULE_ICONS: Record<NavigationModuleKey, Component> = {
  home: House,
  lead: Waypoints,
  customer: Users,
  opportunity: Handshake,
  product: Package,
  dashboard: LayoutDashboard,
  agent: Bot,
  contract: FileSignature,
  customForm: FileText,
  bidding: Target,
  order: ShoppingCart,
  system: Settings,
}

const TOP_NAVIGATION_ICONS: Record<TopNavigationKey, Component> = {
  search: Search,
  task: ClipboardList,
  event: CalendarDays,
  agent: Bot,
  notify: Bell,
  about: Info,
  language: Languages,
  help: CircleHelp,
}

export function moduleIconOf(moduleKey: NavigationModuleKey) {
  return MODULE_ICONS[moduleKey]
}

export function topNavigationIconOf(navigationKey: TopNavigationKey) {
  return TOP_NAVIGATION_ICONS[navigationKey]
}
