import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { CaretUpDown, Check, PencilSimple, Plus, Stack } from '@phosphor-icons/react'
import { PROJECT_COLORS } from '@shared/types'
import { spring, useApp } from '../state'

/** Project picker at the top of the sidebar. */
export function ProjectSwitcher() {
  const { allData, project, editProject } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const pick = (id: string) => {
    window.lp.settings.update({ activeProject: id })
    setOpen(false)
  }
  const count = (id: string) => allData.leads.filter((l) => l.projectId === id).length
  const hasProjects = allData.projects.length > 0
  const label = project?.name ?? (hasProjects ? 'All projects' : 'Create a project')
  const color = project ? PROJECT_COLORS[project.color % PROJECT_COLORS.length] : undefined

  return (
    <div className="proj" ref={ref}>
      <button
        className="proj-btn"
        data-tour="project-switch"
        data-tip={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => (hasProjects ? setOpen((o) => !o) : editProject('new'))}
      >
        <span className={`proj-sq ${project ? '' : 'all'}`} style={color ? { background: color } : undefined}>
          {project ? project.name.slice(0, 1).toUpperCase() : hasProjects ? <Stack size={13} /> : <Plus size={13} weight="bold" />}
        </span>
        <span className="txt proj-name">
          <span>Project</span>
          <b>{label}</b>
        </span>
        <CaretUpDown size={13} className="txt" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="proj-menu"
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={spring}
          >
            {allData.projects.map((p) => (
              <button key={p.id} role="menuitem" className="proj-row" onClick={() => pick(p.id)}>
                <span className="proj-sq sm" style={{ background: PROJECT_COLORS[p.color % PROJECT_COLORS.length] }}>{p.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow">{p.name}</span>
                <span className="muted num">{count(p.id)}</span>
                {project?.id === p.id && <Check size={13} weight="bold" color="var(--accent)" />}
              </button>
            ))}
            <button role="menuitem" className="proj-row" onClick={() => pick('all')}>
              <span className="proj-sq sm all"><Stack size={11} /></span>
              <span className="grow">All projects</span>
              <span className="muted num">{allData.leads.length}</span>
              {!project && <Check size={13} weight="bold" color="var(--accent)" />}
            </button>
            <div className="proj-sep" />
            <button role="menuitem" className="proj-row" onClick={() => { setOpen(false); editProject('new') }}>
              <Plus size={14} />
              <span className="grow">New project</span>
            </button>
            {project && (
              <button role="menuitem" className="proj-row" onClick={() => { setOpen(false); editProject(project.id) }}>
                <PencilSimple size={14} />
                <span className="grow">Edit {project.name}</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
