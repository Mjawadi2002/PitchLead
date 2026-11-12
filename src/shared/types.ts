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

export interface Project {
  id: string
  name: string
  /** Product or service: changes how Claude describes the offer. */
  offerType: 'product' | 'service'
  /** What is sold: what it is, who it is for, the problem it solves. */
  product: string
  folder: string
  industry: string
  location: string
  size: string
  pains: string
  tech: string
  /** Index into the project colour list. */
  color: number
  /** Optional logo: a small square PNG as a data URL. */
  icon?: string
  createdAt: number
}

export const PROJECT_COLORS = ['#3557E8', '#1B8049', '#B25E09', '#8E3FD1', '#C1352D', '#0E7C86', '#5B5B64']

export interface Lead {
  id: string
  runId: string
  /** The project this lead belongs to. */
  projectId?: string
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
  /** Where the lead came from: map data, a web list, Claude web research, or added by hand. */
  source?: LeadSource
  address?: string
  socials?: string[]
  tech?: string[]
  /** True once Claude has researched this one company in depth. */
  deepResearched?: boolean
  /** Meeting brief with likely objections, written on request. */
  meetingBrief?: string
  /** Never email this lead (they opted out or bounced). */
  doNotContact?: boolean
}

export type LeadSource = 'map' | 'web' | 'research' | 'manual'

export type Channel = 'email' | 'linkedin'
export type Lang = 'en' | 'fr' | 'ar'

export interface Draft {
  id: string
  leadId: string
  channel: Channel
  lang: Lang
  /** Email sequence step: 0 is the first email, 1 and 2 are follow-ups. LinkedIn notes use 0. */
  step?: number
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
  /** Project the run belongs to; its leads go there. */
  projectId?: string
  /** fast: map data and web lists, read by code, scored by Claude in bulk. deep: Claude researches each company. */
  engine?: 'fast' | 'deep'
  /** Fast engine only: research leads that score 8 or more in depth afterwards. */
  deepTop?: boolean
}

export type OutboxStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'

export interface OutboxItem {
  id: string
  leadId: string
  step: number
  to: string
  subject: string
  body: string
  lang: Lang
  status: OutboxStatus
  /** Not sent before this time. Follow-ups are scheduled days after the first email. */
  dueAt: number
  sentAt?: number
  messageId?: string
  error?: string
  createdAt: number
}

export interface MailSettings {
  provider: 'gmail' | 'outlook' | 'other'
  address: string
  fromName: string
  smtpHost: string
  smtpPort: number
  imapHost: string
  imapPort: number
  dailyLimit: number
  /** Local hours when mail may go out, 24-hour clock, and whether weekends are allowed. */
  startHour: number
  endHour: number
  weekends: boolean
  followUpDays: number[]
  optOutLine: string
  /** Emails or domains that must never be contacted, one per line. */
  doNotContact: string
  trackReplies: boolean
}

export interface MailStatus {
  connected: boolean
  sentToday: number
  lastCheck?: number
  lastError?: string
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

export interface RunStage {
  key: 'find' | 'read' | 'score' | 'deep'
  label: string
  status: 'waiting' | 'running' | 'done' | 'skipped'
  detail: string
}

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface Run {
  id: string
  projectId?: string
  title: string
  createdAt: number
  finishedAt?: number
  status: RunStatus
  input: ResearchInput
  leadIds: string[]
  events: RunEvent[]
  phase: number
  /** Fast engine progress, one entry per stage. */
  stages?: RunStage[]
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
  mail: MailSettings
  /** Guided tour: new on first launch, then active, done or skipped. Replayable from Settings. */
  tour: TourState
  /** Project shown across the app, or 'all'. */
  activeProject: string
}

export interface TourState {
  status: 'new' | 'active' | 'done' | 'skipped'
  step: number
  startedAt: number
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
  projects: Project[]
  leads: Lead[]
  runs: Run[]
  drafts: Draft[]
  outbox: OutboxItem[]
  settings: Settings
  hasApiKey: boolean
  hasMailPassword: boolean
  mailStatus: MailStatus
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
  extra: '',
  engine: 'fast',
  deepTop: false
}

export const DEFAULT_MAIL: MailSettings = {
  provider: 'gmail',
  address: '',
  fromName: '',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  dailyLimit: 30,
  startHour: 9,
  endHour: 17,
  weekends: false,
  followUpDays: [3, 7],
  optOutLine: 'If this is not relevant, reply "no thanks" and I will not write again.',
  doNotContact: '',
  trackReplies: true
}

export const MAIL_PRESETS: Record<MailSettings['provider'], Pick<MailSettings, 'smtpHost' | 'smtpPort' | 'imapHost' | 'imapPort'>> = {
  gmail: { smtpHost: 'smtp.gmail.com', smtpPort: 465, imapHost: 'imap.gmail.com', imapPort: 993 },
  outlook: { smtpHost: 'smtp-mail.outlook.com', smtpPort: 587, imapHost: 'outlook.office365.com', imapPort: 993 },
  other: { smtpHost: '', smtpPort: 465, imapHost: '', imapPort: 993 }
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
  parallel: 3,
  mail: DEFAULT_MAIL,
  tour: { status: 'new', step: 0, startedAt: 0 },
  activeProject: 'all'
}
