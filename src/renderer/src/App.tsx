import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClaudeStatus, Lead, Snapshot, UsageReport } from '@shared/types'
import { ProjectModal } from './components/ProjectModal'
import { Ctx, spring, type AppCtx, type LeadFilter, type ToastOpts, type View } from './state'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Palette } from './components/Palette'
import { LeadDrawer } from './components/LeadDrawer'
import { Tour, startTour } from './components/Tour'
import { ResearchDock } from './components/ResearchDock'
import { Today } from './views/Today'
import { Research } from './views/Research'
import { Leads } from './views/Leads'
import { Pipeline } from './views/Pipeline'
import { Outreach } from './views/Outreach'
import { SettingsView } from './views/Settings'

const VIEWS: View[] = ['today', 'research', 'leads', 'pipeline', 'outreach', 'settings']

export function App() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [claude, setClaude] = useState<ClaudeStatus | null>(null)
  const [view, setView] = useState<View>('today')
  const [leadId, setLeadId] = useState<string | null>(null)
  const [filter, setFilter] = useState<LeadFilter>('all')
  const [outreachLeadId, setOutreachLeadId] = useState<string | null>(null)
  const [palette, setPalette] = useState(false)
  const [toastState, setToastState] = useState<{ id: number; text: string; opts?: ToastOpts } | null>(null)
  const toastTimer = useRef<number>()
  const toastRef = useRef<((text: string, opts?: ToastOpts) => void) | null>(null)

  // Messages from the mail system (replies, bounces) appear as toasts.
  useEffect(() => window.lp.onToast((t) => toastRef.current?.(t, { ms: 6000 })), [])

  // Narrow windows fold the sidebar to icons without changing the saved preference.
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1000)
  const [peek, setPeek] = useState(false)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1000)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { if (!narrow) setPeek(false) }, [narrow])

  useEffect(() => {
    window.lp.data.get().then((s) => {
      setData(s)
      // First launch (and anyone who has not seen it yet) gets the guided tour.
      if (s.settings.tour?.status === 'new') startTour()
    })
    return window.lp.data.onChange(setData)
  }, [])

  // Claude usage from local session logs, refreshed every minute and when runs end.
  const [usage, setUsage] = useState<UsageReport | null>(null)
  const refreshUsage = useCallback(() => { window.lp.usage.get().then(setUsage).catch(() => {}) }, [])
  const runsKey = data ? data.runs.map((r) => r.status).join() : ''
  useEffect(() => {
    refreshUsage()
    const t = setInterval(refreshUsage, 60_000)
    window.addEventListener('focus', refreshUsage)
    return () => { clearInterval(t); window.removeEventListener('focus', refreshUsage) }
  }, [refreshUsage])
  useEffect(() => { refreshUsage() }, [runsKey, refreshUsage])
  // Free models switching on or off changes the title bar right away.
  const freeMode = data?.settings.fallback?.mode
  useEffect(() => { refreshUsage() }, [freeMode, refreshUsage])
  useEffect(() => window.lp.free.onChange(refreshUsage), [refreshUsage])

  const refreshClaude = useCallback(async () => {
    setClaude(await window.lp.claude.status())
  }, [])
  useEffect(() => {
    refreshClaude()
    const onFocus = () => refreshClaude()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshClaude, data?.settings.mode, data?.hasApiKey, data?.settings.claudePath])

  const toast = useCallback((text: string, opts?: ToastOpts) => {
    window.clearTimeout(toastTimer.current)
    setToastState({ id: Date.now(), text, opts })
    toastTimer.current = window.setTimeout(() => setToastState(null), opts?.ms ?? (opts?.action ? 5000 : 2400))
  }, [])

  toastRef.current = toast

  const go = useCallback<AppCtx['go']>((v, opts) => {
    setView(v)
    if (opts?.filter) setFilter(opts.filter)
    if (opts && 'leadId' in opts) setLeadId(opts.leadId ?? null)
    else if (v !== 'leads' && v !== 'pipeline' && v !== 'today') setLeadId(null)
  }, [])

  const toggleSidebar = useCallback(() => {
    if (narrow) setPeek((p) => !p)
    else if (data) window.lp.settings.update({ sidebarCollapsed: !data.settings.sidebarCollapsed })
  }, [narrow, data])

  const removeLeads = useCallback(
    (leads: Lead[]) => {
      if (!leads.length) return
      window.lp.leads.remove(leads.map((l) => l.id))
      setLeadId((cur) => (cur && leads.some((l) => l.id === cur) ? null : cur))
      toast(leads.length === 1 ? `Deleted ${leads[0].name}` : `Deleted ${leads.length} leads`, {
        action: {
          label: 'Undo',
          run: () => {
            for (const l of leads) window.lp.leads.add(l)
          }
        }
      })
    },
    [toast]
  )

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = e.ctrlKey || e.metaKey
      if (m && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      } else if (m && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      } else if (m && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        go('research')
      } else if (m && /^[1-6]$/.test(e.key)) {
        e.preventDefault()
        go(VIEWS[Number(e.key) - 1])
      } else if (m && e.key === ',') {
        e.preventDefault()
        go('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, go, toggleSidebar])

  const sidebarCollapsed = !!data && (narrow ? !peek : data.settings.sidebarCollapsed)
  // Every screen sees only the selected project. Running research stays visible everywhere.
  const [projectModal, setProjectModal] = useState<string | null>(null)
  const active = data?.settings.activeProject ?? 'all'
  const scoped = useMemo<Snapshot | null>(() => {
    if (!data) return null
    if (active === 'all' || !data.projects.some((p) => p.id === active)) return data
    const leads = data.leads.filter((l) => l.projectId === active)
    const ids = new Set(leads.map((l) => l.id))
    return { ...data, leads, runs: data.runs.filter((r) => r.projectId === active || r.status === 'running'), drafts: data.drafts.filter((d) => ids.has(d.leadId)), outbox: data.outbox.filter((o) => ids.has(o.leadId)) }
  }, [data, active])
  const project = data?.projects.find((p) => p.id === active) ?? null

  const ctx = useMemo<AppCtx | null>(
    () =>
      data && scoped && {
        data: scoped,
        allData: data,
        project,
        editProject: (id) => setProjectModal(id),
        claude,
        refreshClaude,
        view,
        go,
        leadId,
        openLead: setLeadId,
        filter,
        setFilter,
        outreachLeadId,
        setOutreachLeadId,
        toast,
        openPalette: () => setPalette(true),
        removeLeads,
        showOnboarding: () => { startTour() },
        sidebarCollapsed,
        toggleSidebar,
        usage,
        refreshUsage
      },
    [data, scoped, project, claude, refreshClaude, view, go, leadId, filter, outreachLeadId, toast, removeLeads, sidebarCollapsed, toggleSidebar, usage, refreshUsage]
  )

  if (!ctx || !data) return <div className="app" />
  const tb = data.settings.titlebar
  const lead = leadId ? data.leads.find((l) => l.id === leadId) : undefined
  const drawerViews: View[] = ['leads', 'pipeline', 'today']

  return (
    <Ctx.Provider value={ctx}>
      <div
        className="app"
        data-collapsed={sidebarCollapsed}
        data-narrow={narrow}
        data-density={tb.density}
        data-material={tb.material}
        data-controls={tb.controls}
      >
        <TitleBar />
        <div className="body">
          <Sidebar />
          <main className="content" id="content">
            {/* Enter-only transition. Waiting on an exit animation let the Pipeline's
                layout cards hold the old view open, which left the next view blank. */}
            <motion.div key={view} initial={{ opacity: 0.35, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}>
                {view === 'today' && <Today />}
                {view === 'research' && <Research />}
                {view === 'leads' && <Leads />}
                {view === 'pipeline' && <Pipeline />}
                {view === 'outreach' && <Outreach />}
                {view === 'settings' && <SettingsView />}
            </motion.div>
          </main>
          <AnimatePresence>{lead && drawerViews.includes(view) && <LeadDrawer key="drawer" lead={lead} />}</AnimatePresence>
        </div>

        <ResearchDock />
        <AnimatePresence>{palette && <Palette key="palette" onClose={() => setPalette(false)} />}</AnimatePresence>
        <Tour />
        <AnimatePresence>{projectModal && <ProjectModal key={projectModal} id={projectModal} onClose={() => setProjectModal(null)} />}</AnimatePresence>
        <AnimatePresence>
          {toastState && (
            <motion.div
              key={toastState.id}
              className={`toast ${toastState.opts?.action ? '' : 'plain'}`}
              role="status"
              initial={{ opacity: 0, y: 14, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 8, x: '-50%', transition: { duration: 0.15 } }}
              transition={spring}
            >
              {toastState.text}
              {toastState.opts?.action && (
                <button
                  className="toast-act"
                  onClick={() => {
                    toastState.opts?.action?.run()
                    setToastState(null)
                  }}
                >
                  {toastState.opts.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}
