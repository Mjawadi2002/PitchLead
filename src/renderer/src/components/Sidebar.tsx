import { GearSix, House, Kanban, MagnifyingGlass, PaperPlaneTilt, Star, EnvelopeSimple, UsersThree, Target } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { ProjectSwitcher } from './ProjectSwitcher'
import { useApp, type LeadFilter, type View } from '../state'

function Item({ view, filter, icon, label, count, live }: { view: View; filter?: LeadFilter; icon: ReactNode; label: string; count?: number; live?: boolean }) {
  const app = useApp()
  const current = app.view === view && (filter ? app.filter === filter : view !== 'leads' || app.filter === 'all' || app.filter === 'mid')
  return (
    <button className="nav-item" data-tip={label} aria-current={current ? 'page' : undefined} onClick={() => app.go(view, filter ? { filter } : view === 'leads' ? { filter: 'all' } : undefined)}>
      {icon}
      <span className="txt">{label}</span>
      {live ? <span className="dot live live-dot" /> : count ? <span className="count num">{count}</span> : null}
    </button>
  )
}

export function Sidebar() {
  const { data, claude } = useApp()
  const leads = data.leads
  const running = data.runs.some((r) => r.status === 'running')
  const toContact = leads.filter((l) => l.stage === 'qualified' || (l.stage === 'researched' && l.score >= 8)).length
  const name = data.settings.senderName || claude?.email?.split('@')[0] || 'You'
  const plan = data.settings.mode === 'apikey' ? 'API key' : claude?.subscription ? `Claude ${claude.subscription[0].toUpperCase()}${claude.subscription.slice(1)}` :'Claude subscription'
  const ic = 17

  return (
    <nav className="sidebar" aria-label="Main">
      <ProjectSwitcher />
      <Item view="today" icon={<House size={ic} />} label="Today" />
      <Item view="research" icon={<MagnifyingGlass size={ic} />} label="Research" live={running} />
      <Item view="leads" icon={<UsersThree size={ic} />} label="Leads" count={leads.length} />
      <Item view="pipeline" icon={<Kanban size={ic} />} label="Pipeline" />
      <Item view="outreach" icon={<PaperPlaneTilt size={ic} />} label="Outreach" count={toContact} />
      <div className="nav-label">Views</div>
      <Item view="leads" filter="high" icon={<Target size={ic} />} label="Fit 8 and above" count={leads.filter((l) => l.score >= 8).length} />
      <Item view="leads" filter="starred" icon={<Star size={ic} />} label="Starred" count={leads.filter((l) => l.starred).length} />
      <Item view="leads" filter="new" icon={<EnvelopeSimple size={ic} />} label="Not contacted" count={leads.filter((l) => l.stage === 'researched' || l.stage === 'qualified').length} />
      <div style={{ flex: 1 }} />
      <Item view="settings" icon={<GearSix size={ic} />} label="Settings" />
      <div className="side-foot">
        <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>
        <span className="txt">
          <b>{name}</b>
          <span>{plan}</span>
        </span>
      </div>
    </nav>
  )
}
