import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { CopySimple, MagnifyingGlass, Minus, Plus, SidebarSimple, SlidersHorizontal, Square, TerminalWindow, X } from '@phosphor-icons/react'
import type { TitlebarPrefs } from '@shared/types'
import { PHASES } from '@shared/types'
import { spring, useApp } from '../state'
import { Logo, Meter, Seg, Switch, fmtTokens, mod, resetsIn, usagePercent } from './ui'

const CRUMB = { today: 'Today', research: 'Research', leads: 'Leads', pipeline: 'Pipeline', outreach: 'Outreach', settings: 'Settings' }

export function TitleBar() {
  const { data, claude, view, go, openPalette, sidebarCollapsed, toggleSidebar, usage, project } = useApp()
  const pct = usagePercent(usage)
  const usageTone = usage?.limitHit ? 'neg' : pct !== null && pct >= 85 ? 'warn' : ''
  const usageTitle = usage?.freeActive
    ? 'Scoring and writing are using free models while your Claude limit resets.'
    : usage?.limitHit
    ? `Claude reported a usage limit: ${usage.limitHit.message}`
    : usage?.current
      ? `This 5-hour window: ${fmtTokens(usage.current.tokens)} tokens${pct !== null ? `, ${pct}% of your busiest window` : ''}. Resets in ${resetsIn(usage.current.end)}.`
      : 'No Claude use in the current 5-hour window'
  const tb = data.settings.titlebar
  const [pop, setPop] = useState(false)
  const [max, setMax] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    window.lp.win.isMaximized().then(setMax)
    return window.lp.win.onMaximized(setMax)
  }, [])
  useEffect(() => {
    if (!pop) return
    const close = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setPop(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPop(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [pop])

  const setTb = (patch: Partial<TitlebarPrefs>) => window.lp.settings.update({ titlebar: { ...tb, ...patch } })
  const running = data.runs.find((r) => r.status === 'running')
  const lastDone = data.runs.find((r) => r.status === 'done')

  let claudeChip: { text: string; tone: '' | 'warn' }
  if (!claude) claudeChip = { text: 'Checking Claude', tone: '' }
  else if (!claude.found) claudeChip = { text: 'Install Claude Code', tone: 'warn' }
  else if (!claude.loggedIn) claudeChip = { text: data.settings.mode === 'apikey' ? 'Add API key' : 'Sign in to Claude', tone: 'warn' }
  else if (claude.authMethod === 'apikey') claudeChip = { text: 'API key', tone: '' }
  else claudeChip = { text: `Claude ${claude.subscription ? claude.subscription[0].toUpperCase() + claude.subscription.slice(1) : ''}`.trim(), tone: '' }

  return (
    <header className="titlebar" onDoubleClick={(e) => e.target === e.currentTarget && window.lp.win.toggleMaximize()}>
      <div className="tb-left">
        {tb.controls === 'mac' && (
          <div className="traffic">
            <button className="t-close" aria-label="Close" onClick={() => window.lp.win.close()}><X size={8} weight="bold" /></button>
            <button className="t-min" aria-label="Minimize" onClick={() => window.lp.win.minimize()}><Minus size={8} weight="bold" /></button>
            <button className="t-max" aria-label={max ? 'Restore' : 'Maximize'} onClick={() => window.lp.win.toggleMaximize()}><Plus size={8} weight="bold" /></button>
          </div>
        )}
        <button
          className="icon-btn"
          aria-pressed={sidebarCollapsed}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={`Toggle sidebar (${mod()}+\\)`}
          onClick={toggleSidebar}
        >
          <SidebarSimple size={17} />
        </button>
        <div className="brand"><Logo size={20} /><span>Lead<span className="brand-p">Pitch</span></span></div>
        <span className="crumb">{project ? <><span className="crumb-proj">{project.name}</span><span className="crumb-sep">/</span></> : null}{CRUMB[view]}</span>
      </div>

      <div className="tb-center">
        {tb.search && (
          <button className="search-trigger" data-tour="search" onClick={openPalette} aria-label="Search leads and commands">
            <MagnifyingGlass size={15} />
            <span className="grow st-text">Search leads and commands</span>
            <span className="kbd st-text">{mod()} K</span>
          </button>
        )}
      </div>

      <div className="tb-right">
        {tb.run && (
          <button className="chip run-chip" onClick={() => go('research')} title="Research status">
            <span className={`dot ${running ? 'live' : lastDone ? '' : 'idle'}`} />
            {running
              ? (running.batches ?? 1) > 1 ? `Researching · ${running.leadIds.length} of ${running.input.count} leads` : `Researching · ${Math.max(1, running.phase)} of ${PHASES.length}`
              : lastDone
                ? `Last run · ${lastDone.leadIds.length} leads`
                : 'No runs yet'}
          </button>
        )}
        {tb.claude && (
          <button className={`chip claude-chip ${claudeChip.tone || (usageTone === 'neg' ? 'warn' : '')}`} onClick={() => go('settings')} title={`${claudeChip.text}. ${usageTitle}`}>
            <TerminalWindow size={14} />
            {claudeChip.text}
            {usage && claude?.loggedIn && (usage.freeActive ? <span className="usage-pct">Free models</span> : usage.limitHit ? <span className="usage-pct">Limit reached</span> : pct !== null && <><Meter value={pct} tone={usageTone as 'warn' | ''} /><span className="usage-pct num">{pct}%</span></>)}
          </button>
        )}
        {tb.newBtn && (
          <button className="btn btn-primary" onClick={() => go('research')} title={`New research (${mod()}+N)`}>
            <Plus size={14} weight="bold" />
            <span className="nb-text">New research</span>
          </button>
        )}
        <button ref={btnRef} className="icon-btn" aria-label="Customize title bar" aria-expanded={pop} aria-pressed={pop} onClick={() => setPop((p) => !p)}>
          <SlidersHorizontal size={17} />
        </button>
        {tb.controls === 'win' && (
          <div className="winctl">
            <button aria-label="Minimize" onClick={() => window.lp.win.minimize()}><Minus size={14} /></button>
            <button aria-label={max ? 'Restore' : 'Maximize'} onClick={() => window.lp.win.toggleMaximize()}>
              {max ? <CopySimple size={13} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} />}
            </button>
            <button className="close" aria-label="Close" onClick={() => window.lp.win.close()}><X size={14} /></button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {pop && (
          <motion.div
            ref={popRef}
            className="pop"
            role="dialog"
            aria-label="Customize title bar"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
            transition={spring}
          >
            <h3>Title bar</h3>
            <p className="sub">Choose what stays visible up here.</p>
            <div className="pop-group">
              <div className="pop-label">Show</div>
              <div className="row-toggle"><span>Search</span><Switch label="Show search" checked={tb.search} onChange={(v) => setTb({ search: v })} /></div>
              <div className="row-toggle"><span>Research status</span><Switch label="Show research status" checked={tb.run} onChange={(v) => setTb({ run: v })} /></div>
              <div className="row-toggle"><span>Claude connection</span><Switch label="Show Claude connection" checked={tb.claude} onChange={(v) => setTb({ claude: v })} /></div>
              <div className="row-toggle"><span>New research button</span><Switch label="Show new research button" checked={tb.newBtn} onChange={(v) => setTb({ newBtn: v })} /></div>
            </div>
            <div className="pop-group">
              <div className="pop-label">Window controls</div>
              <Seg label="Window controls" value={tb.controls} onChange={(v) => setTb({ controls: v })} options={[{ value: 'win', label: 'Windows' }, { value: 'mac', label: 'macOS' }]} />
            </div>
            <div className="pop-group">
              <div className="pop-label">Height</div>
              <Seg label="Height" value={tb.density} onChange={(v) => setTb({ density: v })} options={[{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }]} />
            </div>
            <div className="pop-group">
              <div className="pop-label">Material</div>
              <Seg label="Material" value={tb.material} onChange={(v) => setTb({ material: v })} options={[{ value: 'glass', label: 'Translucent' }, { value: 'solid', label: 'Solid' }]} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
