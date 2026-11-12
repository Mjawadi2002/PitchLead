import type { Settings } from '@shared/types'

/**
 * Every Claude call names the kind of work it does, and the work decides the model.
 * Quick, structured tasks do not need the strongest model; research and judgement do.
 */
export type Task =
  | 'check' // a connection test
  | 'brief' // a short product summary from the product folder, written once per project
  | 'list' // a web-search list of company names
  | 'lookup' // a company's website and phone, from search results
  | 'contact' // contact details for one lead
  | 'score' // scoring compact facts, 20 companies at a time
  | 'draft' // one email or LinkedIn note
  | 'sequence' // three emails and a LinkedIn note
  | 'meeting' // a meeting brief
  | 'deep' // in-depth research on one company
  | 'research' // a Deep-engine session

export type ModelName = 'haiku' | 'sonnet' | 'opus'

/** Tasks that need Claude's web search. Free models cannot do these. */
export const WEB_TASKS: ReadonlySet<Task> = new Set<Task>(['list', 'lookup', 'contact', 'deep', 'research'])

export function modelFor(task: Task, s: Settings): ModelName {
  const best: ModelName = s.model
  if (!s.models?.smart) return task === 'check' ? 'haiku' : best
  const economy = !!s.models.economy
  switch (task) {
    case 'check':
    case 'brief':
    case 'list':
    case 'lookup':
    case 'contact':
      return 'haiku'
    case 'score':
      return economy ? 'haiku' : 'sonnet'
    case 'draft':
    case 'sequence':
    case 'meeting':
      return 'sonnet'
    case 'deep':
    case 'research':
      return economy ? 'sonnet' : best
  }
}

export const TASK_LABEL: Record<Task, string> = {
  check: 'Connection test',
  brief: 'Product summary',
  list: 'Company lists',
  lookup: 'Website lookups',
  contact: 'Contact details',
  score: 'Scoring',
  draft: 'Emails and notes',
  sequence: 'Sequences',
  meeting: 'Meeting briefs',
  deep: 'Deep research',
  research: 'Deep engine'
}
