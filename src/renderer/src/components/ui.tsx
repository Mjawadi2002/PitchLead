import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { CaretLeft, CaretRight, Check } from '@phosphor-icons/react'
import { STAGES, type Stage } from '@shared/types'
import { spring } from '../state'

export function Logo({ size = 20, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4C6CFF" />
          <stop offset="1" stopColor="#2742C7" />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#f${id})`} />
      <rect width="64" height="64" rx="15" fill={`url(#s${id})`} />
      <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" strokeOpacity=".16" />
      <circle cx="28" cy="28" r="14.5" fill="none" stroke="#fff" strokeWidth="5" />
      <path d="M38.8 38.8 L48.5 48.5" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
      <rect x="20.5" y="29" width="4" height="6" rx="1.5" fill="#fff" fillOpacity=".55" />
      <rect x="26" y="25.5" width="4" height="9.5" rx="1.5" fill="#fff" fillOpacity=".75" />
      <rect x="31.5" y="21" width="4" height="14" rx="1.5" fill="#fff" />
    </svg>
  )
}

export function Score({ value }: { value: number }) {
  const on = Math.round(value / 2)
  return (
    <span className={`score ${value >= 8 ? '' : value >= 5 ? 'mid' : 'low'}`} title={`Fit ${value} of 10`}>
      <span className="score-bars" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= on ? 'on' : ''} />
        ))}
      </span>
      <span className="num">{value}</span>
    </span>
  )
}

export const stageLabel = (s: Stage) => STAGES.find((x) => x.id === s)?.label ?? s

export function StagePill({ stage }: { stage: Stage }) {
  return <span className={`pill s-${stage}`}>{stageLabel(stage)}</span>
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  style
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  style?: React.CSSProperties
}) {
  const id = useId()
  return (
    <div className="seg" role="group" aria-label={label} style={style}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg${id}`} className="seg-thumb" transition={spring} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className="checkbox"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
    >
      {checked && <Check size={11} weight="bold" />}
    </button>
  )
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export const initials = (n: string) =>
  n
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(the|le|la|les|du|de|des|and|et)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || n.slice(0, 2).toUpperCase()

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(t).toLocaleDateString()
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const isMac = () => window.lp.platform === 'darwin'
export const mod = () => (isMac() ? 'Cmd' : 'Ctrl')

/** Page numbers with gaps: 1 … 4 5 6 … 12 */
function pageList(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i)
  const set = new Set([0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages))
  if (page <= 2) [1, 2, 3].forEach((p) => set.add(p))
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((p) => set.add(p))
  const sorted = [...set].sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('gap')
    out.push(p)
  })
  return out
}

export const PAGE_SIZES = [25, 50, 100]

export function Pager({
  page, size, total, onPage, onSize, noun = 'leads'
}: { page: number; size: number; total: number; onPage: (p: number) => void; onSize?: (s: number) => void; noun?: string }) {
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total ? page * size + 1 : 0
  const to = Math.min(total, (page + 1) * size)
  return (
    <nav className="pager" aria-label="Pages">
      <span className="muted num">{from}–{to} of {total} {noun}</span>
      {onSize && (
        <label className="pager-size">
          <span className="muted">Per page</span>
          <select className="input" value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      <div className="pager-pages">
        <button className="icon-btn sm" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}><CaretLeft size={13} weight="bold" /></button>
        {pageList(page, pages).map((p, i) =>
          p === 'gap' ? <span key={`g${i}`} className="pager-gap">…</span> : (
            <button key={p} className="pager-num num" aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>{p + 1}</button>
          )
        )}
        <button className="icon-btn sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}><CaretRight size={13} weight="bold" /></button>
      </div>
    </nav>
  )
}

export function ShowMore({ shown, total, step, onMore, noun }: { shown: number; total: number; step: number; onMore: () => void; noun: string }) {
  if (shown >= total) return null
  return (
    <button className="show-more" onClick={onMore}>
      Show {Math.min(step, total - shown)} more <span className="muted num">· {total - shown} {noun} hidden</span>
    </button>
  )
}

export const fmtTokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

/** The real 5-hour plan usage from Claude; before the first reply, an estimate against the busiest recent window. */
export function usagePercent(u: { current: { tokens: number } | null; peakTokens: number; plan?: { fiveHour?: { pct: number } } } | null): number | null {
  if (!u) return null
  if (u.plan?.fiveHour) return Math.min(100, u.plan.fiveHour.pct)
  if (!u.current) return 0
  if (!u.peakTokens) return null
  return Math.min(100, Math.round((u.current.tokens / u.peakTokens) * 100))
}

export function resetsIn(end: number): string {
  const m = Math.max(0, Math.round((end - Date.now()) / 60000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

export function Meter({ value, tone }: { value: number; tone?: 'warn' | 'neg' | '' }) {
  return <span className={`meter ${tone ?? ''}`} aria-hidden><i style={{ width: `${Math.max(2, value)}%` }} /></span>
}
