import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { Check } from '@phosphor-icons/react'
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
      <path d="M14 48 L24 48" stroke="#fff" strokeOpacity=".45" strokeWidth="4" strokeLinecap="round" />
      <path d="M17 47 C 22 30, 32 20, 45.5 19.5" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="47" cy="19.5" r="6.5" fill="#fff" />
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
