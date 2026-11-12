import { randomUUID } from 'crypto'
import type { Lead, ResearchInput, Run, RunEvent, RunStage, Settings } from '@shared/types'
import { AUTH_ERROR, LIMIT_ERROR, ask, extractJson } from './claude'
import { deepPrompt, lookupPrompt, scorePrompt, webListPrompt } from './prompts'
import { findOnMap, tagsFor, type MapCandidate } from './sources/osm'
import { pool, readWebsite, type SiteFacts } from './sources/website'
import { noteLimit } from './usage'

/**
 * The fast engine. Code does the finding and reading; Claude only judges compact facts.
 *   1. find   map listings (free) plus a short Claude web-search list when needed
 *   2. read   websites with plain HTTP, after a cheap search-only lookup for missing sites
 *   3. score  20 companies per Claude call, no tools
 *   4. deep   optional web research on the leads that score 8 or more
 */

interface Candidate {
  name: string
  category: string
  location: string
  address: string
  website: string
  phone: string
  email: string
  socials: string[]
  note: string
  source: 'map' | 'web'
  chain: boolean
  site?: SiteFacts
}

const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9؀-ۿ]/g, '')
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, 6) : [])
const isUrl = (s: string) => /^https?:\/\/[^\s]+\.[a-z]{2,}/i.test(s)
const isSocial = (s: string) => /facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|x\.com|twitter\.com/i.test(s)

const ANGLES = [
  'business directories and "best of" lists for the location',
  'recent openings, launches and local news',
  'review sites and maps listings',
  'companies hiring now, from job boards',
  'industry associations and event listings'
]

export interface FastContext {
  run: Run
  input: ResearchInput
  settings: Settings
  apiKey: string | null
  existing: Lead[]
  target: number
  signal: AbortSignal
  push: (e: Omit<RunEvent, 't'>) => void
  notify: () => void
  addLead: (lead: Lead) => void
}

export async function runFast(ctx: FastContext): Promise<{ error?: string; warning?: string }> {
  const { run, input, settings, target, signal, push } = ctx
  const stopped = () => signal.aborted
  const stage = (key: RunStage['key'], patch: Partial<RunStage>) => {
    const s = run.stages?.find((x) => x.key === key)
    if (s) Object.assign(s, patch)
    run.phase = (run.stages ?? []).filter((x) => x.status === 'done' || x.status === 'skipped').length
    ctx.notify()
  }
  const claude = (prompt: string, tools: string[] = [], timeoutMs = 300000) =>
    ask({ settings, apiKey: ctx.apiKey, prompt, tools, model: settings.model, timeoutMs, signal })
  const fail = (e: unknown): string => {
    const msg = (e as Error).message
    if (LIMIT_ERROR.test(msg)) noteLimit(msg)
    return AUTH_ERROR.test(msg) ? `AUTH: ${msg}` : msg
  }

  // A bigger pool than asked for, so the weakest fits can be dropped after scoring.
  // Map places are free to collect, so take more of them; web lists use Claude, so they stay closer to the target.
  const mapPool = Math.min(220, Math.max(target + 10, Math.ceil(target * 2.5)))
  const poolSize = Math.min(160, Math.max(target + 5, Math.ceil(target * 1.6)))
  const known = new Set(ctx.existing.flatMap((l) => [norm(l.name), norm(l.website)]).filter(Boolean))
  const cands: Candidate[] = []
  const addCand = (c: Candidate) => {
    const k = norm(c.name)
    if (!k || known.has(k) || (c.website && known.has(norm(c.website)))) return
    known.add(k)
    if (c.website) known.add(norm(c.website))
    cands.push(c)
  }

  // ---------- 1. Find ----------
  stage('find', { status: 'running', detail: 'Looking on the map' })
  const mapped = tagsFor(input.industry).tags.length > 0 && !!input.location.trim()
  if (mapped) {
    try {
      push({ kind: 'search', text: `Map: ${input.industry} in ${input.location}` })
      const { candidates, note } = await findOnMap(input.industry, input.location, mapPool, signal)
      push({ kind: 'note', text: note })
      const independent = candidates.filter((c: MapCandidate) => !c.chain)
      for (const c of (independent.length >= mapPool / 2 ? independent : candidates).slice(0, mapPool)) {
        addCand({ name: c.name, category: c.category, location: c.city || input.location, address: c.address, website: c.website, phone: c.phone, email: c.email, socials: c.socials, note: c.openingHours ? `Hours: ${c.openingHours}` : '', source: 'map', chain: c.chain })
      }
    } catch (e) {
      if (stopped()) return {}
      push({ kind: 'error', text: (e as Error).message })
    }
  }
  // Web lists fill the pool when the map has too few (or no map category exists).
  const short = poolSize - cands.length
  if (short > 0 && !stopped()) {
    stage('find', { detail: `Searching the web for ${short} more` })
    const lists = Math.min(5, Math.max(1, Math.ceil(short / 30)))
    const per = Math.ceil(short / lists)
    try {
      await pool(Array.from({ length: lists }, (_, i) => i), Math.min(settings.parallel || 3, lists), async (i) => {
        push({ kind: 'search', text: `Web list ${i + 1} of ${lists}: ${per} companies${lists > 1 ? `, ${ANGLES[i % ANGLES.length]}` : ''}` })
        const text = await claude(webListPrompt(input, per, [...ctx.existing.map((l) => l.name), ...cands.map((c) => c.name)], lists > 1 ? ANGLES[i % ANGLES.length] : undefined), ['WebSearch'])
        const arr = extractJson<any[]>(text) ?? []
        let n = 0
        for (const r of Array.isArray(arr) ? arr : []) {
          const name = str(r.name, 120)
          if (!name) continue
          const website = isUrl(str(r.website)) ? str(r.website, 300) : ''
          const before = cands.length
          addCand({ name, category: str(r.category, 80), location: str(r.location, 120) || input.location, address: '', website, phone: str(r.phone, 40), email: '', socials: [], note: str(r.note, 160), source: 'web', chain: false })
          if (cands.length > before) n++
        }
        push({ kind: 'note', text: `Web list ${i + 1}: ${n} new companies` })
      }, stopped)
    } catch (e) {
      if (stopped()) return {}
      const err = fail(e)
      if (!cands.length) return { error: err }
      push({ kind: 'error', text: err })
    }
  }
  if (stopped()) return {}
  if (!cands.length) return { error: 'No companies found. Try a broader industry or location.' }
  stage('find', { status: 'done', detail: `${cands.length} candidates (${cands.filter((c) => c.source === 'map').length} from the map)` })

  // ---------- 2. Read websites ----------
  stage('read', { status: 'running', detail: 'Finding missing websites' })
  const missing = cands.map((c, id) => ({ c, id })).filter(({ c }) => !c.website || isSocial(c.website))
  if (missing.length && !stopped()) {
    const chunks: (typeof missing)[] = []
    for (let i = 0; i < missing.length; i += 15) chunks.push(missing.slice(i, i + 15))
    try {
      await pool(chunks, settings.parallel || 3, async (chunk, i) => {
        push({ kind: 'search', text: `Looking up websites and phones, group ${i + 1} of ${chunks.length}` })
        const text = await claude(lookupPrompt(chunk.map(({ c, id }) => ({ id, name: c.name, location: c.address || c.location, category: c.category }))), ['WebSearch'])
        for (const r of extractJson<any[]>(text) ?? []) {
          const hit = chunk.find((x) => x.id === Number(r?.id))
          if (!hit) continue
          const w = str(r.website, 300)
          if (isUrl(w) && !isSocial(w)) hit.c.website = w
          else if (isUrl(w) && isSocial(w)) hit.c.socials.push(w)
          if (!hit.c.phone && str(r.phone, 40).replace(/\D/g, '').length >= 8) hit.c.phone = str(r.phone, 40)
          if (isUrl(str(r.social, 300))) hit.c.socials.push(str(r.social, 300))
          if (str(r.note, 160)) hit.c.note = [hit.c.note, str(r.note, 160)].filter(Boolean).join('. ')
        }
      }, stopped)
    } catch (e) {
      if (stopped()) return {}
      push({ kind: 'error', text: fail(e) })
    }
  }
  if (stopped()) return {}
  const withSite = cands.filter((c) => c.website && !isSocial(c.website))
  stage('read', { detail: `Reading ${withSite.length} websites` })
  let readDone = 0
  await pool(withSite, 10, async (c) => {
    c.site = await readWebsite(c.website, signal)
    readDone++
    if (c.site.ok) push({ kind: 'fetch', text: `${c.name}: ${[c.site.emails.length && `${c.site.emails.length} email`, c.site.phones.length && `${c.site.phones.length} phone`, c.site.tech.length && c.site.tech.join(', ')].filter(Boolean).join(', ') || 'read'}` })
    if (readDone % 5 === 0) stage('read', { detail: `Read ${readDone} of ${withSite.length} websites` })
  }, stopped)
  if (stopped()) return {}
  stage('read', { status: 'done', detail: `${withSite.filter((c) => c.site?.ok).length} websites read, ${cands.filter((c) => c.phone || c.site?.phones.length).length} with a phone, ${cands.filter((c) => c.email || c.site?.emails.length).length} with an email` })

  // ---------- 3. Score ----------
  stage('score', { status: 'running', detail: `Scoring ${cands.length} companies` })
  const facts = cands.map((c, id) => ({
    id,
    name: c.name,
    category: c.category,
    location: c.address || c.location,
    website: c.website || undefined,
    hasPhone: !!(c.phone || c.site?.phones.length),
    hasEmail: !!(c.email || c.site?.emails.length),
    social: c.socials.length + (c.site?.socials.length ?? 0) || undefined,
    chain: c.chain || undefined,
    note: c.note || undefined,
    siteTitle: c.site?.title || undefined,
    siteText: c.site?.ok ? (c.site.description || c.site.text).slice(0, 320) : undefined,
    tech: c.site?.tech.length ? c.site.tech : undefined,
    people: c.site?.people.length ? c.site.people.slice(0, 2) : undefined
  }))
  const scoreChunks: (typeof facts)[] = []
  for (let i = 0; i < facts.length; i += 20) scoreChunks.push(facts.slice(i, i + 20))
  const scores = new Map<number, any>()
  let scoreErr = ''
  let scoredChunks = 0
  await pool(scoreChunks, settings.parallel || 3, async (chunk) => {
    try {
      const text = await claude(scorePrompt(input, chunk), [], 240000)
      for (const r of extractJson<any[]>(text) ?? []) if (Number.isFinite(Number(r?.id))) scores.set(Number(r.id), r)
    } catch (e) {
      if (!stopped()) scoreErr = fail(e)
    }
    scoredChunks++
    stage('score', { detail: `Scored ${Math.min(facts.length, scoredChunks * 20)} of ${facts.length}` })
    push({ kind: 'note', text: `Scored ${scores.size} companies so far` })
  }, () => stopped() || /^AUTH:/.test(scoreErr) || LIMIT_ERROR.test(scoreErr))
  if (stopped()) return {}
  if (!scores.size) return { error: scoreErr || 'Claude could not score the companies. Try again.' }

  // Keep the best `target`, preferring ones that can be reached.
  const ranked = cands
    .map((c, id) => ({ c, r: scores.get(id) }))
    .filter((x) => x.r && Number(x.r.score) >= 3)
    .sort((a, b) => Number(b.r.score) - Number(a.r.score) || Number(!!(b.c.phone || b.c.site?.phones.length || b.c.site?.emails.length)) - Number(!!(a.c.phone || a.c.site?.phones.length || a.c.site?.emails.length)))
    .slice(0, target)
  const now = Date.now()
  const leads: Lead[] = ranked.map(({ c, r }) => {
    const people = c.site?.people ?? []
    const owner = people[0]
    return {
      id: randomUUID(),
      runId: run.id,
      name: c.name,
      website: c.website && !isSocial(c.website) ? (c.site?.url || c.website) : '',
      industry: c.category,
      size: '',
      location: c.address || c.location,
      score: Math.max(1, Math.min(10, Math.round(Number(r.score) || 5))),
      scoreReason: str(r.scoreReason),
      decisionMaker: str(r.decisionMaker, 120) || (owner?.title ?? ''),
      linkedin: [...c.socials, ...(c.site?.socials ?? [])].find((s) => /linkedin\.com/i.test(s)) ?? '',
      email: c.email || c.site?.emails[0] || '',
      phone: c.phone || c.site?.phones[0] || '',
      contactName: owner?.name ?? '',
      contactUrl: c.site?.contactUrl ?? '',
      signal: str(r.signal, 200),
      why: list(r.why),
      valueProp: str(r.valueProp),
      strategy: str(r.strategy),
      starters: list(r.starters),
      stage: 'researched',
      notes: '',
      starred: false,
      createdAt: now,
      updatedAt: now,
      stageChangedAt: now,
      source: c.source,
      address: c.address,
      socials: [...new Set([...c.socials, ...(c.site?.socials ?? [])])].slice(0, 6),
      tech: c.site?.tech ?? []
    }
  })
  for (const l of leads) ctx.addLead(l)
  stage('score', { status: 'done', detail: `${leads.length} kept of ${cands.length} scored` })
  if (scoreErr) push({ kind: 'error', text: scoreErr.replace(/^AUTH:\s*/, '') })

  // ---------- 4. Deep research (optional) ----------
  const top = input.deepTop ? leads.filter((l) => l.score >= 8).slice(0, 15) : []
  if (!top.length) {
    stage('deep', { status: 'skipped', detail: input.deepTop ? 'No lead scored 8 or more' : 'Off for this run' })
  } else {
    stage('deep', { status: 'running', detail: `Researching ${top.length} top leads` })
    let n = 0
    await pool(top, settings.parallel || 3, async (lead) => {
      try {
        push({ kind: 'search', text: `Deep research: ${lead.name}` })
        await deepen(lead, input, settings, ctx.apiKey, signal)
        ctx.notify()
      } catch (e) {
        if (!stopped()) push({ kind: 'error', text: `${lead.name}: ${fail(e).replace(/^AUTH:\s*/, '')}` })
      }
      n++
      stage('deep', { detail: `Researched ${n} of ${top.length}` })
    }, stopped)
    if (stopped()) return {}
    stage('deep', { status: 'done', detail: `${top.length} researched in depth` })
  }

  const warning =
    leads.length < target
      ? `Found ${leads.length} good fits of the ${target} asked for. Try a broader industry or location for more.`
      : scoreErr
        ? `Some groups could not be scored: ${scoreErr.replace(/^AUTH:\s*/, '')}`
        : undefined
  run.summary = `${cands.length} companies found${mapped ? ` (${cands.filter((c) => c.source === 'map').length} from the map)` : ''}, ${withSite.filter((c) => c.site?.ok).length} websites read by code, ${leads.length} kept after scoring.`
  return { warning }
}

/** Researches one lead with web tools and merges what it finds. Used by the run and by the lead panel. */
export async function deepen(lead: Lead, input: ResearchInput | null, settings: Settings, apiKey: string | null, signal?: AbortSignal): Promise<void> {
  const text = await ask({ settings, apiKey, prompt: deepPrompt(lead, input), tools: ['WebSearch', 'WebFetch'], model: settings.model, timeoutMs: 600000, signal })
  const r = extractJson<any>(text)
  if (!r) throw new Error('Claude returned no research for this company.')
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(r.email)) ? str(r.email, 120) : ''
  const phone = str(r.phone, 40).replace(/\D/g, '').length >= 8 ? str(r.phone, 40) : ''
  Object.assign(lead, {
    score: Number(r.score) ? Math.max(1, Math.min(10, Math.round(Number(r.score)))) : lead.score,
    scoreReason: str(r.scoreReason) || lead.scoreReason,
    signal: str(r.signal, 200) || lead.signal,
    decisionMaker: str(r.decisionMaker, 120) || lead.decisionMaker,
    contactName: lead.contactName || str(r.contactName, 120),
    email: lead.email || email,
    phone: lead.phone || phone,
    contactUrl: lead.contactUrl || (isUrl(str(r.contactUrl)) ? str(r.contactUrl, 300) : ''),
    linkedin: lead.linkedin || (/linkedin\.com\//i.test(str(r.linkedin)) ? str(r.linkedin, 300) : ''),
    why: list(r.why).length ? list(r.why) : lead.why,
    valueProp: str(r.valueProp) || lead.valueProp,
    strategy: str(r.strategy) || lead.strategy,
    starters: list(r.starters).length ? list(r.starters) : lead.starters,
    deepResearched: true,
    updatedAt: Date.now()
  } satisfies Partial<Lead>)
}
