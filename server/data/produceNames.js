// Produce name normalisation.
//
// A retailer's product name is marketing copy: the item, plus the brand, the
// pack format, the portion, the size grade and sometimes the weight, in
// whatever order the buyer typed it. `Woolworths Brushed Potatoes Bag 2kg` and
// `Woolworths Brushed Potatoes Bag 4kg` are one product in two sizes;
// `Potato Brushed` (loose, per each) is the same potato again. This module
// pulls the name apart so that:
//
//   itemName    what the thing is          "Brushed Potatoes"
//   packFormat  how it is sold             bag | punnet | bunch | loose | each | multipack | prepack | tray | box | pack
//   portion     whole | half | quarter     (a half cabbage is not a cabbage)
//   sizeGrade   small | medium | large     (an attribute of the fruit, not the pack)
//   nameWeight  a weight the NAME carried  "Royal Gala Apples 1kg" whose size field says "1 each"
//   itemKey     sorted singular tokens     "brushed|potato" — same key => same item
//
// Everything stripped from the name is kept in a field, so nothing the
// retailer said is lost; it just stops living in the name. The measurement
// slot (`sizeLabel`) is rebuilt from those fields: "2kg bag", "250g punnet",
// "bunch", "approx. 170g loose", "each · half".
//
// Deterministic, name-derived, no I/O — so it can run at load over the whole
// archive and the same rules can be ported to the Lambda later.

// ---------------------------------------------------------------- vocab

// Retailer / house brands and marketing phrases that say who sells it, not
// what it is. Phrases are matched before single words; longest first.
const BRAND_PHRASES = [
  'fresh food kids', 'perfection fresh', 'growers selection', 'grab n glow',
  'southern bliss', 'eat later', 'sweet & juicy', 'big juicy crisp', 'market lane', 'coles kitchen', 'just veg.', 'golden palm',
]
// Two-word names the token pass must not split or dedupe.
// Joined with "_", which titleWord renders back as a space.
// The asian-greens forms come first: Coles writes the pair REVERSED under its
// own "Asian Choy" range ("Asian Choy Buk", "Asian Choy Pak", "Asian Choy Sum")
// while Woolworths writes it the usual way round ("Buk Choy", "Choy Sum"), so
// both orders have to land on one token before anything else reads the name.
// "Asian Greens" is Woolworths' shelf label for the whole range — joined here so
// FILLER_WORDS can drop it as one word rather than leaving a bare `green` that
// the residual rule would read as a colour.  — 2026-11-15
const JOIN_PHRASES = { 'choy buk': 'bok_choy', 'buk choy': 'bok_choy', 'choy pak': 'pak_choy', 'pak choi': 'pak_choy', 'choy sum': 'choy_sum', 'asian greens': 'asian_green', 'cara cara': 'cara_cara', 'spud lite': 'spudlite', 'kiwi fruit': 'kiwifruit', 'paw paw': 'pawpaw', 'sweet potato': 'sweet_potato', 'pak choy': 'pak_choy', 'bok choy': 'bok_choy', 'spring onion': 'spring_onion', 'snow pea': 'snow_pea', 'sugar snap': 'sugar_snap' }
// A leading head noun stays put when the item is a dish or a cut, not the
// produce itself: "Potato Salad" is not a potato.
const NOT_HEAD_TAIL = new Set(['salad', 'kit', 'mix', 'paste', 'slice', 'chip', 'juice', 'dip', 'soup', 'medley', 'snack', 'bowl', 'noodle', 'rice', 'fries', 'mash', 'stir', 'stick', 'floret', 'wedge', 'cob', 'cobette', 'spear', 'rib', 'heart', 'cup', 'clove', 'leaf', 'bacon', 'egg', 'chicken', 'cheese', 'butter', 'pasta', 'roll', 'wrap'])
// Dropped only when other words remain: "Sleeved Herbs Basil" is basil.
// `asian` and `asian_green` are the two retailers' range labels for the same
// shelf — "Asian Choy Chinese Broccoli" (Coles) and "Chinese Broccoli Asian
// Greens" (Woolworths) are one vegetable, and neither label says which.
const FILLER_WORDS = new Set(['herbs', 'herb', 'produce', 'style', 'asian', 'asian_green'])
const BRAND_WORDS = new Set(['woolworths', 'coles', 'kitchen', 'macro', 'fresh', 'natoora', 'zerella', 'australian', 'aust', 'value', 'coco', 'q', 'zespri', 'perfection', 'absolute', 'ausfresh'])

// Words dropped from `itemKey` but kept in `itemName` — a retailer column
// already carries the fact, so only one retailer bothers to say it in the name.
// See the comment at the itemKey assignment below.
const KEY_STOP_WORDS = new Set(['organic'])

// Both retailers run an odd-grade line under their own name. One token for
// both, so they group with each other and never with the regular line.
const IMPERFECT_PHRASES = ['the odd bunch', "i'm perfect", "i' m perfect", 'im perfect', 'imperfect']

const PACK_WORDS = {
  bunch: 'bunch', punnet: 'punnet', bag: 'bag', tray: 'tray', box: 'box', sleeve: 'sleeve', net: 'net',
  // The plurals. Only the singulars were listed, so Coles' "Herb Punnets
  // Basil" kept `punnet` as though it were part of the variety and every one
  // of its 17 herb punnets failed the residual rule.  — 2026-11-15
  bunches: 'bunch', punnets: 'punnet', bags: 'bag', trays: 'tray', boxes: 'box', sleeves: 'sleeve', nets: 'net',
  tubs: 'tub', jars: 'jar', bottles: 'bottle', sachets: 'sachet', packets: 'packet', packs: 'pack',
  // A combo or twin pack is a pack format, not a kind of lettuce.
  combo: 'pack', twin: 'multipack',
  loose: 'loose', sleeved: 'sleeve', prepack: 'prepack', prepacked: 'prepack', 'pre-pack': 'prepack', 'pre-packed': 'prepack',
  pack: 'pack', packed: 'pack', bulk: 'bulk', tub: 'tub', jar: 'jar', bottle: 'bottle', sachet: 'sachet', packet: 'packet', pkt: 'packet',
}
// When a name says two things ("Prepack Punnet") the more specific wins.
const PACK_RANK = ['bunch', 'punnet', 'bag', 'multipack', 'tray', 'box', 'tub', 'jar', 'bottle', 'sachet', 'packet', 'sleeve', 'net', 'prepack', 'loose', 'bulk', 'pack', 'each']

const PORTION_WORDS = { whole: 'whole', half: 'half', quarter: 'quarter', qtr: 'quarter' }
const GRADE_WORDS = { small: 'small', sml: 'small', medium: 'medium', med: 'medium', md: 'medium', large: 'large', lge: 'large', lrg: 'large', xl: 'extra large', jumbo: 'jumbo' }

// Head nouns: when a retailer writes "Potato Brushed" the item is a potato
// and "brushed" describes it. Rotating a leading head noun to the end gives
// one reading order per item so the display name is stable across SKUs.
const HEAD_NOUNS = new Set([
  'apple', 'apricot', 'asparagus', 'avocado', 'banana', 'bean', 'beetroot', 'blueberry', 'broccoli', 'broccolini',
  'cabbage', 'capsicum', 'carrot', 'cauliflower', 'celery', 'cherry', 'chilli', 'corn', 'cucumber', 'eggplant',
  'fennel', 'garlic', 'ginger', 'grape', 'grapefruit', 'kale', 'kiwifruit', 'leek', 'lemon', 'lettuce', 'lime',
  'mandarin', 'mango', 'melon', 'mushroom', 'nectarine', 'onion', 'orange', 'papaya', 'parsnip', 'passionfruit',
  'peach', 'pear', 'pea', 'pineapple', 'plum', 'potato', 'pumpkin', 'radish', 'raspberry', 'rockmelon', 'shallot',
  'spinach', 'strawberry', 'tomato', 'turnip', 'watermelon', 'zucchini', 'honeydew', 'sprout', 'sweet_potato', 'spring_onion',
  'snow_pea', 'pak_choy', 'bok_choy', 'choy_sum', 'wombok', 'beet', 'date', 'fig', 'lychee', 'persimmon', 'pomegranate', 'quince', 'coconut',
])

// Singular forms for the token key. Regular rules cover most; these are the
// words the rules get wrong.
const SINGULAR = { leaves: 'leaf', tomatoes: 'tomato', potatoes: 'potato', mangoes: 'mango', avocados: 'avocado', chillies: 'chilli', cos: 'cos', swiss: 'swiss', asparagus: 'asparagus', citrus: 'citrus', hummus: 'hummus', watercress: 'watercress', brussels: 'brussel', kids: 'kids', cress: 'cress', radicchio: 'radicchio' }
function singular(w) {
  if (SINGULAR[w]) return SINGULAR[w]
  if (/^\d/.test(w) || w.length < 4) return w
  if (/(ss|us|is)$/.test(w)) return w
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/(ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2)
  if (/oes$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w)) return w.slice(0, -1)
  return w
}

const WEIGHT_RE = /^(\d+(?:\.\d+)?)\s*(kg|g|ml|l)$/i

// ---------------------------------------------------------------- parse

/**
 * @param {string} rawName   product_name as captured
 * @param {object} [ctx]     { brand, soldBy, packageSize }
 */
export function parseProduceName(rawName, ctx = {}) {
  let s = String(rawName || '')
    .replace(/[®™�]/g, ' ')          // ®, ™, mojibake
    .replace(/\s+/g, ' ').trim().toLowerCase()

  const out = { packFormat: null, portion: null, sizeGrade: null, nameWeight: null, multipack: null, imperfect: false }

  for (const ph of IMPERFECT_PHRASES) if (s.includes(ph)) { s = s.split(ph).join(' imperfect '); out.imperfect = true }
  for (const ph of BRAND_PHRASES) s = s.split(ph).join(ph === 'fresh food kids' ? ' kids ' : ' ')
  // NB: the retailer's `brand` column is deliberately NOT stripped —
  // Woolworths puts the cultivar there (Jazz, Kanzi, Envy, Bravo).
  for (const [ph, j] of Object.entries(JOIN_PHRASES)) s = s.split(ph).join(j)

  // "1 kg", "5 pack", "approx. 900g" -> single tokens before splitting.
  s = s.replace(/(\d+(?:\.\d+)?)\s+(kg|g|ml|l)\b/g, '$1$2')
       .replace(/(\d+)\s+(pack|pk)\b/g, '$1pack')
       .replace(/\bapprox\.?\s*/g, '')

  let tokens = s.split(/[^a-z0-9.'&_-]+/).filter(Boolean)
  // "Apple Cosmic Crisp Md Apple Cosmic Crisp": the whole name repeated.
  const half = tokens.length >> 1
  if (half && tokens.length % 2 === 0 && tokens.slice(0, half).join(' ') === tokens.slice(half).join(' ')) tokens = tokens.slice(0, half)
  const kept = []
  const packs = []
  for (let t of tokens) {
    t = t.replace(/^[.-]+|[.-]+$/g, '')
    if (!t || t === '&' || t === 'and' || t === 'n' || t === 'with' || t === 'for') continue
    let m
    if ((m = t.match(WEIGHT_RE))) { out.nameWeight = `${m[1]}${m[2].toLowerCase()}`; continue }
    if ((m = t.match(/^(\d+)pack$/))) { out.multipack = Number(m[1]); packs.push('multipack'); continue }
    if (t === 'pre') continue                                         // "pre pack" -> "pack" handled next
    if (PACK_WORDS[t]) { packs.push(PACK_WORDS[t]); continue }
    if (PORTION_WORDS[t]) { out.portion = PORTION_WORDS[t]; continue }
    if (GRADE_WORDS[t]) { out.sizeGrade = GRADE_WORDS[t]; continue }
    if (BRAND_WORDS.has(t)) continue
    if (/^\d+$/.test(t)) continue                                     // stray count
    kept.push(t)
  }

  // Word tokens, deduped by singular form (Lemon Lemon Bag, Punnet Punnet).
  const seen = new Set()
  let words = []
  const meaningful = kept.filter(w => !FILLER_WORDS.has(w))
  for (const w of (meaningful.length ? meaningful : kept)) { const k = singular(w); if (!seen.has(k)) { seen.add(k); words.push({ w, k }) } }
  // Leading head noun goes last: "potato brushed" -> "brushed potato".
  const tail = words[words.length - 1]
  if (words.length > 1 && HEAD_NOUNS.has(words[0].k) && !HEAD_NOUNS.has(tail.k) && !words.some(x => NOT_HEAD_TAIL.has(x.k))) words.push(words.shift())

  out.itemName = words.map(x => titleWord(x.w)).join(' ')
  // The KEY drops words the retailer's own columns already carry; the NAME keeps
  // them. Both spellings of an organic line have to produce one key —
  // Woolworths writes it in the name ("Macro Organic Beetroot", 57 of its 59
  // organic rows), Coles in the brand column ("Beetroot", brand "Coles
  // Organic", 41 of its 53) — so a token that only one retailer emits would
  // split the pair forever. `is_organic` is reliable on both sides and is
  // already what segments the item id, so the token is pure duplication.
  // Keeping it in itemName means the card still reads "Organic Beetroot".
  out.itemKey = words.map(x => x.k).filter(k => !KEY_STOP_WORDS.has(k)).sort().join('|')

  // A multipack count the SIZE field carried rather than the name. Coles files
  // `Grab N Glow Pink Lady` with package_size_raw "6 Pack" and says nothing in
  // the name, so reading only the name leaves multipack null — and a null there
  // makes a 6-pack of small snack apples look pack-compatible with one loose
  // apple, which is exactly the false $/ea comparison the matcher must refuse.
  if (out.multipack == null) {
    const m = String(ctx.packageSize || '').trim().match(/^(\d+)\s*(pack|pk)$/i)
    if (m) out.multipack = Number(m[1])
  }

  // Pack format: the most specific thing the name said, else what the
  // retailer's sold_by says.
  const sizeWord = normaliseSize(ctx.packageSize)
  if (PACK_WORDS[sizeWord]) packs.push(PACK_WORDS[sizeWord])       // package_size_raw "1 Bunch"
  packs.sort((a, b) => PACK_RANK.indexOf(a) - PACK_RANK.indexOf(b))
  out.packFormat = packs[0] || (ctx.soldBy === 'weight' ? 'loose' : ctx.soldBy === 'each' ? 'each' : ctx.soldBy === 'pack' ? 'pack' : null)
  if (out.packFormat === 'pack' && out.nameWeight == null && /each/i.test(ctx.packageSize || '')) out.packFormat = 'each'
  if (out.packFormat === 'each' && out.nameWeight) out.packFormat = 'pack'  // "Royal Gala Apples 1kg" sold as "1 each"
  return out
}

function titleWord(w) {
  if (/^\d/.test(w)) return w
  return w.split(/([-_])/).map(p => p === '-' ? '-' : p === '_' ? ' ' : p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

// ---------------------------------------------------------------- size label

// "2Kg" -> "2kg", "1 Each" -> "each", "approx. 2kg each" -> "approx. 2kg".
export function normaliseSize(raw) {
  let s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s) return ''
  if (/^1 each$/.test(s) || s === 'each') return 'each'
  const m = s.match(/^(?:1 )?([a-z]+)$/)
  if (m && PACK_WORDS[m[1]]) return PACK_WORDS[m[1]]
  s = s.replace(/(\d)\s*(kg|g|ml|l)\b/g, '$1$2').replace(/\s*each$/, '').replace(/^approx\.?\s*/, 'approx. ')
  return s
}

const HAS_QTY = /\d/

/**
 * The measurement slot. Built from the size field, the weight the name
 * carried when the size field was only "each", and the pack format.
 */
export function sizeLabel(parsed, ctx = {}) {
  const size = normaliseSize(ctx.packageSize)
  const qty = HAS_QTY.test(size) ? size : parsed.nameWeight || ''
  const fmt = parsed.packFormat
  let label
  if (parsed.multipack) label = `${parsed.multipack} pack`
  else if (fmt === 'loose') label = qty ? `${qty} loose` : 'loose'
  else if (fmt === 'each') label = qty ? qty : 'each'
  else if (fmt === 'bunch') label = qty ? `${qty} bunch` : 'bunch'
  else if (fmt === 'pack' || !fmt) label = qty || size || 'each'
  else label = qty ? `${qty} ${fmt}` : fmt
  if (parsed.portion && parsed.portion !== 'whole') label += ` · ${parsed.portion}`
  return label
}

// Sort order for sizes of one item: by net quantity in grams, loose/each last.
export function sizeRank(p) {
  const m = String(p.sizeLabel || '').match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)/)
  if (m) return Number(m[1]) * (m[2] === 'kg' || m[2] === 'l' ? 1000 : 1)
  if (p.multipack) return 1e6 + p.multipack
  return 2e6
}

// One display name for an item whose SKUs spell it differently ("Brushed
// Potato" / "Brushed Potatoes"): the spelling most SKUs use, then the plural,
// then the shorter.
export function pickItemName(names) {
  const n = new Map()
  for (const x of names) n.set(x, (n.get(x) || 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (/s$/.test(b[0]) - /s$/.test(a[0])) || a[0].length - b[0].length)[0]?.[0] || ''
}
