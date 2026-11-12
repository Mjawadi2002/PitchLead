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

# Running inside LeadPitch

You are running headless inside LeadPitch, a desktop app. Nobody can answer questions during the run, so do not ask any. Where something is unclear, make a sensible assumption and list it under "assumptions".

## Progress markers
Work through these phases in order. When you start a phase, print one line on its own, exactly in this form:
${PHASES.map((p, i) => `PHASE ${i + 1}: ${p}`).join('\n')}

## Research rules
- Only include real companies that you found and checked during this run. Never invent a company, a website, a person or a LinkedIn URL.
- "website" must be a URL you actually saw. "linkedin" is a company or person LinkedIn URL you actually saw, otherwise an empty string.
- "signal" is one concrete, recent sign of need you found (a job post, an opening, a review pattern, funding, a launch). Keep it under 14 words.
- Score fit from 1 to 10 using the skill's factors. Be strict: 8 to 10 only with a clear, recent signal.
- Find public contact details for every lead: a business email, a phone number, a contact page and, when public, the name of the person in the decision-maker role. Look on the company website (contact, about, team, imprint, legal pages), Google Business or Maps listings, directories and LinkedIn. Only include details you actually saw published. Never guess an email from a name pattern. Leave a field empty when you found nothing.
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
      "email": "Published business email, or empty",
      "phone": "Published phone with country code, or empty",
      "contactName": "Name of the decision maker if published, or empty",
      "contactUrl": "Contact page URL, or empty",
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

export function researchUserPrompt(input: ResearchInput, exclude: string[], angle?: string): string {
  const lines = [
    `Find ${input.count} qualified leads for this product.`,
    ...(angle ? [`Other researchers are covering other angles at the same time. Search mainly through this angle so your companies differ from theirs: ${angle}.`] : []),
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

export function contactPrompt(lead: { name: string; website: string; location: string; decisionMaker: string }): string {
  return `Find public contact details for this company.

Company: ${lead.name}
Website: ${lead.website || "unknown"}
Location: ${lead.location || "unknown"}
Role to reach: ${lead.decisionMaker || "owner or manager"}

Search the web. Check the company website (contact, about, team, imprint, legal pages), Google Business or Maps listings, directories and LinkedIn.
Only report details you actually saw published. Never guess an email from a name pattern. Use an empty string for anything you did not find.

Reply with only a JSON object:
{"email": "", "phone": "", "contactName": "", "contactUrl": "", "linkedin": "", "website": ""}`
}

// ---------- Fast engine ----------

function icpLines(input: ResearchInput): string {
  return [
    `Product: ${input.product.trim() || '(not described)'}`,
    input.industry && `Industry: ${input.industry}`,
    input.location && `Location: ${input.location}`,
    input.size && `Company size: ${input.size}`,
    input.pains && `Pain points it solves: ${input.pains}`,
    input.tech && `Tools they use: ${input.tech}`,
    input.extra && `Notes: ${input.extra}`
  ].filter(Boolean).join('\n')
}

/** Web search only, no page reading: a short list of real companies. */
export function webListPrompt(input: ResearchInput, count: number, exclude: string[], angle?: string): string {
  return `List ${count} real companies that could buy this product.

${icpLines(input)}
${angle ? `\nSearch mainly through this angle so results differ from other lists: ${angle}.` : ''}
${exclude.length ? `\nSkip these, they are already known: ${exclude.slice(0, 250).join(', ')}` : ''}

Use web search results only. Do not open pages. Only list companies you saw in results; never invent one.
Reply with only a JSON array, no prose:
[{"name": "", "website": "https://... or empty", "location": "", "category": "", "phone": "or empty", "note": "what the result said, under 15 words"}]`
}

/** Fills in websites and phones for known names, from search results. */
export function lookupPrompt(items: { id: number; name: string; location: string; category: string }[]): string {
  return `For each business below, find its official website, phone number and main social page from web search results.
Use web search only and do not open pages. Only report what you saw in results. Use empty strings when unsure; a wrong website is worse than none.

${JSON.stringify(items)}

Reply with only a JSON array in the same order:
[{"id": 0, "website": "", "phone": "", "social": "", "note": "anything useful from the results, under 15 words"}]`
}

/** Bulk fit scoring from compact facts, no tools. */
export function scorePrompt(input: ResearchInput, candidates: unknown[]): string {
  return `You qualify sales leads. Score how well each company fits the product, using only the facts given.

${icpLines(input)}

Rules:
- Score fit 1 to 10. 8 to 10 only when the facts show a clear reason to buy now. Chains and franchises usually decide centrally: score them lower unless the product suits that.
- "signal" must come from the facts given (a review note, missing online ordering, a booking tool, a job post in the note). If there is none, write a short honest observation instead and keep the score at 7 or below.
- Never invent facts, people, numbers or events.
- Plain, direct English. No emoji. No em dashes.

Companies:
${JSON.stringify(candidates)}

Reply with only a JSON array, one object per company, same ids:
[{"id": 0, "score": 7, "scoreReason": "one sentence", "decisionMaker": "role to contact", "signal": "under 14 words", "why": ["two short reasons"], "valueProp": "one sentence", "strategy": "one sentence", "starters": ["two opening lines"]}]`
}

/** Deep research on one company, with web tools. */
export function deepPrompt(lead: { name: string; website: string; location: string; industry: string }, input: ResearchInput | null): string {
  return `Research this company in depth as a sales lead.

Company: ${lead.name}
Website: ${lead.website || 'unknown'}
Location: ${lead.location || 'unknown'}
Industry: ${lead.industry || 'unknown'}
${input ? `\n${icpLines(input)}\n` : ''}
Find: one concrete recent sign of need (job post, opening, review pattern, launch, funding), the person in the decision-maker role and their name if published, and published contact details. Only report what you actually saw. Never guess emails.

Reply with only a JSON object:
{"score": 8, "scoreReason": "", "signal": "under 14 words", "decisionMaker": "", "contactName": "", "email": "", "phone": "", "contactUrl": "", "linkedin": "", "why": [""], "valueProp": "", "strategy": "", "starters": ["", ""]}`
}

export function meetingPrompt(lead: Lead, product: string, sender: string): string {
  return `Write a short meeting brief for a sales call.

Seller: ${sender || 'the founder'}
Product: ${product || 'see the value below'}
Lead: ${JSON.stringify({ company: lead.name, website: lead.website, location: lead.location, industry: lead.industry, size: lead.size, contact: lead.contactName || lead.decisionMaker, signal: lead.signal, why: lead.why, valueProp: lead.valueProp, notes: lead.notes })}

Use these headings, plain text, short bullet points, no emoji:
Goal of the call
What we know
Questions to ask
What to show
Likely objections and answers (three to five)
Next step to propose

Base everything on the facts given. Where you are guessing, say "Check:" before it. Under 300 words.`
}

export function sequencePrompt(o: { lead: Lead; product: string; sender: string; lang: Lang; days: number[]; optOut: string }): string {
  const LANG: Record<Lang, string> = { en: 'English', fr: 'French', ar: 'Arabic' }
  return `Write a cold email sequence and a LinkedIn note for this lead.

Language: ${LANG[o.lang]}
Sender: ${o.sender || 'the founder'}
Product: ${o.product || 'see the value proposition below'}
Lead: ${JSON.stringify({ company: o.lead.name, contact: o.lead.contactName || '', role: o.lead.decisionMaker, location: o.lead.location, signal: o.lead.signal, why: o.lead.why, valueProp: o.lead.valueProp, strategy: o.lead.strategy, starters: o.lead.starters })}

Email 1: open with the signal, one clear ask, 60 to 110 words, subject under 8 words.
Email 2 (sent ${o.days[0] ?? 3} days later if no reply): a short bump that adds one new useful point, under 70 words.
Email 3 (sent ${o.days[1] ?? 7} days later if no reply): a polite last note that makes saying no easy, under 60 words.
LinkedIn note: under 280 characters.
Follow-ups reply in the same thread, so their subject is "Re: " plus the first subject.
Greet by first name when the contact name is known, otherwise greet the team. Sign with the sender's first name.
Never invent offers, prices, trials, customers or results. No emoji, no hype, no em dashes. Do not add an unsubscribe line; the app adds it.

Reply with only JSON:
{"emails": [{"subject": "", "body": ""}, {"subject": "", "body": ""}, {"subject": "", "body": ""}], "linkedin": ""}`
}
