import { recordModelUsage } from './usage'
import { app } from 'electron'
import { spawn, execFile, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import type { ClaudeStatus, Settings } from '@shared/types'
import { WEB_TASKS, modelFor, type Task } from './models'
import { activateFallback, claudeIsBack, freeRoute, noteFreeCall, useFreeNow, type FreeRoute } from './omniroute'

const isWin = process.platform === 'win32'

function run(cmd: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, shell: cmd.toLowerCase().endsWith('.cmd') }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim()))
      else resolve(stdout.toString())
    })
  })
}

/** Find the Claude Code executable. Prefers the native binary so no shell is needed. */
export async function resolveClaude(settings: Settings): Promise<string | null> {
  if (settings.claudePath && existsSync(settings.claudePath)) return settings.claudePath
  const home = homedir()
  const candidates = isWin
    ? [
        join(home, '.local', 'bin', 'claude.exe'),
        join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
      ]
    : [join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', join(home, '.claude', 'local', 'claude')]
  for (const c of candidates) if (existsSync(c)) return c

  try {
    if (isWin) {
      const out = (await run('where.exe', ['claude'])).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      const exe = out.find((p) => p.toLowerCase().endsWith('.exe'))
      if (exe) return exe
      const cmd = out.find((p) => p.toLowerCase().endsWith('.cmd'))
      if (cmd) {
        const native = join(dirname(cmd), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
        return existsSync(native) ? native : cmd
      }
    } else {
      const shell = process.env.SHELL || '/bin/zsh'
      const out = (await run(shell, ['-lc', 'command -v claude'])).trim()
      if (out) return out
    }
  } catch { /* not found */ }
  return null
}

const quote = (a: string) => (/^[\w\-./:\\=,]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)

export function spawnClaude(
  path: string,
  args: string[],
  opts: { cwd: string; apiKey?: string | null; free?: FreeRoute }
): ChildProcess {
  const env = { ...process.env }
  // Subscription mode must not pick up a stray API key or endpoint from the environment.
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL']) delete env[k]
  if (opts.free) {
    // Free models: this one process talks to LeadPitch's own OmniRoute on localhost.
    // --bare below means Claude Code never reads the subscription login for it, so that login never reaches OmniRoute.
    env.ANTHROPIC_BASE_URL = opts.free.baseUrl
    env.ANTHROPIC_API_KEY = opts.free.key
    env.ANTHROPIC_MODEL = opts.free.model
    env.ANTHROPIC_SMALL_FAST_MODEL = opts.free.model
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = opts.free.model
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = opts.free.model
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = opts.free.model
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    // A free provider that is down should fail fast, not retry for minutes.
    env.CLAUDE_CODE_MAX_RETRIES = '1'
  } else if (opts.apiKey) env.ANTHROPIC_API_KEY = opts.apiKey
  const finalArgs = opts.apiKey || opts.free ? ['--bare', ...args] : args
  if (path.toLowerCase().endsWith('.cmd')) {
    return spawn([quote(path), ...finalArgs.map(quote)].join(' '), { cwd: opts.cwd, env, shell: true, windowsHide: true })
  }
  return spawn(path, finalArgs, { cwd: opts.cwd, env, windowsHide: true })
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  else child.kill('SIGTERM')
}

export async function claudeStatus(settings: Settings, hasKey: boolean): Promise<ClaudeStatus> {
  const path = await resolveClaude(settings)
  const now = Date.now()
  if (!path) return { found: false, checkedAt: now, error: 'Claude Code is not installed, or LeadPitch cannot find it.' }
  let version = ''
  try { version = (await run(path, ['--version'])).trim().split(/\s/)[0] } catch (e) {
    return { found: false, path, checkedAt: now, error: (e as Error).message }
  }
  if (settings.mode === 'apikey') {
    return { found: true, path, version, loggedIn: hasKey, authMethod: 'apikey', checkedAt: now, error: hasKey ? undefined : 'Add an API key to use this mode.' }
  }
  try {
    const s = JSON.parse(await run(path, ['auth', 'status', '--json']))
    return {
      found: true,
      path,
      version,
      loggedIn: !!s.loggedIn,
      authMethod: s.authMethod,
      subscription: s.subscriptionType,
      email: s.email,
      checkedAt: now
    }
  } catch (e) {
    return { found: true, path, version, loggedIn: false, checkedAt: now, error: (e as Error).message }
  }
}

/** Opens a visible terminal running `claude auth login`, so the person signs in themselves. */
export async function openSignIn(settings: Settings): Promise<void> {
  const path = await resolveClaude(settings)
  if (!path) throw new Error('Claude Code is not installed.')
  if (isWin) {
    spawn(`start "Sign in to Claude" cmd /k ""${path}" auth login --claudeai"`, { shell: true, detached: true, windowsHide: false }).unref()
  } else if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `tell application "Terminal" to do script "'${path}' auth login --claudeai"`, '-e', 'tell application "Terminal" to activate']).unref()
  } else {
    spawn('x-terminal-emulator', ['-e', path, 'auth', 'login', '--claudeai'], { detached: true }).unref()
  }
}

export const AUTH_ERROR = /authenticat|oauth|log ?in|401|invalid api key|credit balance/i
export const LIMIT_ERROR = /usage limit|rate limit|limit reached|limit will reset|resets? at|429|overloaded/i

/** Claude's own words when the subscription window is used up. Not plain overload or rate errors. */
export const QUOTA_ERROR = /usage limit|limit reached|limit will reset|hit your limit|out of extra usage|weekly limit/i

export const FREE_NO_WEB = 'Web search needs Claude. LeadPitch skipped this step while it uses free models.'

export interface AskOptions {
  settings: Settings
  apiKey: string | null
  prompt: string
  /** The kind of work; it picks the model. */
  task: Task
  timeoutMs?: number
  /** Built-in tools to allow, for example WebSearch and WebFetch. None by default. */
  tools?: string[]
  /** Folders Claude may read, for the product folder. */
  addDirs?: string[]
  /** Aborting kills the Claude Code process. */
  signal?: AbortSignal
}

/**
 * Run a one-shot prompt and return the text result.
 * The task picks the model. When the Claude limit is reached and the free fallback is on,
 * tasks that do not need web search go to free models instead, through LeadPitch's own OmniRoute.
 */
export async function ask(opts: AskOptions): Promise<string> {
  const web = WEB_TASKS.has(opts.task) || !!opts.tools?.some((t) => /^Web/.test(t))
  if (useFreeNow(opts.settings)) {
    if (web) throw new Error(FREE_NO_WEB)
    return askFree(opts)
  }
  try {
    return await askOnce(opts)
  } catch (e) {
    const msg = (e as Error).message
    if (opts.settings.fallback?.mode === 'auto' && QUOTA_ERROR.test(msg) && !opts.signal?.aborted && activateFallback(msg)) {
      if (web) throw new Error(`Your Claude limit is reached. ${FREE_NO_WEB}`)
      return askFree(opts)
    }
    throw e
  }
}

/** A free-model call, with provider errors turned into plain words (and never mistaken for a Claude sign-in problem). */
async function askFree(opts: AskOptions): Promise<string> {
  try {
    return await askOnce(opts, await freeRoute(opts.settings))
  } catch (e) {
    throw new Error(freeError((e as Error).message))
  }
}

export function freeError(msg: string): string {
  if (/^Free models|^Stopped/.test(msg)) return msg
  const why = /429|rate.?limit|quota|too many/i.test(msg) ? 'the free providers have reached their own limits for now'
    : /401|403|invalid.{0,10}key|unauthori/i.test(msg) ? 'a provider key was rejected. Check it in Settings, Free models'
    : /took too long/i.test(msg) ? 'they took too long to answer'
    : /not installed|did not start|Node\.js|port/i.test(msg) ? msg
    : 'no free provider answered. Check Settings, Free models'
  return `Free models could not answer: ${why}.`
}

export async function askOnce(opts: AskOptions, free?: FreeRoute): Promise<string> {
  const path = await resolveClaude(opts.settings)
  if (!path) throw new Error('Claude Code is not installed.')
  const cwd = join(app.getPath('userData'), 'scratch')
  mkdirSync(cwd, { recursive: true })
  const tools = (opts.tools ?? []).filter((t) => !free || !/^Web/.test(t))
  const args = [
    '-p', '--output-format', 'json',
    '--model', free ? free.model : modelFor(opts.task, opts.settings),
    '--tools', tools.join(','),
    ...(tools.length ? ['--allowedTools', tools.join(','), '--permission-mode', 'dontAsk'] : []),
    ...(opts.addDirs ?? []).flatMap((d) => ['--add-dir', d]),
    '--no-session-persistence'
  ]
  const child = spawnClaude(path, args, { cwd, apiKey: !free && opts.settings.mode === 'apikey' ? opts.apiKey : null, free })
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    const who = free ? 'The free model' : 'Claude'
    const timer = setTimeout(() => { killTree(child); reject(new Error(`${who} took too long to answer.`)) }, opts.timeoutMs ?? 120000)
    opts.signal?.addEventListener('abort', () => { clearTimeout(timer); killTree(child); reject(new Error('Stopped.')) })
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out)
        if (free) { if (!j.is_error) noteFreeCall() }
        else recordModelUsage(j.modelUsage, j.usage)
        if (j.is_error || j.subtype !== 'success') reject(new Error(String(j.result || err || `${who} returned an error.`)))
        else {
          if (!free) claudeIsBack()
          resolve(String(j.result ?? ''))
        }
      } catch {
        reject(new Error((err || out || `No answer from ${who.toLowerCase()}.`).trim().slice(0, 400)))
      }
    })
    child.stdin?.end(opts.prompt)
  })
}

export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  for (const c of candidates) {
    if (!c) continue
    try { return JSON.parse(c.trim()) as T } catch { /* next */ }
  }
  return null
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

export function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export const shortName = (p: string) => basename(p)
