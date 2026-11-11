import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClaudeStatus, Lead, Snapshot } from '@shared/types'
import { Ctx, spring, type AppCtx, type LeadFilter, type ToastOpts, type View } from './state'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Palette } from './components/Palette'
import { LeadDrawer } from './components/LeadDrawer'
import { Onboarding } from './components/Onboarding'
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
  const [onboarding, setOnboarding] = useState(false)
  const [toastState, setToastState] = useState<{ id: number; text: string; opts?: ToastOpts } | null>(null)
  const toastTimer = useRef<number>()

  useEffect(() => {
    window.lp.data.get().then((s) => {
      setData(s)
      if (!s.settings.onboarded) setOnboarding(true)
    })
    return window.lp.data.onChange(setData)
  }, [])

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

  const go = useCallback<AppCtx['go']>((v, opts) => {
    setView(v)
    if (opts?.filter) setFilter(opts.filter)
    if (opts && 'leadId' in opts) setLeadId(opts.leadId ?? null)
    else if (v !== 'leads' && v !== 'pipeline' && v !== 'today') setLeadId(null)
  }, [])

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
        if (data) window.lp.settings.update({ sidebarCollapsed: !data.settings.sidebarCollapsed })
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
  }, [data, go])

  const ctx = useMemo<AppCtx | null>(
    () =>
      data && {
        data,
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
        showOnboarding: () => setOnboarding(true)
      },
    [data, claude, refreshClaude, view, go, leadId, filter, outreachLeadId, toast, removeLeads]
  )

  if (!ctx || !data) return <div className="app" />
  const tb = data.settings.titlebar
  const lead = leadId ? data.leads.find((l) => l.id === leadId) : undefined
  const drawerViews: View[] = ['leads', 'pipeline', 'today']

  return (
    <Ctx.Provider value={ctx}>
      <div
        className="app"
        data-collapsed={data.settings.sidebarCollapsed}
        data-density={tb.density}
        data-material={tb.material}
        data-controls={tb.controls}
      >
        <TitleBar />
        <div className="body">
          <Sidebar />
          <main className="content" id="content">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                transition={spring}
              >
                {view === 'today' && <Today />}
                {view === 'research' && <Research />}
                {view === 'leads' && <Leads />}
                {view === 'pipeline' && <Pipeline />}
                {view === 'outreach' && <Outreach />}
                {view === 'settings' && <SettingsView />}
              </motion.div>
            </AnimatePresence>
          </main>
          <AnimatePresence>{lead && drawerViews.includes(view) && <LeadDrawer key="drawer" lead={lead} />}</AnimatePresence>
        </div>

        <AnimatePresence>{palette && <Palette key="palette" onClose={() => setPalette(false)} />}</AnimatePresence>
        <AnimatePresence>{onboarding && <Onboarding key="onb" onClose={() => setOnboarding(false)} />}</AnimatePresence>
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
