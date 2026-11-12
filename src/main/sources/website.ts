/**
 * Reads a company website with plain HTTP and pulls out what is published: emails, phones,
 * people, social links, tech and a short text summary. No Claude tokens are used here.
 * Extraction ideas adapted from ai-sales-team-claude's contact_finder.py and
 * analyze_prospect.py (MIT, Zubair Trabzada).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) LeadPitch/0.1 Safari/537.36'
const CONTACT_PATHS = /contact|about|team|equipe|[eé]quipe|qui-sommes|a-propos|apropos|impressum|mentions|legal|kontakt|nous|staff|leadership|people/i
const SOCIAL = /https?:\/\/(?:www\.|m\.|web\.)?(facebook\.com|instagram\.com|linkedin\.com\/(?:company|in)|x\.com|twitter\.com|tiktok\.com|youtube\.com)\/[^\s"'<>)]+/gi
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.|sentry|wixpress|domain\.com|email\.com|yourname|u003e|@2x/i
const PHONE_TEL = /href=["']tel:([^"']+)["']/gi
const PHONE_TEXT = /(?:\+|00)\d[\d\s().-]{7,18}\d/g

const TECH: [string, RegExp][] = [
  ['WordPress', /wp-content|wp-includes/i],
  ['WooCommerce', /woocommerce/i],
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['Wix', /wixstatic|parastorage|wix\.com/i],
  ['Squarespace', /squarespace/i],
  ['Webflow', /webflow/i],
  ['HubSpot', /hs-scripts\.com|hubspot/i],
  ['Google Analytics', /googletagmanager|google-analytics|gtag\(/i],
  ['Meta Pixel', /connect\.facebook\.net|fbq\(/i],
  ['Calendly', /calendly\.com/i],
  ['Intercom', /intercom/i],
  ['Online ordering', /order online|commander en ligne|commande en ligne|click ?& ?collect|glovo|uber ?eats|deliveroo|jumia food|talabat/i],
  ['Online booking', /book a table|r[eé]server une table|reservation|r[eé]servation en ligne|thefork|opentable/i],
  ['Online menu', /menu (?:pdf|digital|qr)|qr ?code menu|menu en ligne/i]
]

export interface SiteFacts {
  ok: boolean
  url: string
  title: string
  description: string
  text: string
  emails: string[]
  phones: string[]
  socials: string[]
  people: { name: string; title: string }[]
  tech: string[]
  contactUrl: string
  error?: string
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#64;|&commat;/g, '@').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
}

function visibleText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<{ html: string; finalUrl: string } | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 9000)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en,fr;q=0.9,ar;q=0.8' } })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
    const reader = res.body?.getReader()
    if (!reader) return null
    let html = ''
    const dec = new TextDecoder()
    // Read at most 1.5 MB of a page.
    while (html.length < 1_500_000) {
      const { done, value } = await reader.read()
      if (done) break
      html += dec.decode(value, { stream: true })
    }
    reader.cancel().catch(() => {})
    return { html, finalUrl: res.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
}

function jsonLd(html: string): any[] {
  const out: any[] = []
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim())
      const items = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j]
      out.push(...items)
    } catch { /* ignore broken blocks */ }
  }
  return out
}

const SENIOR = /owner|founder|co-?founder|ceo|managing director|general manager|directeur|directrice|g[eé]rant|propri[eé]taire|president|head of|chief|manager|partner|associ[eé]/i

export function normalizePhone(p: string): string {
  const s = p.replace(/[^\d+]/g, '')
  return s.length >= 8 ? p.trim().replace(/\s+/g, ' ') : ''
}

/** Reads the homepage and up to three contact-type pages linked from it. */
export async function readWebsite(rawUrl: string, signal?: AbortSignal): Promise<SiteFacts> {
  const base: SiteFacts = { ok: false, url: rawUrl, title: '', description: '', text: '', emails: [], phones: [], socials: [], people: [], tech: [], contactUrl: '' }
  let url = rawUrl.trim()
  if (!url) return base
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  if (/facebook\.com|instagram\.com|linkedin\.com/i.test(url)) return { ...base, socials: [url], error: 'Social page, not a website' }

  const home = await fetchHtml(url, signal)
  if (!home) return { ...base, error: 'Website did not load' }
  const origin = new URL(home.finalUrl).origin
  const pages = [home.html]
  let contactUrl = ''
  const links = [...home.html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: m[1], text: visibleText(m[2]) }))
    .filter((l) => CONTACT_PATHS.test(l.href) || CONTACT_PATHS.test(l.text))
  const extra: string[] = []
  for (const l of links) {
    try {
      const u = new URL(decode(l.href), home.finalUrl)
      if (u.origin !== origin || extra.includes(u.href) || u.href === home.finalUrl) continue
      extra.push(u.href)
      if (!contactUrl && /contact/i.test(u.href + l.text)) contactUrl = u.href
    } catch { /* bad link */ }
    if (extra.length >= 3) break
  }
  const more = await Promise.all(extra.map((u) => fetchHtml(u, signal)))
  for (const p of more) if (p) pages.push(p.html)

  const all = pages.join('\n')
  const emails = new Set<string>()
  for (const m of all.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.add(decode(decodeURIComponent(m[1])).toLowerCase())
  for (const m of decode(all.replace(/<script[\s\S]*?<\/script>/gi, ' ')).matchAll(EMAIL)) emails.add(m[0].toLowerCase())
  const phones = new Set<string>()
  for (const m of all.matchAll(PHONE_TEL)) { const p = normalizePhone(decodeURIComponent(m[1])); if (p) phones.add(p) }
  const people: { name: string; title: string }[] = []
  for (const item of pages.flatMap(jsonLd)) {
    const type = String(item['@type'] ?? '')
    if (item.telephone) { const p = normalizePhone(String(item.telephone)); if (p) phones.add(p) }
    if (item.email) emails.add(String(item.email).replace(/^mailto:/i, '').toLowerCase())
    if (/Person/i.test(type) && item.name) people.push({ name: String(item.name), title: String(item.jobTitle ?? '') })
    for (const f of [item.founder, item.employee].flat().filter(Boolean)) if (f?.name) people.push({ name: String(f.name), title: String(f.jobTitle ?? (item.founder ? 'Founder' : '')) })
  }
  if (!phones.size) for (const m of visibleText(all).matchAll(PHONE_TEXT)) { const p = normalizePhone(m[0]); if (p) phones.add(p); if (phones.size >= 2) break }

  const socials = [...new Set([...all.matchAll(SOCIAL)].map((m) => m[0].replace(/[\\]+$/, '').split('?')[0]))].filter((s) => !/sharer|share\?|intent\/|plugins|dialog|tr\?id/i.test(s)).slice(0, 6)
  const title = decode((home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()).slice(0, 140)
  const description = decode(home.html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? home.html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i)?.[1] ?? '').slice(0, 300)
  const tech = TECH.filter(([, re]) => re.test(all)).map(([n]) => n)

  return {
    ok: true,
    url: home.finalUrl,
    title,
    description,
    text: visibleText(home.html).slice(0, 700),
    emails: [...emails].filter((e) => !BAD_EMAIL.test(e) && e.length < 80).slice(0, 4),
    phones: [...phones].slice(0, 3),
    socials,
    people: people.filter((p) => p.name.length < 60).sort((a, b) => Number(SENIOR.test(b.title)) - Number(SENIOR.test(a.title))).slice(0, 5),
    tech,
    contactUrl
  }
}

/** Runs `fn` over items with at most `n` at a time. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>, stop?: () => boolean): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length && !stop?.()) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}
