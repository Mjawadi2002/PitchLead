export type Stage = 'researched' | 'qualified' | 'contacted' | 'replied' | 'meeting' | 'won' | 'lost'

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'researched', label: 'Researched' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' }
]

export interface Lead {
  id: string
  runId: string
  name: string
  website: string
  industry: string
  size: string
  location: string
  score: number
  scoreReason: string
  decisionMaker: string
  linkedin: string
  /** Public contact details found during research. Empty when none were found. */
  email: string
  phone: string
  contactName: string
  contactUrl: string
  signal: string
  why: string[]
  valueProp: string
  strategy: string
  starters: string[]
  stage: Stage
  notes: string
  starred: boolean
  createdAt: number
  updatedAt: number
  stageChangedAt: number
}

export type Channel = 'email' | 'linkedin'
export type Lang = 'en' | 'fr' | 'ar'

export interface Draft {
  id: string
  leadId: string
  channel: Channel
  lang: Lang
  subject: string
  body: string
  updatedAt: number
}

export interface ResearchInput {
  product: string
  folder: string
  industry: string
  location: string
  size: string
  pains: string
  tech: string
  count: number
  extra: string
}

export type RunEventKind = 'phase' | 'search' | 'fetch' | 'read' | 'write' | 'note' | 'error'

export interface RunEvent {
  t: number
  kind: RunEventKind
  text: string
  phase?: number
  batch?: number
}

export interface BatchState {
  n: number
  status: 'waiting' | 'running' | 'done' | 'failed'
  want: number
  found: number
  phase: number
  angle: string
}

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface Run {
  id: string
  title: string
  createdAt: number
  finishedAt?: number
  status: RunStatus
  input: ResearchInput
  leadIds: string[]
  events: RunEvent[]
  phase: number
  /** Big runs are split into batches of BATCH_SIZE, one Claude session each. */
  batch?: number
  batches?: number
  batchStates?: BatchState[]
  parallel?: number
  warning?: string
  summary?: string
  assumptions?: string[]
  error?: string
  costUsd?: number
}

export interface TitlebarPrefs {
  search: boolean
  run: boolean
  claude: boolean
  newBtn: boolean
  controls: 'win' | 'mac'
  density: 'compact' | 'regular'
  material: 'glass' | 'solid'
}

export interface Settings {
  mode: 'subscription' | 'apikey'
  claudePath: string
  model: 'opus' | 'sonnet'
  webResearch: boolean
  theme: 'system' | 'light' | 'dark'
  titlebar: TitlebarPrefs
  sidebarCollapsed: boolean
  senderName: string
  defaultLang: Lang
  lastInput: ResearchInput | null
  onboarded: boolean
  /** How many Claude sessions a big run uses at once. */
  parallel: number
}

export interface UsageWindow {
  start: number
  end: number
  tokens: number
  messages: number
  leadpitchTokens: number
}

export interface UsageReport {
  current: UsageWindow | null
  /** Busiest 5-hour window in the last 30 days, used as the 100% mark. */
  peakTokens: number
  weekTokens: number
  weekMessages: number
  limitHit?: { at: number; message: string }
  checkedAt: number
}

export interface Snapshot {
  leads: Lead[]
  runs: Run[]
  drafts: Draft[]
  settings: Settings
  hasApiKey: boolean
}

export interface ClaudeStatus {
  found: boolean
  path?: string
  version?: string
  loggedIn?: boolean
  authMethod?: string
  subscription?: string
  email?: string
  error?: string
  checkedAt: number
}

export const MAX_LEADS = 100
export const BATCH_SIZE = 15

export const PHASES = [
  'Understand the product',
  'Define the ideal customer',
  'Search for companies',
  'Check buying signals',
  'Score fit',
  'Write contact strategies'
]

export const DEFAULT_INPUT: ResearchInput = {
  product: '',
  folder: '',
  industry: '',
  location: '',
  size: '',
  pains: '',
  tech: '',
  count: 10,
  extra: ''
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'subscription',
  claudePath: '',
  model: 'opus',
  webResearch: true,
  theme: 'system',
  titlebar: {
    search: true,
    run: true,
    claude: true,
    newBtn: true,
    controls: 'win',
    density: 'regular',
    material: 'glass'
  },
  sidebarCollapsed: false,
  senderName: '',
  defaultLang: 'en',
  lastInput: null,
  onboarded: false,
  parallel: 3
}
