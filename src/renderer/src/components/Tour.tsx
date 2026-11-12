import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle, X } from '@phosphor-icons/react'
import { spring, useApp, type AppCtx, type View } from '../state'
import { Logo, mod } from './ui'

/**
 * Guided first-run tour. Each step points at a real control, asks the person to do the
 * real thing (sign in, connect mail, run a search, open a lead, write a sequence), and moves
 * on by itself when that is done. Steps that need an outside action can be skipped. Progress
 * is saved, and the tour can be replayed from Settings or the command palette.
 */

interface Step {
  id: string
  view?: View
  /** CSS selector of the control to highlight. No target shows a centered card. */
  target?: string
  title: string
  body: ReactNode
  /** What the person should do, shown as a checklist line. */
  task?: string
  /** True once the task is done. Steps without it continue with Next. */
  done?: (c: AppCtx, startedAt: number) => boolean
  /** Can be skipped while not done. */
  optional?: boolean
  /** Keep the app usable around the card (for long waits). */
  passive?: boolean
  /** Extra buttons on the card. */
  actions?: (c: AppCtx) => ReactNode
  /** Run when the step opens, for example to open a lead. */
  enter?: (c: AppCtx) => void
}

const latestRun = (c: AppCtx, startedAt: number) => c.data.runs.find((r) => r.createdAt >= startedAt)

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to LeadPitch',
    body: (
      <>
        <p>In about ten minutes you will connect Claude and your mailbox, find your first leads, and write your first email sequence.</p>
        <p className="muted">Each step points at the real control. Do the step and the tour moves on by itself. You can skip a step, leave the tour, and replay it any time from Settings.</p>
      </>
    )
  },
  {
    id: 'claude',
    view: 'settings',
    target: '[data-tour="claude-card"]',
    title: 'Connect Claude',
    body: <p>LeadPitch uses Claude Code on this computer with your Claude subscription. No API key and no other paid service.</p>,
    task: 'Claude Code is installed and signed in',
    done: (c) => !!c.claude?.found && !!c.claude?.loggedIn,
    actions: (c) => (
      <>
        {!c.claude?.found && <button className="btn btn-ghost" onClick={() => window.lp.shell.open('https://docs.claude.com/en/docs/claude-code/setup')}>How to install</button>}
        {c.claude?.found && !c.claude.loggedIn && <button className="btn btn-ghost" onClick={() => window.lp.claude.signIn()}>Sign in</button>}
        <button className="btn btn-plain" onClick={() => c.refreshClaude()}>Check again</button>
      </>
    )
  },
  {
    id: 'name',
    view: 'settings',
    target: '[data-tour="sender-name"]',
    title: 'Your name',
    body: <p>Claude signs your emails with it. Type it, then click anywhere outside the field.</p>,
    task: 'Your name is saved',
    done: (c) => !!c.data.settings.senderName.trim()
  },
  {
    id: 'mailbox',
    view: 'settings',
    target: '[data-tour="mail-card"]',
    title: 'Connect your mailbox',
    body: (
      <>
        <p>LeadPitch sends from your own address. Pick your provider, enter your email, then paste an <b>app password</b>. That is a separate password your provider creates for apps; your normal password will not work.</p>
        <p className="muted">Gmail: turn on 2-step verification, then create one at myaccount.google.com/apppasswords. Prefer to copy emails by hand? Skip this step.</p>
      </>
    ),
    task: 'Email address and app password saved',
    done: (c) => !!c.data.settings.mail.address && c.data.hasMailPassword,
    optional: true,
    actions: (c) => c.data.settings.mail.provider !== 'other' ? (
      <button className="btn btn-ghost" onClick={() => window.lp.shell.open(c.data.settings.mail.provider === 'outlook' ? 'https://account.live.com/proofs/AppPassword' : 'https://myaccount.google.com/apppasswords')}>Create an app password</button>
    ) : null
  },
  {
    id: 'mailtest',
    view: 'settings',
    target: '[data-tour="mail-test"]',
    title: 'Test the connection',
    body: <p>Click <b>Test</b>. Then <b>Send test email</b> to see exactly what your recipients will get, in your own inbox.</p>,
    task: 'The mailbox connection works',
    done: (c) => c.data.mailStatus.connected,
    optional: true
  },
  {
    id: 'project',
    target: '[data-tour="project-switch"]',
    title: 'Create a project',
    body: (
      <>
        <p>A project is one thing you sell: a product or a service, who buys it, and where. Each project keeps its own leads, pipeline and outreach.</p>
        <p className="muted">Click the project button at the top of the sidebar, or use the button below.</p>
      </>
    ),
    task: 'A project exists',
    done: (c) => c.allData.projects.length > 0,
    actions: (c) => <button className="btn btn-ghost" onClick={() => c.editProject('new')}>New project</button>
  },
  {
    id: 'describe',
    view: 'research',
    target: '[data-tour="research-product"]',
    title: 'Describe what you sell',
    body: <p>This comes from your project. Make it two or three sentences: what it is, who it is for, and the problem it solves. Claude judges every company against it.</p>
  },
  {
    id: 'icp',
    view: 'research',
    target: '[data-tour="research-icp"]',
    title: 'Who buys it, and where',
    body: <p>An industry and a place work best, for example "Cafés and restaurants" in "Sousse, Tunisia". Local businesses are found on the free map; anything else through web search.</p>
  },
  {
    id: 'engine',
    view: 'research',
    target: '[data-tour="research-engine"]',
    title: 'Fast or Deep',
    body: <p><b>Fast</b> reads maps and websites with code and asks Claude only to score, so it is quick and light on your plan. <b>Deep</b> has Claude research each company. Start with Fast and about 10 leads.</p>
  },
  {
    id: 'start',
    view: 'research',
    target: '[data-tour="research-start"]',
    title: 'Start your first search',
    body: <p>Click <b>Start research</b>. A run of 10 leads usually takes three to eight minutes.</p>,
    task: 'Research started',
    done: (c, t) => !!latestRun(c, t)
  },
  {
    id: 'watch',
    view: 'research',
    target: '[data-tour="run-panel"]',
    passive: true,
    title: 'Watch it work',
    body: (
      <>
        <p>Each step and every company it reads show up here. You can go anywhere in the app meanwhile; a small panel in the corner keeps you posted and has a Stop button.</p>
        <p className="muted">This step finishes when the run does.</p>
      </>
    ),
    task: 'Research finished',
    done: (c, t) => { const r = latestRun(c, t); return !!r && r.status !== 'running' },
    optional: true
  },
  {
    id: 'open-lead',
    view: 'leads',
    target: '[data-tour="lead-row"]',
    title: 'Your leads, best first',
    body: <p>Every company has a fit score from 1 to 10, the reason, and who to contact. Click the top one.</p>,
    task: 'A lead is open',
    done: (c) => !!c.leadId
  },
  {
    id: 'lead-panel',
    view: 'leads',
    target: '[data-tour="drawer-contact"]',
    title: 'Everything about this lead',
    body: <p>Published email, phone and pages, then the buying signal, why they fit, and how to open the conversation. No email yet? <b>Find contact details</b> searches the web for it.</p>,
    enter: (c) => { if (!c.leadId) { const top = [...c.data.leads].sort((a, b) => b.score - a.score)[0]; if (top) c.openLead(top.id) } }
  },
  {
    id: 'to-outreach',
    view: 'leads',
    target: '[data-tour="drawer-write"]',
    title: 'Write to them',
    body: <p>Click <b>Write message</b>.</p>,
    task: 'Outreach is open',
    done: (c) => c.view === 'outreach',
    enter: (c) => { if (!c.leadId) { const top = [...c.data.leads].sort((a, b) => b.score - a.score)[0]; if (top) c.openLead(top.id) } }
  },
  {
    id: 'sequence',
    view: 'outreach',
    target: '[data-tour="outreach-editor"]',
    title: 'Write a sequence with Claude',
    body: <p>Click <b>Write sequence with Claude</b>. You get a first email, two follow-ups and a LinkedIn note, built from the lead's research, in English, French or Arabic. Everything stays editable.</p>,
    task: 'A sequence is written',
    done: (c) => { const id = c.outreachLeadId ?? [...c.data.leads].sort((a, b) => b.score - a.score)[0]?.id; return c.data.drafts.some((d) => d.leadId === id && d.channel === 'email') }
  },
  {
    id: 'send',
    view: 'outreach',
    target: '[data-tour="send-bar"]',
    title: 'Send when you are ready',
    body: (
      <>
        <p><b>Send sequence</b> asks you to confirm, then mails the first email in your sending hours. Follow-ups only go out if they have not replied, and stop as soon as they do.</p>
        <p className="muted">No need to send now. Your daily limit, sending hours and opt-out line are in Settings, under Email.</p>
      </>
    )
  },
  {
    id: 'pipeline',
    view: 'pipeline',
    target: '[data-tour="board"]',
    title: 'Track every conversation',
    body: <p>Drag a company to the next stage as things move. Sending the first email moves it to Contacted, and a reply moves it to Replied, by themselves.</p>
  },
  {
    id: 'search',
    target: '[data-tour="search"]',
    title: 'Find anything fast',
    body: <p>Press <span className="kbd">{mod()} K</span> to jump to any lead, view or action. The title bar also shows your research progress and how much of your Claude usage window you have used.</p>
  },
  {
    id: 'finish',
    view: 'today',
    title: 'You are set',
    body: (
      <>
        <p>Today shows who to contact next and which follow-ups are due. Start a new search any time with <span className="kbd">{mod()} N</span>.</p>
        <p className="muted">Replay this tour from Settings, or from {mod()} K, "Take the tour".</p>
      </>
    )
  }
]

interface Box { top: number; left: number; width: number; height: number }
const PAD = 8
const CARD_W = 360

function useTargetRect(selector: string | undefined, stepKey: string): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  const scrolled = useRef('')
  const lastScroll = useRef(0)
  useLayoutEffect(() => {
    if (!selector) { setBox(null); return }
    let raf = 0
    let last = ''
    const tick = () => {
      const el = document.querySelector(selector) as HTMLElement | null
      if (el) {
        const r = el.getBoundingClientRect()
        // Bring the control into view when the step starts, and again if it ends up fully off-screen.
        const offscreen = r.bottom < 60 || r.top > window.innerHeight - 20
        if (scrolled.current !== stepKey || (offscreen && Date.now() - lastScroll.current > 900)) {
          scrolled.current = stepKey
          lastScroll.current = Date.now()
          el.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? 'start' : 'center', behavior: 'smooth' })
        }
        const b = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
        const key = `${Math.round(b.top)}|${Math.round(b.left)}|${Math.round(b.width)}|${Math.round(b.height)}`
        if (key !== last) { last = key; setBox(r.width && r.height ? b : null) }
      } else if (last !== 'none') {
        last = 'none'
        setBox(null)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [selector, stepKey])
  return box
}

/** Puts the card beside the highlighted control, on whichever side has room. */
function placeCard(box: Box | null, cardH: number): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const m = 16
  if (!box) return { top: Math.max(m, vh / 2 - cardH / 2), left: vw / 2 - CARD_W / 2 }
  const clampTop = (t: number) => Math.min(Math.max(m + 48, t), vh - cardH - m)
  const clampLeft = (l: number) => Math.min(Math.max(m, l), vw - CARD_W - m)
  if (box.left + box.width + m + CARD_W < vw - m) return { top: clampTop(box.top), left: box.left + box.width + m }
  if (box.left - m - CARD_W > m) return { top: clampTop(box.top), left: box.left - m - CARD_W }
  if (box.top + box.height + m + cardH < vh - m) return { top: box.top + box.height + m, left: clampLeft(box.left) }
  if (box.top - m - cardH > m + 48) return { top: box.top - m - cardH, left: clampLeft(box.left) }
  return { top: vh - cardH - m, left: vw - CARD_W - m }
}

export function Tour() {
  const c = useApp()
  const tour = c.data.settings.tour
  const active = tour.status === 'active'
  const index = Math.min(tour.step, STEPS.length - 1)
  const step = STEPS[index]
  const done = !!step.done?.(c, tour.startedAt)
  const box = useTargetRect(active ? step.target : undefined, `${step.id}:${tour.startedAt}`)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(240)
  const [, force] = useState(0)

  const save = useCallback((patch: Partial<typeof tour>) => window.lp.settings.update({ tour: { ...tour, ...patch } }), [tour])
  const goTo = useCallback((i: number) => {
    if (i >= STEPS.length) save({ status: 'done', step: 0 })
    else save({ step: Math.max(0, i) })
  }, [save])

  // Open the right screen and prepare it when a step starts.
  useEffect(() => {
    if (!active) return
    if (step.view && c.view !== step.view && !(step.id === 'to-outreach' && c.view === 'outreach')) c.go(step.view, step.view === 'leads' ? { filter: 'all', leadId: c.leadId } : undefined)
    step.enter?.(c)
  }, [active, step.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Action steps move on by themselves a moment after the action is done.
  // The timer depends only on the step and its done state, so data refreshes cannot restart it.
  const goRef = useRef(goTo)
  goRef.current = goTo
  const hasCheck = !!step.done
  const cameBack = useRef(-1)
  useEffect(() => {
    if (!active || !hasCheck || !done || cameBack.current === index) return
    const t = setTimeout(() => goRef.current(index + 1), 1100)
    return () => clearTimeout(t)
  }, [active, hasCheck, done, index])

  useLayoutEffect(() => { if (cardRef.current) setCardH(cardRef.current.offsetHeight) })
  useEffect(() => {
    const onResize = () => force((x) => x + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea')) save({ status: 'skipped' }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, save])

  const pos = useMemo(() => placeCard(box, cardH), [box, cardH])
  if (!active) return null

  const centered = !step.target || !box
  const canNext = !step.done || done || step.optional
  const last = index === STEPS.length - 1
  const vw = window.innerWidth
  const vh = window.innerHeight

  return (
    <div className="tour" aria-live="polite">
      {/* Dim everything except the highlighted control, which stays clickable. */}
      {!step.passive && (centered ? (
        <motion.div className="tour-dim" style={{ inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      ) : box && (
        <>
          <div className="tour-dim" style={{ top: 0, left: 0, width: vw, height: Math.max(0, box.top) }} />
          <div className="tour-dim" style={{ top: box.top + box.height, left: 0, width: vw, height: Math.max(0, vh - box.top - box.height) }} />
          <div className="tour-dim" style={{ top: box.top, left: 0, width: Math.max(0, box.left), height: box.height }} />
          <div className="tour-dim" style={{ top: box.top, left: box.left + box.width, width: Math.max(0, vw - box.left - box.width), height: box.height }} />
        </>
      ))}
      {box && !centered && (
        <motion.div className={`tour-ring ${step.passive ? 'passive' : ''}`} initial={false} animate={{ top: box.top, left: box.left, width: box.width, height: box.height }} transition={spring} />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={cardRef}
          className={`tour-card ${centered ? 'center' : ''}`}
          role="dialog"
          aria-label={step.title}
          style={{ top: pos.top, left: pos.left, width: CARD_W }}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          transition={spring}
        >
          <div className="tc-head">
            {index === 0 || last ? <Logo size={28} /> : <span className="tc-count num">{index} of {STEPS.length - 2}</span>}
            <button className="icon-btn sm" aria-label="Leave the tour" title="Leave the tour (Esc)" onClick={() => save({ status: 'skipped' })}><X size={13} /></button>
          </div>
          <div className="tc-progress" aria-hidden><i style={{ width: `${(index / (STEPS.length - 1)) * 100}%` }} /></div>
          <h3>{step.title}</h3>
          <div className="tc-body">{step.body}</div>
          {step.task && (
            <div className={`tc-task ${done ? 'ok' : ''}`}>
              {done ? <CheckCircle size={16} weight="fill" /> : <span className="tc-dot" />}
              <span>{step.task}</span>
            </div>
          )}
          {step.actions && <div className="tc-actions">{step.actions(c)}</div>}
          <div className="tc-foot">
            {index > 0 && !last && <button className="btn btn-plain" onClick={() => { cameBack.current = index - 1; goTo(index - 1) }}><ArrowLeft size={13} />Back</button>}
            <span className="grow" />
            {index === 0 && <button className="btn btn-plain" onClick={() => save({ status: 'skipped' })}>Not now</button>}
            {step.done && !done && step.optional && <button className="btn btn-plain" onClick={() => goTo(index + 1)}>Skip this step</button>}
            {(!step.done || done || !step.optional) && (
              <button className="btn btn-primary" disabled={!canNext} onClick={() => goTo(index + 1)}>
                {index === 0 ? 'Start the tour' : last ? <><Check size={13} weight="bold" />Finish</> : done ? <>Next<ArrowRight size={13} /></> : step.done ? 'Waiting for you' : <>Next<ArrowRight size={13} /></>}
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Starts or restarts the tour from the first step. */
export function startTour(): Promise<unknown> {
  return window.lp.settings.update({ tour: { status: 'active', step: 0, startedAt: Date.now() } })
}

/** The corner research panel stays out of the way during the tour, except on the step about it. */
export function tourHidesDock(tour: { status: string; step: number }): boolean {
  return tour.status === 'active' && STEPS[Math.min(tour.step, STEPS.length - 1)]?.id !== 'watch'
}
