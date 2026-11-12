/**
 * Free business listings from OpenStreetMap: Nominatim finds the area, Overpass lists the
 * businesses in it. No key, no account, no cost. Both services ask for a clear User-Agent
 * and light use, so LeadPitch sends one geocode and one listing query per run.
 */

const UA = 'LeadPitch/0.1 (desktop lead research app)'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

export interface MapCandidate {
  name: string
  category: string
  address: string
  city: string
  phone: string
  email: string
  website: string
  socials: string[]
  openingHours: string
  chain: boolean
}

/** Industry words (English, French, Arabic) to OpenStreetMap tags. */
const TAGS: { words: RegExp; tags: [string, string][] ; label: string }[] = [
  { words: /caf[eé]|coffee|coffee ?shop|salon de th[eé]|مقهى|قهوة/i, tags: [['amenity', 'cafe']], label: 'Café' },
  { words: /restaurant|resto|bistro|brasserie|diner|eatery|مطعم/i, tags: [['amenity', 'restaurant']], label: 'Restaurant' },
  { words: /fast ?food|snack|pizz|burger|sandwich|takeaway|take-away/i, tags: [['amenity', 'fast_food']], label: 'Fast food' },
  { words: /\bbar\b|pub|lounge|night ?club|cocktail/i, tags: [['amenity', 'bar'], ['amenity', 'pub'], ['amenity', 'nightclub']], label: 'Bar' },
  { words: /ice ?cream|glac|gelat/i, tags: [['amenity', 'ice_cream']], label: 'Ice cream' },
  { words: /hotel|h[oô]tel|guest ?house|riad|resort|فندق/i, tags: [['tourism', 'hotel'], ['tourism', 'guest_house']], label: 'Hotel' },
  { words: /bakery|boulanger|p[aâ]tisser|pastry|مخبز/i, tags: [['shop', 'bakery'], ['shop', 'pastry']], label: 'Bakery' },
  { words: /gym|fitness|sport club|crossfit|yoga|pilates/i, tags: [['leisure', 'fitness_centre'], ['leisure', 'sports_centre']], label: 'Gym' },
  { words: /dentist|dentaire|dental/i, tags: [['amenity', 'dentist']], label: 'Dentist' },
  { words: /clinic|clinique|doctor|m[eé]decin|medical|cabinet/i, tags: [['amenity', 'clinic'], ['amenity', 'doctors']], label: 'Clinic' },
  { words: /pharma/i, tags: [['amenity', 'pharmacy']], label: 'Pharmacy' },
  { words: /school|[eé]cole|academy|training|formation|university/i, tags: [['amenity', 'school'], ['amenity', 'language_school'], ['amenity', 'college']], label: 'School' },
  { words: /hair|coiff|salon|beauty|beaut[eé]|spa|barber|nail/i, tags: [['shop', 'hairdresser'], ['shop', 'beauty'], ['leisure', 'spa']], label: 'Salon' },
  { words: /garage|car repair|auto|m[eé]canique|car dealer|concession/i, tags: [['shop', 'car_repair'], ['shop', 'car']], label: 'Car services' },
  { words: /real estate|immobili|property|agence immobili/i, tags: [['office', 'estate_agent']], label: 'Real estate' },
  { words: /lawyer|avocat|law firm|legal/i, tags: [['office', 'lawyer']], label: 'Law firm' },
  { words: /account|comptab|audit|expert.comptable/i, tags: [['office', 'accountant']], label: 'Accountant' },
  { words: /agency|agence|marketing|advertis|publicit|design studio/i, tags: [['office', 'advertising_agency'], ['office', 'company']], label: 'Agency' },
  { words: /software|saas|\bit\b|tech|startup|d[eé]velopp|digital|informatique/i, tags: [['office', 'it'], ['office', 'company'], ['office', 'telecommunication']], label: 'Tech company' },
  { words: /supermarket|grocery|[eé]picerie|convenience|superette|market/i, tags: [['shop', 'supermarket'], ['shop', 'convenience']], label: 'Grocery' },
  { words: /clothing|fashion|boutique|v[eê]tement|apparel/i, tags: [['shop', 'clothes'], ['shop', 'boutique']], label: 'Clothing' },
  { words: /travel|voyage|tour operator/i, tags: [['shop', 'travel_agency'], ['office', 'travel_agent']], label: 'Travel agency' },
  { words: /insurance|assurance/i, tags: [['office', 'insurance']], label: 'Insurance' },
  { words: /architect/i, tags: [['office', 'architect']], label: 'Architect' },
  { words: /event|wedding|traiteur|catering/i, tags: [['craft', 'caterer'], ['amenity', 'events_venue']], label: 'Events' }
]

/** Which OpenStreetMap tags fit the industry text. Empty when nothing maps (the web list is used instead). */
export function tagsFor(industry: string): { tags: [string, string][]; labels: string[] } {
  const tags: [string, string][] = []
  const labels: string[] = []
  for (const t of TAGS) {
    if (t.words.test(industry)) {
      labels.push(t.label)
      for (const tag of t.tags) if (!tags.some((x) => x[0] === tag[0] && x[1] === tag[1])) tags.push(tag)
    }
  }
  return { tags, labels }
}

async function getJson(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  signal?.addEventListener('abort', () => ctrl.abort())
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

interface Area { clause: string; label: string }

/** One or more places separated by "and" or commas ("Monastir and Mahdia, Tunisia"). */
async function geocode(location: string, signal?: AbortSignal): Promise<Area[]> {
  const country = location.includes(',') ? location.split(',').pop()!.trim() : ''
  const head = location.includes(',') ? location.slice(0, location.lastIndexOf(',')) : location
  const parts = head.split(/\s+and\s+|\s+et\s+|\s*[,/&]\s*/i).map((p) => p.trim()).filter(Boolean).slice(0, 4)
  const queries = parts.length ? parts.map((p) => (country ? `${p}, ${country}` : p)) : [location]
  const areas: Area[] = []
  for (const q of queries) {
    const res = await getJson(`${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(q)}`, {}, 20000, signal)
    const hit = res?.[0]
    if (!hit) continue
    // Bounding boxes are much faster for Overpass than administrative areas.
    if (hit.boundingbox) {
      const [s, n, w, e] = hit.boundingbox.map(Number)
      areas.push({ clause: `bbox:${s},${w},${n},${e}`, label: hit.display_name })
    }
    // Nominatim allows one request per second.
    await new Promise((r) => setTimeout(r, 1100))
  }
  return areas
}

/** Map answers are kept for a day: repeat searches of the same area are instant and spare the free service. */
const cache = new Map<string, { at: number; value: { candidates: MapCandidate[]; note: string } }>()

export async function findOnMap(industry: string, location: string, limit: number, signal?: AbortSignal): Promise<{ candidates: MapCandidate[]; note: string }> {
  const key = `${tagsFor(industry).labels.join(',')}|${location.trim().toLowerCase()}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 24 * 3600_000) return { ...hit.value, note: hit.value.note + ' (saved from an earlier search)' }
  const value = await findOnMapUncached(industry, location, limit, signal)
  if (value.candidates.length) cache.set(key, { at: Date.now(), value })
  return value
}

async function findOnMapUncached(industry: string, location: string, limit: number, signal?: AbortSignal): Promise<{ candidates: MapCandidate[]; note: string }> {
  const { tags, labels } = tagsFor(industry)
  if (!tags.length) return { candidates: [], note: 'This industry has no map category, so the map was skipped.' }
  if (!location.trim()) return { candidates: [], note: 'No location given, so the map was skipped.' }
  const areas = await geocode(location, signal)
  if (!areas.length) return { candidates: [], note: `Could not find "${location}" on the map.` }

  const blocks: string[] = []
  areas.forEach((a, i) => {
    if (a.clause.startsWith('bbox:')) {
      const bbox = a.clause.slice(5)
      for (const [k, v] of tags) blocks.push(`nwr["${k}"="${v}"]["name"](${bbox});`)
    } else {
      blocks.push(`${a.clause}->.a${i};`)
      for (const [k, v] of tags) blocks.push(`nwr["${k}"="${v}"]["name"](area.a${i});`)
    }
  })
  // Area set-up lines must come before the union; listing lines go inside it.
  const setup = blocks.filter((b) => b.includes('->.a'))
  const list = blocks.filter((b) => !b.includes('->.a'))
  const query = `[out:json][timeout:160];${setup.join('')}(${list.join('')});out center tags ${Math.min(1500, Math.max(200, limit * 4))};`

  // Ask the public servers at once and keep the first full answer; the rest are cancelled.
  const race = new AbortController()
  signal?.addEventListener('abort', () => race.abort())
  let data: any = null
  try {
    data = await Promise.any(
      OVERPASS.map((endpoint) =>
        getJson(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 75000, race.signal).then((j) => {
          if (!Array.isArray(j?.elements)) throw new Error('bad answer')
          return j
        })
      )
    )
  } catch {
    throw new Error('The map service did not answer. It is a free public service and is sometimes busy; try again in a minute.')
  } finally {
    race.abort()
  }

  const seen = new Set<string>()
  const out: MapCandidate[] = []
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {}
    const name = (t.name || t['name:fr'] || t['name:en'] || '').trim()
    if (!name) continue
    const key = name.toLowerCase() + '|' + (t['addr:city'] || '')
    if (seen.has(key)) continue
    seen.add(key)
    const tagLabel = labels.find((_, i) => i === 0) ?? ''
    const category = t.cuisine ? `${(t.amenity || t.shop || t.office || tagLabel).replace(/_/g, ' ')} (${String(t.cuisine).replace(/[_;]/g, ' ')})` : (t.amenity || t.shop || t.office || t.tourism || t.leisure || tagLabel).replace(/_/g, ' ')
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
    const city = t['addr:city'] || t['addr:town'] || t['addr:village'] || ''
    const socials = [t['contact:facebook'] || t.facebook, t['contact:instagram'] || t.instagram].filter(Boolean).map(String)
    out.push({
      name,
      category,
      address: [street, t['addr:postcode'], city].filter(Boolean).join(', '),
      city,
      phone: String(t.phone || t['contact:phone'] || t['contact:mobile'] || '').split(';')[0].trim(),
      email: String(t.email || t['contact:email'] || '').split(';')[0].trim(),
      website: String(t.website || t['contact:website'] || t.url || '').trim(),
      socials,
      openingHours: String(t.opening_hours || ''),
      chain: !!(t.brand || t['brand:wikidata'])
    })
  }
  // Independent places with a website or phone first: they are reachable and easier to judge.
  out.sort((a, b) => Number(b.chain === false) - Number(a.chain === false) || Number(!!b.website) - Number(!!a.website) || Number(!!b.phone) - Number(!!a.phone))
  return { candidates: out, note: `${out.length} listed on the map in ${areas.map((a) => a.label.split(',')[0]).join(', ')}.` }
}
