import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretUpDown, Check, PencilSimple, Plus, Stack } from '@phosphor-icons/react'
import { spring, useApp } from '../state'
import { ProjectMark } from './ProjectMark'

/** Project picker at the top of the sidebar. */
export function ProjectSwitcher() {
  const { allData, project, editProject } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The sidebar clips its contents (for the collapse animation), so the menu is drawn above the page.
  const [pos, setPos] = useState({ top: 0, left: 0, width: 260 })
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const place = () => {
      const r = ref.current!.getBoundingClientRect()
      const width = Math.max(260, r.width)
      setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - width - 12), width })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false) }
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
        {project ? <ProjectMark project={project} size={28} /> : (
          <span className="proj-sq all">{hasProjects ? <Stack size={13} /> : <Plus size={13} weight="bold" />}</span>
        )}
        <span className="txt proj-name">
          <span>Project</span>
          <b>{label}</b>
        </span>
        <CaretUpDown size={13} className="txt" />
      </button>
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            className="proj-menu"
            role="menu"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={spring}
          >
            {allData.projects.map((p) => (
              <button key={p.id} role="menuitem" className="proj-row" onClick={() => pick(p.id)}>
                <ProjectMark project={p} size={22} />
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
      </AnimatePresence>, document.body)}
    </div>
  )
}
