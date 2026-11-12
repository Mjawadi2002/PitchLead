import { randomUUID } from 'crypto'
import { promises as dns } from 'dns'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import type { Lang, Lead, MailSettings, OutboxItem } from '@shared/types'
import { db, mailStatus, save } from './store'

/**
 * Sending from the person's own mailbox (SMTP with an app password) and reading replies (IMAP).
 * Guards: nothing leaves without an explicit approval in the app, a daily cap, sending hours,
 * a pause of one to two minutes between messages, a do-not-contact list, an opt-out line,
 * and a check that the recipient's domain accepts mail. Follow-ups stop when the lead replies.
 */

let notify: () => void = () => {}
let toast: (text: string) => void = () => {}
let tickTimer: NodeJS.Timeout | null = null
let replyTimer: NodeJS.Timeout | null = null
let busy = false
let lastSentAt = 0

const mail = () => db.get().settings.mail
const password = () => db.getMailPassword()
const ready = () => !!(mail().address && password() && mail().smtpHost)
const dayKey = (t: number) => new Date(t).toDateString()

function transport(m: MailSettings, pw: string) {
  return nodemailer.createTransport({
    host: m.smtpHost,
    port: m.smtpPort,
    secure: m.smtpPort === 465,
    requireTLS: m.smtpPort !== 465,
    auth: { user: m.address, pass: pw },
    // LP_MAIL_TEST lets tests use a local mail server with a self-signed certificate.
    ...(process.env.LP_MAIL_TEST ? { requireTLS: false, ignoreTLS: true, tls: { rejectUnauthorized: false } } : {}),
    connectionTimeout: 20000,
    greetingTimeout: 15000
  })
}

function imap(m: MailSettings, pw: string) {
  return new ImapFlow({ host: m.imapHost, port: m.imapPort, secure: true, auth: { user: m.address, pass: pw }, logger: false, socketTimeout: 60000 })
}

const friendly = (e: unknown): string => {
  const msg = String((e as Error)?.message ?? e)
  if (/535|auth|credentials|password|login/i.test(msg)) return 'The mailbox refused the sign-in. Use an app password (not your normal password) and check the address.'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'Could not reach the mail server. Check the server name and your internet connection.'
  if (/ETIMEDOUT|timeout/i.test(msg)) return 'The mail server did not answer in time.'
  return msg.slice(0, 240)
}

export function sentToday(): number {
  const today = dayKey(Date.now())
  return db.get().outbox.filter((o) => o.status === 'sent' && o.sentAt && dayKey(o.sentAt) === today).length
}

function refreshStatus(patch: Partial<typeof mailStatus> = {}) {
  Object.assign(mailStatus, { sentToday: sentToday() }, patch)
  notify()
}

/** Emails and domains on the do-not-contact list, plus leads marked do-not-contact. */
function blocked(email: string, lead?: Lead): boolean {
  if (lead?.doNotContact) return true
  const e = email.toLowerCase().trim()
  const domain = e.split('@')[1] ?? ''
  return mail()
    .doNotContact.split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
    .some((x) => x === e || x === domain)
}

async function acceptsMail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]
  if (!domain) return false
  try {
    const mx = await dns.resolveMx(domain)
    if (mx.length) return true
  } catch { /* fall through to A record */ }
  try {
    const a = await dns.resolve4(domain)
    return a.length > 0
  } catch {
    return false
  }
}

/** Next moment inside the sending window (hours and weekdays). */
function nextWindow(from: number): number {
  const m = mail()
  const d = new Date(from)
  for (let i = 0; i < 14 * 24; i++) {
    const day = d.getDay()
    const okDay = m.weekends || (day !== 0 && day !== 6)
    const h = d.getHours()
    if (okDay && h >= m.startHour && h < m.endHour) return d.getTime()
    d.setHours(h + 1, 0, 0, 0)
  }
  return from
}

export async function testMailbox(): Promise<{ ok: boolean; message: string }> {
  const m = mail()
  const pw = password()
  if (!m.address || !pw) return { ok: false, message: 'Add your email address and app password first.' }
  try {
    await transport(m, pw).verify()
  } catch (e) {
    refreshStatus({ connected: false, lastError: friendly(e) })
    return { ok: false, message: `Sending: ${friendly(e)}` }
  }
  if (m.trackReplies && m.imapHost) {
    const c = imap(m, pw)
    try {
      await c.connect()
      await c.logout()
    } catch (e) {
      refreshStatus({ connected: true, lastError: `Reading replies: ${friendly(e)}` })
      return { ok: true, message: `Sending works. Reading replies failed: ${friendly(e)}` }
    }
  }
  refreshStatus({ connected: true, lastError: undefined })
  return { ok: true, message: m.trackReplies ? 'Sending and reply tracking both work.' : 'Sending works.' }
}

/** Sends a short message to the mailbox itself, so the person can see how mail looks. */
export async function sendTest(): Promise<{ ok: boolean; message: string }> {
  const m = mail()
  const pw = password()
  if (!m.address || !pw) return { ok: false, message: 'Add your email address and app password first.' }
  try {
    await transport(m, pw).sendMail({
      from: { name: m.fromName || db.get().settings.senderName || m.address, address: m.address },
      to: m.address,
      subject: 'LeadPitch test message',
      text: `This is a test from LeadPitch. Your mailbox is connected.\n\n${m.optOutLine}`
    })
    refreshStatus({ connected: true, lastError: undefined })
    return { ok: true, message: `Test message sent to ${m.address}.` }
  } catch (e) {
    refreshStatus({ lastError: friendly(e) })
    return { ok: false, message: friendly(e) }
  }
}

/**
 * Approves a sequence for one lead. The first email goes in the next sending window;
 * follow-ups are scheduled the configured number of days later and are cancelled if the lead replies.
 */
export async function queueSequence(o: { leadId: string; lang: Lang; steps: { subject: string; body: string }[]; sendNow?: boolean }): Promise<{ queued: number }> {
  const d = db.get()
  const lead = d.leads.find((l) => l.id === o.leadId)
  if (!lead) throw new Error('This lead no longer exists.')
  if (!ready()) throw new Error('Connect your mailbox in Settings first.')
  const to = lead.email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('This lead has no email address. Use Find contact details or add one.')
  if (blocked(to, lead)) throw new Error('This address is on your do-not-contact list.')
  if (!(await acceptsMail(to))) throw new Error(`The domain of ${to} does not accept mail. Check the address.`)
  const steps = o.steps.filter((s) => s.body.trim()).slice(0, 3)
  if (!steps.length) throw new Error('Write the email first.')
  if (d.outbox.some((x) => x.leadId === lead.id && x.status === 'scheduled')) throw new Error('A sequence for this lead is already scheduled. Cancel it in Outbox first.')
  const already = d.outbox.find((x) => x.leadId === lead.id && x.step === 0 && x.status === 'sent')
  if (already) throw new Error(`You already emailed ${lead.name} on ${new Date(already.sentAt!).toLocaleDateString()}. LeadPitch does not send the same first email twice.`)

  const days = mail().followUpDays
  const start = nextWindow(Date.now())
  steps.forEach((s, i) => {
    const item: OutboxItem = {
      id: randomUUID(),
      leadId: lead.id,
      step: i,
      to,
      subject: s.subject.trim() || `Re: ${steps[0].subject}`,
      body: s.body.trim(),
      lang: o.lang,
      status: 'scheduled',
      dueAt: i === 0 ? start : nextWindow(start + (days[i - 1] ?? 3 * i) * 86400000),
      createdAt: Date.now()
    }
    d.outbox.push(item)
  })
  save()
  refreshStatus()
  if (o.sendNow) setTimeout(tick, 500)
  return { queued: steps.length }
}

export function cancelOutbox(ids: string[]): void {
  for (const o of db.get().outbox) if (ids.includes(o.id) && o.status === 'scheduled') o.status = 'cancelled'
  save()
  refreshStatus()
}

/** Cancels every scheduled message for a lead (used when they reply, opt out or bounce). */
function stopLead(leadId: string): number {
  let n = 0
  for (const o of db.get().outbox) if (o.leadId === leadId && o.status === 'scheduled') { o.status = 'cancelled'; n++ }
  return n
}

async function sendItem(item: OutboxItem): Promise<void> {
  const d = db.get()
  const m = mail()
  const lead = d.leads.find((l) => l.id === item.leadId)
  if (!lead || blocked(item.to, lead) || ['replied', 'meeting', 'won', 'lost'].includes(lead.stage) && item.step > 0) {
    item.status = 'cancelled'
    item.error = !lead ? 'Lead deleted' : blocked(item.to, lead) ? 'On the do-not-contact list' : 'Lead already replied'
    return
  }
  const first = d.outbox.find((x) => x.leadId === item.leadId && x.step === 0 && x.status === 'sent')
  if (item.step > 0 && !first) {
    // The first email never went out; follow-ups make no sense on their own.
    item.status = 'cancelled'
    item.error = 'The first email was not sent'
    return
  }
  item.status = 'sending'
  save()
  try {
    const info = await transport(m, password()!).sendMail({
      from: { name: m.fromName || d.settings.senderName || m.address, address: m.address },
      to: item.to,
      subject: item.subject,
      text: m.optOutLine ? `${item.body}\n\n${m.optOutLine}` : item.body,
      ...(first?.messageId ? { inReplyTo: first.messageId, references: [first.messageId] } : {})
    })
    item.status = 'sent'
    item.sentAt = Date.now()
    item.messageId = info.messageId
    lastSentAt = Date.now()
    if (item.step === 0 && (lead.stage === 'researched' || lead.stage === 'qualified')) {
      lead.stage = 'contacted'
      lead.stageChangedAt = Date.now()
    }
    refreshStatus({ connected: true, lastError: undefined })
  } catch (e) {
    item.status = 'failed'
    item.error = friendly(e)
    refreshStatus({ lastError: friendly(e) })
    // A refused sign-in fails every message; stop trying until the person fixes it.
    if (/refused the sign-in/.test(item.error)) mailStatus.connected = false
  }
  save()
}

/** Sends at most one due message per tick, inside the window, under the daily cap, with a pause between sends. */
async function tick(): Promise<void> {
  if (busy || !ready()) return
  const m = mail()
  const now = Date.now()
  if (nextWindow(now) !== now) return
  if (sentToday() >= m.dailyLimit) return
  if (now - lastSentAt < 60000 + Math.random() * 60000) return
  const due = db.get().outbox.filter((o) => o.status === 'scheduled' && o.dueAt <= now).sort((a, b) => a.step - b.step || a.dueAt - b.dueAt)[0]
  if (!due) return
  busy = true
  try {
    await sendItem(due)
    notify()
  } finally {
    busy = false
  }
}

/** Looks for replies and bounces from contacted leads, newest first. */
export async function checkReplies(): Promise<{ replies: number; bounces: number }> {
  const m = mail()
  const pw = password()
  const d = db.get()
  const sent = d.outbox.filter((o) => o.status === 'sent' && o.sentAt)
  if (!m.trackReplies || !pw || !m.imapHost || !sent.length) return { replies: 0, bounces: 0 }
  const since = new Date(Math.min(...sent.map((o) => o.sentAt!)) - 86400000)
  const byAddress = new Map(sent.map((o) => [o.to.toLowerCase(), o.leadId]))
  const c = imap(m, pw)
  let replies = 0
  let bounces = 0
  try {
    await c.connect()
    const lock = await c.getMailboxLock('INBOX')
    try {
      const seqs = (await c.search({ since })) || []
      for (const seq of seqs.slice(-400)) {
        const msg = await c.fetchOne(String(seq), { envelope: true })
        if (!msg || !msg.envelope) continue
        const from = (msg.envelope.from?.[0]?.address ?? '').toLowerCase()
        const subject = msg.envelope.subject ?? ''
        const leadId = byAddress.get(from)
        if (leadId) {
          const lead = d.leads.find((l) => l.id === leadId)
          if (lead && (lead.stage === 'contacted' || lead.stage === 'researched' || lead.stage === 'qualified')) {
            lead.stage = 'replied'
            lead.stageChangedAt = Date.now()
            stopLead(lead.id)
            replies++
            toast(`${lead.name} replied. Follow-ups for them are stopped.`)
          }
          continue
        }
        if (/mailer-daemon|postmaster/i.test(from) || /undeliver|delivery status|failure notice|non remis|returned mail/i.test(subject)) {
          const full = await c.fetchOne(String(seq), { source: true })
          const text = full?.source?.toString('utf8').toLowerCase() ?? ''
          for (const [addr, id] of byAddress) {
            if (!text.includes(addr)) continue
            const lead = d.leads.find((l) => l.id === id)
            if (lead && !lead.doNotContact) {
              lead.doNotContact = true
              stopLead(lead.id)
              for (const o of d.outbox) if (o.leadId === id && o.status === 'sent' && o.to.toLowerCase() === addr) o.error = 'Bounced'
              bounces++
              toast(`Mail to ${lead.name} bounced. The address is marked do-not-contact.`)
            }
          }
        }
      }
    } finally {
      lock.release()
    }
    await c.logout()
    refreshStatus({ lastCheck: Date.now() })
  } catch (e) {
    refreshStatus({ lastError: `Reading replies: ${friendly(e)}` })
  }
  if (replies || bounces) save()
  return { replies, bounces }
}

export function startMail(opts: { notify: () => void; toast: (t: string) => void }): void {
  notify = opts.notify
  toast = opts.toast
  refreshStatus({ connected: ready() })
  tickTimer = setInterval(() => { tick().catch(() => {}) }, 20000)
  replyTimer = setInterval(() => { checkReplies().catch(() => {}) }, 5 * 60000)
  setTimeout(() => { checkReplies().catch(() => {}) }, 15000)
}

export function stopMail(): void {
  if (tickTimer) clearInterval(tickTimer)
  if (replyTimer) clearInterval(replyTimer)
}
