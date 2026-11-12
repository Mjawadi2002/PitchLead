import { createContext, useContext } from 'react'
import type { ClaudeStatus, Lead, Project, Snapshot, UsageReport } from '@shared/types'

export type View = 'today' | 'research' | 'leads' | 'pipeline' | 'outreach' | 'settings'
export type LeadFilter = 'all' | 'high' | 'mid' | 'starred' | 'new'

export interface ToastOpts {
  action?: { label: string; run: () => void }
  ms?: number
}

export interface AppCtx {
  /** Data for the selected project only (or everything under "All projects"). */
  data: Snapshot
  /** Everything, across projects. */
  allData: Snapshot
  project: Project | null
  editProject: (id: string | 'new') => void
  claude: ClaudeStatus | null
  refreshClaude: () => Promise<void>
  view: View
  go: (v: View, opts?: { filter?: LeadFilter; leadId?: string | null }) => void
  leadId: string | null
  openLead: (id: string | null) => void
  filter: LeadFilter
  setFilter: (f: LeadFilter) => void
  outreachLeadId: string | null
  setOutreachLeadId: (id: string | null) => void
  toast: (text: string, opts?: ToastOpts) => void
  openPalette: () => void
  removeLeads: (leads: Lead[]) => void
  showOnboarding: () => void
  /** Effective state: the saved preference, or folded automatically on narrow windows. */
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  usage: UsageReport | null
  refreshUsage: (force?: boolean) => void
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)

export const spring = { type: 'spring' as const, bounce: 0, duration: 0.4 }
export const springSoft = { type: 'spring' as const, bounce: 0.12, duration: 0.45 }
