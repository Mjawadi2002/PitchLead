import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight, Buildings, Export, GearSix, House, Kanban, MagnifyingGlass, Moon, PaperPlaneTilt, Plus, SidebarSimple, Sun, UsersThree
} from '@phosphor-icons/react'
import { spring, useApp } from '../state'
import { stageLabel } from './ui'

interface Item {
  id: string
  group: string
  label: string
  sub?: string
  icon: ReactNode
  run: () => void
  keywords?: string
}

export function Palette({ onClose }: { onClose: () => void }) {
  const { data, go, openLead, toast } = useApp()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const ic = 16
    const nav: Item[] = [
      { id: 'n-research', group: 'Start', label: 'New research', icon: <Plus size={ic} />, run: () => go('research'), keywords: 'find leads run' },
      { id: 'n-today', group: 'Go to', label: 'Today', icon: <House size={ic} />, run: () => go('today') },
      { id: 'n-leads', group: 'Go to', label: 'Leads', icon: <UsersThree size={ic} />, run: () => go('leads', { filter: 'all' }) },
      { id: 'n-pipe', group: 'Go to', label: 'Pipeline', icon: <Kanban size={ic} />, run: () => go('pipeline') },
      { id: 'n-out', group: 'Go to', label: 'Outreach', icon: <PaperPlaneTilt size={ic} />, run: () => go('outreach') },
      { id: 'n-set', group: 'Go to', label: 'Settings', icon: <GearSix size={ic} />, run: () => go('settings') },
      {
        id: 'a-side', group: 'Actions', label: data.settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar', icon: <SidebarSimple size={ic} />,
        run: () => window.lp.settings.update({ sidebarCollapsed: !data.settings.sidebarCollapsed })
      },
      {
        id: 'a-theme', group: 'Actions', label: 'Switch to light or dark', icon: matchMedia('(prefers-color-scheme: dark)').matches ? <Sun size={ic} /> : <Moon size={ic} />,
        run: () => window.lp.settings.update({ theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark' }), keywords: 'theme appearance'
      },
      {
        id: 'a-export', group: 'Actions', label: 'Export all leads as CSV', icon: <Export size={ic} />,
        run: async () => {
          const p = await window.lp.leads.exportCsv(data.leads.map((l) => l.id))
          if (p) toast('Exported leads')
        }
      }
    ]
    const leads: Item[] = [...data.leads]
      .sort((a, b) => b.score - a.score)
      .map((l) => ({
        id: l.id,
        group: 'Leads',
        label: l.name,
        sub: `${l.location || l.industry} · ${stageLabel(l.stage)}`,
        icon: <Buildings size={ic} />,
        keywords: `${l.industry} ${l.location} ${l.decisionMaker} ${l.website}`,
        run: () => go('leads', { filter: 'all', leadId: l.id })
      }))
    return [...nav, ...leads]
  }, [data, go, toast])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items.filter((i) => i.group !== 'Leads').concat(items.filter((i) => i.group === 'Leads').slice(0, 5))
    const words = s.split(/\s+/)
    return items
      .map((i) => {
        const hay = `${i.label} ${i.keywords ?? ''} ${i.sub ?? ''}`.toLowerCase()
        if (!words.every((w) => hay.includes(w))) return null
        const rank = i.label.toLowerCase().startsWith(s) ? 0 : i.label.toLowerCase().includes(s) ? 1 : 2
        return { i, rank }
      })
      .filter(Boolean)
      .sort((a, b) => a!.rank - b!.rank)
      .map((x) => x!.i)
      .slice(0, 40)
  }, [q, items])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (i: Item | undefined) => {
    if (!i) return
    onClose()
    i.run()
  }

  let lastGroup = ''
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onMouseDown={onClose}>
      <motion.div
        className="palette"
        role="dialog"
        aria-label="Search"
        initial={{ opacity: 0, scale: 0.97, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
        transition={spring}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input">
          <MagnifyingGlass size={18} />
          <input
            autoFocus
            placeholder="Search leads, views and actions"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matches for "{q}"</div>}
          {results.map((r, idx) => {
            const header = r.group !== lastGroup ? <div className="palette-group">{r.group}</div> : null
            lastGroup = r.group
            return (
              <div key={r.id}>
                {header}
                <button className="palette-item" data-idx={idx} data-active={idx === active} onMouseMove={() => setActive(idx)} onClick={() => pick(r)}>
                  {r.icon}
                  <span>{r.label}</span>
                  {r.sub ? <span className="sub">{r.sub}</span> : idx === active ? <ArrowRight size={14} className="sub" /> : null}
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span><span className="kbd">Enter</span> open</span>
          <span><span className="kbd">Up</span> <span className="kbd">Down</span> move</span>
          <span><span className="kbd">Esc</span> close</span>
        </div>
      </motion.div>
    </motion.div>
  )
}
