import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { FallbackStatus, Settings } from '@shared/types'

/**
 * Free open models for LeadPitch only, through OmniRoute (MIT, github.com/cheaper-inference/OmniRoute).
 *
 * Kept to LeadPitch:
 *   - installed on request into LeadPitch's data folder, never globally
 *   - its database, settings and home folder are inside that folder (HOME, APPDATA and DATA_DIR are pointed there)
 *   - listens on 127.0.0.1 only, on its own port, and runs only while LeadPitch runs
 *   - only Claude Code processes that LeadPitch starts are pointed at it, and those run with --bare,
 *     so the Claude subscription login is never read for them and never reaches OmniRoute
 *
 * Free models cannot use Claude's web search, so only tasks without web search go there:
 * scoring, emails, sequences and meeting briefs.
 */

export const OMNIROUTE_VERSION = '3.8.53'
const LOCAL_KEY = 'leadpitch-local'
const PROBE_EVERY = 20 * 60 * 1000
const WINDOW = 5 * 60 * 60 * 1000

/** Providers with a free tier that OmniRoute supports. The person signs up and pastes their own key. */
export const FREE_PROVIDERS = [
  { id: 'groq', name: 'Groq', url: 'https://console.groq.com/keys', note: 'Fast Llama, Qwen and GPT-OSS models. Free tier with daily limits.' },
  { id: 'gemini', name: 'Google AI Studio', url: 'https://aistudio.google.com/apikey', note: 'Gemini models. On the free tier Google may use prompts to improve its products.' },
  { id: 'cerebras', name: 'Cerebras', url: 'https://cloud.cerebras.ai', note: 'Very fast open models. Free tier with daily limits.' },
  { id: 'mistral', name: 'Mistral', url: 'https://console.mistral.ai/api-keys', note: 'Mistral models. The free Experiment plan may use prompts for training.' },
  { id: 'nvidia', name: 'NVIDIA NIM', url: 'https://build.nvidia.com', note: 'Many open models. Free credits for developers.' }
] as const

const root = () => join(app.getPath('userData'), 'omniroute')
const dataDir = () => join(root(), 'data')
const homeDir = () => join(dataDir(), 'home')
const bin = () => join(root(), 'node_modules', 'omniroute', 'bin', 'omniroute.mjs')
const isWin = process.platform === 'win32'

let child: ChildProcess | null = null
let starting: Promise<void> | null = null
let installing = false
let installLog = ''
let lastError = ''
let activeUntil = 0
let lastProbe = 0
let freeCalls = 0
let providers: { id: string; masked: string }[] | null = null
let nodePath: string | null = null
let nodeVersion = ''
let notify: () => void = () => {}

export const setFallbackNotify = (fn: () => void) => { notify = fn }
export const isInstalled = () => existsSync(bin())

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string; timeout?: number; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile(cmd, args, { env: opts.env, cwd: opts.cwd, timeout: opts.timeout ?? 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, shell: isWin && /\.cmd$/i.test(cmd) }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-600)))
      else resolve(String(stdout))
    })
    if (opts.input !== undefined) p.stdin?.end(opts.input)
  })
}

/** OmniRoute needs Node.js 22.22 or newer (or 24+). Electron's own Node is too old, so the system one is used. */
async function findNode(): Promise<{ path: string | null; version: string; ok: boolean }> {
  if (nodePath && nodeVersion) return { path: nodePath, version: nodeVersion, ok: nodeOk(nodeVersion) }
  try {
    const out = isWin ? await run('where.exe', ['node'], { timeout: 10000 }) : await run('/bin/sh', ['-lc', 'command -v node'], { timeout: 10000 })
    const p = out.split(/\r?\n/).map((s) => s.trim()).find((s) => s && (!isWin || /\.exe$/i.test(s)))
    if (!p) return { path: null, version: '', ok: false }
    nodePath = p
    nodeVersion = (await run(p, ['--version'], { timeout: 10000 })).trim()
    return { path: p, version: nodeVersion, ok: nodeOk(nodeVersion) }
  } catch {
    return { path: null, version: '', ok: false }
  }
}

function nodeOk(v: string): boolean {
  const [maj, min] = v.replace(/^v/, '').split('.').map(Number)
  return (maj === 22 && min >= 22) || maj >= 24
}

/** Secrets for this OmniRoute only: the key that encrypts its database and the dashboard password. */
function secrets(): { key: string; password: string } {
  const file = join(dataDir(), '.env')
  mkdirSync(dataDir(), { recursive: true })
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const get = (k: string) => text.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
  let key = get('STORAGE_ENCRYPTION_KEY')
  let password = get('INITIAL_PASSWORD')
  if (!key || !password) {
    key ??= randomBytes(32).toString('hex')
    password ??= randomBytes(9).toString('base64url')
    writeFileSync(file, `STORAGE_ENCRYPTION_KEY=${key}\nINITIAL_PASSWORD=${password}\n`, { mode: 0o600 })
  }
  return { key, password }
}

/** Environment that keeps OmniRoute inside LeadPitch's folder. */
function env(port: number): NodeJS.ProcessEnv {
  const home = homeDir()
  mkdirSync(join(home, 'AppData', 'Roaming'), { recursive: true })
  mkdirSync(join(home, 'AppData', 'Local'), { recursive: true })
  const s = secrets()
  const e: NodeJS.ProcessEnv = { ...process.env }
  for (const k of Object.keys(e)) if (/^(ANTHROPIC_|OMNIROUTE_|CLAUDE_)/.test(k)) delete e[k]
  delete e.ELECTRON_RUN_AS_NODE
  return {
    ...e,
    DATA_DIR: dataDir(),
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'),
    OMNIROUTE_CLI_SKIP_DEFAULT_DATA_ENV: '1',
    OMNIROUTE_CLI_SKIP_REPO_ENV: '1',
    OMNIROUTE_BASE_URL: `http://127.0.0.1:${port}`,
    STORAGE_ENCRYPTION_KEY: s.key,
    INITIAL_PASSWORD: s.password,
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1'
  }
}

const healthy = async (port: number) => {
  try { return (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) })).ok } catch { return false }
}

export async function install(): Promise<void> {
  if (installing) return
  const node = await findNode()
  if (!node.ok || !node.path) throw new Error(`Free models need Node.js 22.22 or 24 and newer${node.version ? ` (this computer has ${node.version})` : ''}. Install it from nodejs.org, then try again.`)
  mkdirSync(root(), { recursive: true })
  try {
    const free = statfsSync(root())
    if (free.bavail * free.bsize < 1.6e9) throw new Error('Installing free models needs about 1.6 GB of free disk space.')
  } catch (e) {
    if (/disk space/.test((e as Error).message)) throw e
  }
  installing = true
  installLog = 'Downloading OmniRoute (about 900 MB)'
  lastError = ''
  notify()
  const npm = join(dirname(node.path), isWin ? 'npm.cmd' : 'npm')
  if (!existsSync(join(root(), 'package.json'))) writeFileSync(join(root(), 'package.json'), JSON.stringify({ name: 'leadpitch-omniroute', private: true }))
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(isWin ? `"${npm}"` : npm, ['install', `omniroute@${OMNIROUTE_VERSION}`, '--no-audit', '--no-fund', '--omit=dev', '--loglevel=http'], {
        cwd: root(), shell: isWin, windowsHide: true, env: { ...process.env, npm_config_update_notifier: 'false' }
      })
      let count = 0
      const onData = (d: Buffer) => {
        count += String(d).split('\n').filter((l) => /GET 200|fetch/.test(l)).length
        installLog = `Downloading packages: ${count}`
        if (count % 40 === 0) notify()
      }
      p.stdout?.on('data', onData)
      p.stderr?.on('data', onData)
      p.on('error', reject)
      p.on('close', (code) => (code === 0 && isInstalled() ? resolve() : reject(new Error(`npm stopped with code ${code}. Check the internet connection and try again.`))))
    })
    installLog = 'Installed'
  } catch (e) {
    lastError = (e as Error).message
    throw e
  } finally {
    installing = false
    notify()
  }
}

export async function uninstall(): Promise<void> {
  stop()
  providers = null
  activeUntil = 0
  await new Promise((r) => setTimeout(r, 800))
  rmSync(root(), { recursive: true, force: true })
  notify()
}

/** Starts this OmniRoute if it is installed and not running. */
export async function ensureRunning(settings: Settings): Promise<void> {
  const port = settings.fallback.port
  if (child && (await healthy(port))) return
  if (starting) return starting
  starting = (async () => {
    if (!isInstalled()) throw new Error('Free models are not installed. Install them in Settings, Free models.')
    const node = await findNode()
    if (!node.path || !node.ok) throw new Error('Free models need Node.js 22.22 or 24 and newer.')
    if (await healthy(port)) {
      // Something already answers on this port. Only use it if it is this OmniRoute (our data folder holds its database).
      if (!child) throw new Error(`Port ${port} is already in use by another program. Choose another port in Settings, Free models.`)
      return
    }
    lastError = ''
    child = spawn(node.path, [bin(), 'serve', '--port', String(port), '--no-open', '--no-tray'], { cwd: root(), env: env(port), windowsHide: true })
    let log = ''
    child.stdout?.on('data', (d) => (log = (log + d).slice(-4000)))
    child.stderr?.on('data', (d) => (log = (log + d).slice(-4000)))
    child.on('exit', () => { child = null; notify() })
    for (let i = 0; i < 90; i++) {
      if (await healthy(port)) { notify(); refreshProviders(settings).catch(() => {}); return }
      if (!child) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    lastError = 'Free models did not start. ' + log.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-3).join(' ')
    stop()
    throw new Error(lastError)
  })().finally(() => { starting = null })
  return starting
}

export function stop(): void {
  if (!child?.pid) return
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  else child.kill('SIGTERM')
  child = null
}

async function cli(settings: Settings, args: string[], input?: string): Promise<string> {
  const node = await findNode()
  if (!node.path) throw new Error('Node.js was not found.')
  return run(node.path, [bin(), ...args], { env: env(settings.fallback.port), input, cwd: root(), timeout: 120000 })
}

export async function refreshProviders(settings: Settings): Promise<{ id: string; masked: string }[]> {
  if (!isInstalled()) return (providers = [])
  try {
    const out = await cli(settings, ['keys', 'list', '--json'])
    const j = JSON.parse(out.slice(out.indexOf('{')))
    providers = (j.keys ?? []).filter((k: any) => k.isActive !== false).map((k: any) => {
      const m = String(k.maskedKey ?? '')
      return { id: String(k.provider), masked: m && !/^enc:/.test(m) ? m : 'Key saved' }
    })
  } catch {
    providers ??= []
  }
  notify()
  return providers!
}

export async function addProvider(settings: Settings, id: string, key: string): Promise<void> {
  if (!FREE_PROVIDERS.some((p) => p.id === id)) throw new Error('LeadPitch only connects providers that have a free tier.')
  if (!key.trim() || /\s/.test(key.trim())) throw new Error('Paste the key exactly as the provider shows it.')
  await ensureRunning(settings)
  await cli(settings, ['keys', 'add', id, '--stdin'], key.trim() + '\n')
  await refreshProviders(settings)
}

export async function removeProvider(settings: Settings, id: string): Promise<void> {
  await cli(settings, ['keys', 'remove', id, '--yes'])
  await refreshProviders(settings)
}

export interface FreeRoute { baseUrl: string; key: string; model: string }

export async function freeRoute(settings: Settings): Promise<FreeRoute> {
  await ensureRunning(settings)
  return { baseUrl: `http://127.0.0.1:${settings.fallback.port}`, key: LOCAL_KEY, model: settings.fallback.model || 'auto' }
}

const ready = () => isInstalled() && !!providers?.length

/** Whether this task should go to free models right now. */
export function useFreeNow(settings: Settings): boolean {
  const mode = settings.fallback?.mode ?? 'off'
  if (mode === 'off' || !ready()) return false
  if (mode === 'always') return true
  const now = Date.now()
  if (activeUntil <= now) return false
  // Every 20 minutes one task tries Claude again, so LeadPitch goes back as soon as the limit resets.
  if (now - lastProbe > PROBE_EVERY) { lastProbe = now; return false }
  return true
}

/** Called when Claude says the limit is reached. Returns true when free models will take over. */
export function activateFallback(_message: string): boolean {
  if (!ready()) return false
  const now = Date.now()
  if (activeUntil <= now) notifyOnce()
  activeUntil = now + WINDOW
  lastProbe = now
  notify()
  return true
}

let toast: (msg: string) => void = () => {}
export const setFallbackToast = (fn: (msg: string) => void) => { toast = fn }
function notifyOnce() { toast('Claude limit reached. LeadPitch now uses free models for scoring and writing until it resets.') }

/** Claude answered again after a limit: go back to it. */
export function claudeIsBack(): void {
  if (activeUntil > Date.now()) { activeUntil = 0; toast('Claude is available again. LeadPitch is back on your subscription.'); notify() }
}

export function noteFreeCall(): void { freeCalls++ }

export async function fallbackStatus(settings: Settings): Promise<FallbackStatus & { providers: { id: string; masked: string }[]; freeCalls: number; password?: string; port: number }> {
  const node = await findNode()
  const installed = isInstalled()
  if (installed && providers === null && child) await refreshProviders(settings)
  return {
    installed,
    installing,
    installLog,
    running: !!child && (await healthy(settings.fallback.port)),
    nodeOk: node.ok,
    nodeVersion: node.version,
    active: settings.fallback.mode === 'always' ? ready() : activeUntil > Date.now(),
    activeUntil: activeUntil > Date.now() ? activeUntil : undefined,
    error: lastError || undefined,
    providers: providers ?? [],
    freeCalls,
    password: installed ? secrets().password : undefined,
    port: settings.fallback.port
  }
}
