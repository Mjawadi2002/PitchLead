import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsClockwise, Check, Copy, EnvelopeSimple, LinkedinLogo, PaperPlaneTilt, PencilSimpleLine, Tray, WarningCircle, X } from '@phosphor-icons/react'
import type { Channel, Draft, Lang, OutboxItem } from '@shared/types'
import { spring, useApp } from '../state'
import { Empty, Score, Seg, ShowMore, stageLabel, timeAgo } from '../components/ui'

const shortRole = (s: string) => s.split(/[;(]/)[0].trim()
const clean = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const TWEAKS = ['Shorter', 'More formal', 'Warmer', 'Ask for a 15 minute call', 'Offer a quick demo']
const STEP_LABEL = ['Email 1', 'Follow-up 1', 'Follow-up 2']

function when(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `today ${time}`
  const tomorrow = new Date(today.getTime() + 86400000)
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

export function Outreach() {
  const { data, go } = useApp()
  const [tab, setTab] = useState<'write' | 'outbox'>('write')
  const scheduled = data.outbox.filter((o) => o.status === 'scheduled').length

  return (
    <div className="view">
      <div className="vh">
        <div>
          <h1>Outreach</h1>
          <p>Claude writes a short sequence from each lead's research. Edit it, then send it from your own mailbox or copy it.</p>
        </div>
        <div className="actions">
          <Seg label="Outreach view" value={tab} onChange={setTab} options={[{ value: 'write', label: 'Write' }, { value: 'outbox', label: scheduled ? `Outbox · ${scheduled}` : 'Outbox' }]} />
        </div>
      </div>
      {tab === 'write' ? <Writer /> : <Outbox onWrite={() => setTab('write')} />}
      {!data.settings.mail.address && tab === 'write' && (
        <p className="muted" style={{ marginTop: 14, fontSize: 12.5 }}>
          To send from LeadPitch, <button className="link-like" onClick={() => go('settings')}>connect your mailbox in Settings</button>. Until then, copy messages into your own email.
        </p>
      )}
    </div>
  )
}

function Writer() {
  const { data, outreachLeadId, setOutreachLeadId, go, toast } = useApp()
  const [channel, setChannel] = useState<Channel>('email')
  const [lang, setLang] = useState<Lang>(data.settings.defaultLang)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<'' | 'sequence' | 'step'>('')
  const [shown, setShown] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)

  const list = useMemo(
    () =>
      data.leads
        .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
        .sort((a, b) => {
          const hasA = data.drafts.some((d) => d.leadId === a.id) ? 1 : 0
          const hasB = data.drafts.some((d) => d.leadId === b.id) ? 1 : 0
          return hasB - hasA || Number(!!b.email) - Number(!!a.email) || b.score - a.score
        }),
    [data.leads, data.drafts]
  )
  const lead = data.leads.find((l) => l.id === outreachLeadId) ?? list[0]
  const curStep = channel === 'email' ? step : 0
  const draftFor = (s: number) => lead && data.drafts.find((d) => d.leadId === lead.id && d.channel === channel && d.lang === lang && (d.step ?? 0) === s)
  const draft = draftFor(curStep)
  const steps = [0, 1, 2].map((s) => (lead ? data.drafts.find((d) => d.leadId === lead.id && d.channel === 'email' && d.lang === lang && (d.step ?? 0) === s) : undefined))
  const outbox = lead ? data.outbox.filter((o) => o.leadId === lead.id) : []
  const activeSeq = outbox.filter((o) => o.status === 'scheduled')
  const firstSent = outbox.find((o) => o.step === 0 && o.status === 'sent')

  // Open on a channel and language that already has a draft for this lead.
  useEffect(() => {
    setStep(0)
    setConfirm(false)
    if (!lead || draft) return
    const any = data.drafts.filter((d) => d.leadId === lead.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (any) { setChannel(any.channel); setLang(any.lang) }
  }, [lead?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const saveTimer = useRef<number>()
  useEffect(() => {
    setSubject(draft?.subject ?? '')
    setBody(draft?.body ?? '')
    setError(null)
  }, [draft?.id, draft?.updatedAt, lead?.id, channel, lang, curStep]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lead) {
    return (
      <div className="card">
        <Empty icon={<PaperPlaneTilt size={22} />} title="No one to write to yet" action={<button className="btn btn-primary" onClick={() => go('research')}>Start research</button>}>
          Once you have leads, Claude drafts a sequence for each one from its research.
        </Empty>
      </div>
    )
  }

  const persist = (s: string, b: string) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const d: Draft = { id: draft?.id ?? crypto.randomUUID(), leadId: lead.id, channel, lang, step: curStep, subject: s, body: b, updatedAt: Date.now() }
      window.lp.drafts.save(d)
    }, 500)
  }
  const writeSequence = async () => {
    setBusy('sequence')
    setError(null)
    try { await window.lp.drafts.sequence({ leadId: lead.id, lang }) } catch (e) { setError(clean((e as Error).message)) } finally { setBusy('') }
  }
  const rewrite = async (instruction?: string) => {
    setBusy('step')
    setError(null)
    try { await window.lp.drafts.generate({ leadId: lead.id, channel, lang, instruction, step: curStep }) } catch (e) { setError(clean((e as Error).message)) } finally { setBusy('') }
  }
  const copy = async () => {
    const text = channel === 'email' && subject ? `${subject}\n\n${body}` : body
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into your email or LinkedIn.') } catch { toast('Could not copy') }
  }
  const markContacted = () => {
    window.lp.leads.update(lead.id, { stage: 'contacted' })
    toast(`${lead.name} moved to Contacted`, { action: { label: 'Undo', run: () => window.lp.leads.update(lead.id, { stage: lead.stage }) } })
  }
  const mailReady = !!(data.settings.mail.address && data.hasMailPassword)
  const readySteps = steps.filter((s) => s && s.body.trim()) as Draft[]
  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const r = await window.lp.mail.queue({ leadId: lead.id, lang, steps: readySteps.map((s) => ({ subject: s.subject, body: s.body })), sendNow: true })
      toast(r.queued > 1 ? `Sequence approved. The first email goes out shortly, follow-ups only if ${lead.name} does not reply.` : 'Email approved. It goes out shortly.')
      setConfirm(false)
    } catch (e) {
      setError(clean((e as Error).message))
    } finally {
      setSending(false)
    }
  }
  const li = data.linkedinStatus
  const openLinkedin = async () => {
    setError(null)
    // Save what is in the editor now, so the LinkedIn window shows exactly this note.
    window.clearTimeout(saveTimer.current)
    if (body.trim()) await window.lp.drafts.save({ id: draft?.id ?? crypto.randomUUID(), leadId: lead.id, channel: 'linkedin', lang, step: 0, subject: '', body, updatedAt: Date.now() })
    try { await window.lp.linkedin.open(lead.id) } catch (e) { setError(clean((e as Error).message)) }
  }
  const auth = error?.startsWith('AUTH:')
  const chars = body.length
  const days = data.settings.mail.followUpDays
  const hasAny = steps.some(Boolean) || draft

  return (
    <div className="outreach">
      <div className="card drafts" role="list">
        {list.slice(0, Math.max(shown, list.findIndex((x) => x.id === outreachLeadId) + 1)).map((l) => {
          const has = data.drafts.some((d) => d.leadId === l.id)
          const sent = data.outbox.some((o) => o.leadId === l.id && o.status === 'sent')
          const queued = data.outbox.some((o) => o.leadId === l.id && o.status === 'scheduled')
          return (
            <button key={l.id} className="draft-item" aria-current={l.id === lead.id} onClick={() => setOutreachLeadId(l.id)}>
              <b>{l.name}</b>
              <Score value={l.score} />
              <span className="sub">
                {l.email ? <EnvelopeSimple size={11} style={{ verticalAlign: '-1px', marginRight: 4, color: 'var(--accent)' }} /> : null}
                {shortRole(l.decisionMaker) || 'Contact'} · {stageLabel(l.stage)}{queued ? ' · Scheduled' : sent ? ' · Sent' : has ? ' · Draft ready' : ''}
              </span>
            </button>
          )
        })}
        <ShowMore shown={shown} total={list.length} step={30} noun="leads" onMore={() => setShown((n) => n + 30)} />
      </div>

      <div className="card editor" data-tour="outreach-editor">
        <div className="editor-head">
          <Seg label="Channel" value={channel} onChange={setChannel} options={[{ value: 'email', label: 'Email' }, { value: 'linkedin', label: 'LinkedIn' }]} />
          <Seg label="Language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'fr', label: 'French' }, { value: 'ar', label: 'Arabic' }]} />
          <div className="actions">
            {hasAny && <button className="btn btn-ghost" disabled={!!busy} onClick={writeSequence}><ArrowsClockwise size={14} />{busy === 'sequence' ? 'Writing' : 'Rewrite all'}</button>}
            <button className="btn btn-ghost" disabled={!body || !!busy} onClick={copy}><Copy size={14} />Copy</button>
          </div>
        </div>

        {channel === 'email' && (
          <div className="steps-row" role="tablist" aria-label="Sequence steps">
            {STEP_LABEL.map((label, i) => (
              <button key={label} role="tab" aria-selected={step === i} className={`step-tab ${step === i ? 'on' : ''}`} onClick={() => setStep(i)}>
                <span>{label}</span>
                <small>{i === 0 ? 'First message' : `Day ${days[i - 1] ?? (i === 1 ? 3 : 7)}, if no reply`}</small>
                {steps[i] ? <Check size={11} weight="bold" className="step-ok" /> : null}
              </button>
            ))}
          </div>
        )}

        <div className="to">
          <span>To</span>
          <b>{lead.contactName || shortRole(lead.decisionMaker) || 'Decision maker'}, {lead.name}</b>
          {channel === 'email' && lead.email && <span className="to-addr selectable">{lead.email}</span>}
          {channel === 'email' && !lead.email && <span className="muted">No email yet. Open the lead and use Find contact details.</span>}
        </div>

        {busy ? (
          <div className="msg-skel" aria-label="Writing">
            {busy === 'sequence' && <span className="muted" style={{ fontSize: 12.5 }}>Writing three emails and a LinkedIn note</span>}
            {channel === 'email' && <div className="skel" style={{ width: '45%', height: 14 }} />}
            {[92, 100, 86, 97, 60, 0, 94, 72].map((w, i) => <div key={i} className="skel" style={{ width: `${w}%`, opacity: w ? 1 : 0 }} />)}
          </div>
        ) : draft || body ? (
          <>
            {channel === 'email' && (
              <input className="subject" value={subject} placeholder="Subject" aria-label="Subject" dir={lang === 'ar' ? 'rtl' : 'ltr'}
                onChange={(e) => { setSubject(e.target.value); persist(e.target.value, body) }} />
            )}
            <textarea className="msg" value={body} aria-label="Message" dir={lang === 'ar' ? 'rtl' : 'ltr'}
              onChange={(e) => { setBody(e.target.value); persist(subject, e.target.value) }} />
            {channel === 'email' && data.settings.mail.optOutLine && <p className="optout muted">Added when sent: {data.settings.mail.optOutLine}</p>}
          </>
        ) : (
          <Empty icon={<PencilSimpleLine size={22} />} title={channel === 'email' ? (hasAny ? `No ${STEP_LABEL[curStep].toLowerCase()} yet` : 'No sequence yet') : 'No LinkedIn note yet'} action={
            <button className="btn btn-primary" onClick={channel === 'email' && !hasAny ? writeSequence : () => rewrite()}>{channel === 'email' && !hasAny ? 'Write sequence with Claude' : 'Write with Claude'}</button>}>
            {channel === 'email' && !hasAny ? 'Three emails (first message and two follow-ups) and a LinkedIn note, from this lead\'s research.' : 'Claude uses the signal, the value for them and the approach from this lead\'s research.'}
          </Empty>
        )}

        {error && (
          <div className="alert">
            <WarningCircle size={16} weight="fill" style={{ flex: 'none', marginTop: 1 }} />
            <div className="grow">{auth ? 'Claude needs you to sign in again.' : error}</div>
            {auth ? <button className="btn btn-ghost" onClick={() => window.lp.claude.signIn()}>Sign in</button> : null}
          </div>
        )}

        {(draft || body) && !busy && (
          <div className="editor-foot">
            {TWEAKS.map((t) => <button key={t} className="tweak" onClick={() => rewrite(t)}>{t}</button>)}
            <span className="grow" />
            <span className="muted num" style={{ color: channel === 'linkedin' && chars > 300 ? 'var(--warn)' : undefined }}>
              {channel === 'linkedin' ? `${chars} / 300` : `${body.split(/\s+/).filter(Boolean).length} words`}
            </span>
          </div>
        )}

        {channel === 'email' && readySteps.length > 0 && !busy && (
          <div className="send-bar" data-tour="send-bar">
            {firstSent && !activeSeq.length ? (
              <span className="grow">
                <b>Already contacted.</b> Email 1 was sent {timeAgo(firstSent.sentAt!)}
                {outbox.some((o) => o.step > 0 && o.status === 'sent') ? `, with ${outbox.filter((o) => o.step > 0 && o.status === 'sent').length} follow-up${outbox.filter((o) => o.step > 0 && o.status === 'sent').length > 1 ? 's' : ''}` : ''}
                {outbox.some((o) => o.step > 0 && o.status === 'cancelled') ? '. Remaining follow-ups were cancelled.' : '.'}
              </span>
            ) : activeSeq.length ? (
              <>
                <span className="grow">
                  <b>Sequence scheduled.</b> Next: {STEP_LABEL[activeSeq[0].step]} {when(activeSeq[0].dueAt)}. Follow-ups stop if they reply.
                </span>
                <button className="btn btn-ghost" onClick={() => window.lp.mail.cancel(activeSeq.map((o) => o.id))}><X size={13} />Cancel sequence</button>
              </>
            ) : !mailReady ? (
              <>
                <span className="grow muted">Connect your mailbox to send from LeadPitch.</span>
                <button className="btn btn-ghost" onClick={() => go('settings')}>Connect mailbox</button>
                {(lead.stage === 'researched' || lead.stage === 'qualified') && <button className="btn btn-ghost" onClick={markContacted}><Check size={14} />Mark as contacted</button>}
              </>
            ) : !lead.email ? (
              <span className="grow muted">This lead has no email address yet.</span>
            ) : (
              <>
                <span className="grow muted">{readySteps.length === 1 ? 'One email ready.' : `${readySteps.length} emails ready: first now, follow-ups after ${days.join(' and ')} days if no reply.`}</span>
                <button className="btn btn-primary" onClick={() => setConfirm(true)}><PaperPlaneTilt size={14} />{readySteps.length > 1 ? 'Send sequence' : 'Send'}</button>
              </>
            )}
          </div>
        )}

        {channel === 'linkedin' && body.trim() && !busy && (
          <div className="send-bar">
            {lead.linkedinSentAt ? (
              <span className="grow"><span className="li-sent"><Check size={11} weight="bold" />Sent on LinkedIn</span> <span className="muted">{timeAgo(lead.linkedinSentAt)}</span></span>
            ) : (
              <span className="grow muted">
                {li.connected
                  ? `Opens ${/linkedin\.com\/in\//i.test(lead.linkedin) ? 'their profile' : 'a search for the decision maker'} with this note ready. You press Send. ${li.sentToday} of ${data.settings.linkedin.dailyLimit} today.`
                  : 'Connect LinkedIn once, then send this note from your own profile.'}
                {chars > 300 && ' Connection notes are limited to 300 characters.'}
              </span>
            )}
            <button className={`btn ${lead.linkedinSentAt ? 'btn-ghost' : 'btn-primary'}`} onClick={openLinkedin}><LinkedinLogo size={14} />{li.connected ? (lead.linkedinSentAt ? 'Open on LinkedIn' : 'Message on LinkedIn') : 'Connect LinkedIn'}</button>
          </div>
        )}

        <AnimatePresence>
          {confirm && (
            <motion.div className="confirm" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={spring}>
              <div className="grow">
                <b>Send to {lead.email}?</b>
                <span>
                  {readySteps.length > 1
                    ? `"${readySteps[0].subject}" goes out in the next sending window, from ${data.settings.mail.address}. ${readySteps.length - 1} follow-up${readySteps.length > 2 ? 's' : ''} follow after ${days.slice(0, readySteps.length - 1).join(' and ')} days, only if they do not reply.`
                    : `"${readySteps[0].subject}" goes out in the next sending window, from ${data.settings.mail.address}.`}
                </span>
              </div>
              <button className="btn btn-plain" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={sending} onClick={send}>{sending ? 'Approving' : 'Approve and send'}</button>
            </motion.div>
          )}
        </AnimatePresence>

        {outbox.some((o) => o.status !== 'scheduled') && (
          <div className="history-mini">
            {outbox.filter((o) => o.status !== 'scheduled').slice(-4).reverse().map((o) => (
              <div key={o.id} className="hm-row">
                <span className={`pill o-${o.status}`}>{o.status === 'sent' ? 'Sent' : o.status === 'failed' ? 'Failed' : 'Cancelled'}</span>
                <span className="grow">{STEP_LABEL[o.step]}: {o.subject}</span>
                <span className="muted">{o.sentAt ? timeAgo(o.sentAt) : o.error ?? ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Outbox({ onWrite }: { onWrite: () => void }) {
  const { data, toast, go, setOutreachLeadId } = useApp()
  const [filter, setFilter] = useState<'scheduled' | 'sent' | 'other'>('scheduled')
  const [checking, setChecking] = useState(false)
  const items = data.outbox
    .filter((o) => (filter === 'scheduled' ? o.status === 'scheduled' || o.status === 'sending' : filter === 'sent' ? o.status === 'sent' : o.status === 'failed' || o.status === 'cancelled'))
    .sort((a, b) => (filter === 'scheduled' ? a.dueAt - b.dueAt : (b.sentAt ?? b.createdAt) - (a.sentAt ?? a.createdAt)))
  const leadName = (o: OutboxItem) => data.leads.find((l) => l.id === o.leadId)?.name ?? 'Deleted lead'
  const m = data.settings.mail
  const st = data.mailStatus

  const check = async () => {
    setChecking(true)
    try {
      const r = await window.lp.mail.checkReplies()
      toast(r.replies || r.bounces ? `${r.replies} replies and ${r.bounces} bounces found` : 'No new replies')
    } catch (e) {
      toast(clean((e as Error).message))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="card outbox">
      <div className="ob-head">
        <Seg label="Outbox filter" value={filter} onChange={setFilter} options={[{ value: 'scheduled', label: 'Scheduled' }, { value: 'sent', label: 'Sent' }, { value: 'other', label: 'Failed or cancelled' }]} />
        <span className="muted num">{st.sentToday} of {m.dailyLimit} sent today · {m.startHour}:00 to {m.endHour}:00{m.weekends ? '' : ', weekdays'}</span>
        <span className="grow" />
        {m.trackReplies && <button className="btn btn-ghost" disabled={checking || !data.hasMailPassword} onClick={check}><Tray size={14} />{checking ? 'Checking' : 'Check replies'}</button>}
      </div>
      {st.lastError && <div className="alert warn" style={{ margin: '0 16px 12px' }}><WarningCircle size={16} weight="fill" style={{ flex: 'none' }} /><div className="grow">{st.lastError}</div><button className="btn btn-ghost" onClick={() => go('settings')}>Settings</button></div>}
      {items.length === 0 ? (
        <Empty icon={<Tray size={22} />} title={filter === 'scheduled' ? 'Nothing scheduled' : filter === 'sent' ? 'Nothing sent yet' : 'Nothing here'} action={filter === 'scheduled' ? <button className="btn btn-primary" onClick={onWrite}>Write a sequence</button> : undefined}>
          {filter === 'scheduled' ? 'Approved emails wait here until their sending time.' : undefined}
        </Empty>
      ) : (
        <div className="ob-list">
          {items.slice(0, 200).map((o) => (
            <div key={o.id} className="ob-row">
              <button className="ob-lead" onClick={() => { setOutreachLeadId(o.leadId); onWrite() }}>
                <b>{leadName(o)}</b>
                <span>{STEP_LABEL[o.step]} · {o.to}</span>
              </button>
              <span className="ob-subject" title={o.body}>{o.subject}</span>
              <span className="muted ob-when num">
                {o.status === 'scheduled' ? when(o.dueAt) : o.status === 'sending' ? 'Sending' : o.sentAt ? when(o.sentAt) : ''}
              </span>
              <span className={`pill o-${o.status}`}>{o.error === 'Bounced' ? 'Bounced' : o.status === 'scheduled' ? 'Scheduled' : o.status === 'sent' ? 'Sent' : o.status === 'failed' ? 'Failed' : o.status === 'sending' ? 'Sending' : 'Cancelled'}</span>
              {o.status === 'scheduled' ? <button className="icon-btn sm" aria-label="Cancel" title="Cancel" onClick={() => window.lp.mail.cancel([o.id])}><X size={13} /></button> : <span title={o.error}>{o.error && o.error !== 'Bounced' ? <WarningCircle size={14} color="var(--warn)" /> : null}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
