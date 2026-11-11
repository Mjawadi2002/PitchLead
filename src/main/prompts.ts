import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Channel, Lang, Lead, ResearchInput } from '@shared/types'
import { PHASES } from '@shared/types'

function skillText(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'skill', 'SKILL.md'),
    join(app.getAppPath(), 'resources', 'skill', 'SKILL.md')
  ]
  for (const p of candidates) if (p && existsSync(p)) return readFileSync(p, 'utf8')
  return ''
}

export function researchSystemPrompt(): string {
  return `${skillText()}

---

# Running inside Leadpitch

You are running headless inside Leadpitch, a desktop app. Nobody can answer questions during the run, so do not ask any. Where something is unclear, make a sensible assumption and list it under "assumptions".

## Progress markers
Work through these phases in order. When you start a phase, print one line on its own, exactly in this form:
${PHASES.map((p, i) => `PHASE ${i + 1}: ${p}`).join('\n')}

## Research rules
- Only include real companies that you found and checked during this run. Never invent a company, a website, a person or a LinkedIn URL.
- "website" must be a URL you actually saw. "linkedin" is a company or person LinkedIn URL you actually saw, otherwise an empty string.
- "signal" is one concrete, recent sign of need you found (a job post, an opening, a review pattern, funding, a launch). Keep it under 14 words.
- Score fit from 1 to 10 using the skill's factors. Be strict: 8 to 10 only with a clear, recent signal.
- Write in plain, direct English. No emoji. No marketing filler.

## Output contract
When you finish, use the Write tool to create the file leads.json in the current working directory with exactly this shape:

{
  "summary": "Two plain sentences about what you found.",
  "assumptions": ["..."],
  "leads": [
    {
      "name": "Company name",
      "website": "https://...",
      "industry": "Short label",
      "size": "Employees, seats, venues or revenue range",
      "location": "City or region",
      "score": 8,
      "scoreReason": "One sentence on why this score",
      "decisionMaker": "Role or title to contact",
      "linkedin": "",
      "signal": "One recent sign of need",
      "why": ["Two or three specific reasons"],
      "valueProp": "How the product solves their specific problem, one or two sentences",
      "strategy": "How to approach them, one or two sentences",
      "starters": ["Two specific opening lines"]
    }
  ]
}

Sort leads by score, highest first. After writing the file, reply with the summary only.`
}

export function researchUserPrompt(input: ResearchInput, exclude: string[]): string {
  const lines = [
    `Find ${input.count} qualified leads for this product.`,
    '',
    `Product: ${input.product.trim() || '(see the product folder)'}`
  ]
  if (input.folder) lines.push(`Product folder: ${input.folder} (read it first to understand the product)`)
  lines.push('', 'Ideal customer profile:')
  if (input.industry) lines.push(`- Industry: ${input.industry}`)
  if (input.size) lines.push(`- Company size: ${input.size}`)
  if (input.location) lines.push(`- Location: ${input.location}`)
  if (input.pains) lines.push(`- Pain points: ${input.pains}`)
  if (input.tech) lines.push(`- Technologies they use: ${input.tech}`)
  if (input.extra) lines.push('', `Notes: ${input.extra}`)
  if (exclude.length) {
    lines.push('', 'Skip these companies, they are already in my list:', exclude.slice(0, 200).join(', '))
  }
  return lines.join('\n')
}

const LANG_NAME: Record<Lang, string> = { en: 'English', fr: 'French', ar: 'Arabic' }

export function draftPrompt(opts: {
  lead: Lead
  product: string
  sender: string
  channel: Channel
  lang: Lang
  previous?: string
  instruction?: string
}): string {
  const { lead, product, sender, channel, lang, previous, instruction } = opts
  const limits =
    channel === 'linkedin'
      ? 'A LinkedIn connection note: under 280 characters, no subject.'
      : 'A short cold email: a specific subject under 8 words and a body of 60 to 120 words.'
  return `Write a first outreach message.

Channel: ${channel === 'email' ? 'Email' : 'LinkedIn'}. ${limits}
Language: ${LANG_NAME[lang]}.
Sender: ${sender || 'the founder'}.
Product: ${product || 'see the value proposition below'}.

Lead:
${JSON.stringify(
  {
    company: lead.name,
    decisionMaker: lead.decisionMaker,
    location: lead.location,
    signal: lead.signal,
    why: lead.why,
    valueProp: lead.valueProp,
    strategy: lead.strategy,
    starters: lead.starters
  },
  null,
  2
)}

Rules: open with the specific signal, not with the sender. One clear ask. Plain words, no emoji, no hype, no em dashes. Sign with the sender's first name.
Never invent offers, prices, free trials, discounts, customers or results that are not stated in the product description or the instruction.
${previous ? `\nThe current draft is below. Write a clearly different version.${instruction ? ` Change it like this: ${instruction}.` : ''}\n---\n${previous}\n---` : ''}

Reply with only a JSON object: {"subject": "...", "body": "..."}. For LinkedIn, subject is an empty string.`
}
