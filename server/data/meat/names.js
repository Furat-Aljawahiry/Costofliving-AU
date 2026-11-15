// A meat, poultry or seafood product name, pulled apart.
//
//   parseMeatName('Woolworths RSPCA Approved Chicken Thigh Fillets Skinless', { brand: 'Woolworths', ... })
//     -> { species: 'chicken', cut: ['fillet','thigh'], attrs: [], flavours: [],
//          kind: 'meat', residual: [], ... }
//
// The rules, in order:
//   1. Brand out (the user's ruling: brand is ignored), weights and counts out.
//   2. Phrases to single tokens (lexicon.js PHRASES).
//   3. Every remaining word is classified: species, cut, attribute, flavour,
//      out-of-scope, or ignorable. A word that is none of these is RESIDUE.
//   4. Residue means the name says something we do not understand, so the
//      product gets no key (kind 'unparsed') and shows up in the review list
//      with the words that stopped it. Refusing is the safe failure: a missing
//      match costs a comparison, a wrong one costs trust.
//   5. Cut normalisation (species-aware defaults: a chicken fillet is
//      skinless and boneless unless it says otherwise, a fish fillet is a
//      portion, and so on).
import {
  PHRASES, SPECIES, FISH, GRADED_SEAFOOD, SPECIES_FROM_CATEGORY, SPECIES_FROM_ATTR, SPECIES_FROM_FLAVOUR, SPECIES_FROM_BRAND,
  UNSPECIFIED_OK, CHICKEN_ONLY_CUTS, ATTRS_FROM_BRAND, CUT_WORDS, STEAK_CUTS, ATTRS, FLAVOURS, OUT_OF_SCOPE, IGNORABLE,
} from './lexicon.js'
import { parsePackSize, fmtG } from './weights.js'

// Brand prefixes the brand column does not always carry (Woolworths counter
// lines put a generic word there: brand "Prawn", "Squid"), and Coles sub-ranges
// that appear in the name itself.
const BRAND_PREFIXES = [
  'woolworths', 'macro', 'market value', 'coles finest', 'coles simply', 'coles made easy', 'coles deli',
  'coles', 'the bare bird', 'tassal', 'k roo', 'ingham s', 'inghams', 'steggles', 'lilydale', 'luv a duck',
  'ocean blue', 'ocean chef', 'just caught', 'humpty doo', 'jc seafood', 'fresh menu', 'peppercorn',
  'thomas dux', 'mowi', 'regal', 'huon', 'talley s', 'bertocchi', 'd orsogna', 'don melosi', 'don', 'hans',
  'primo', 'zeus street greek', 'strength meals co', 'fitzco', 'canon foods', 'cleaver s organic',
  'cleaver s', 'cleavers organic', 'cleavers', 'inglewood farms', 'inglewood', 'drovers choice', 'drovers',
  'el amin s', 'fettayleh foods', 'fettayleh', 'kb s', 'kb', 'boston bay', 'norfolk bay', 'harris smokehouse',
  'superior gold', 'il pescatore', 'barossa fine foods', 'goulburn river trout', 'game farm', 'agrios',
  'birch waite', 'holland house', 'gourmet chef', 'bag bake', 'north coast sydney', 'pacific fresh',
  'oyster fresh', 'united fish co', 'viking platter', 'moira mac s', 'moira', 'mac', 'pastoral', 'clonakilty',
  'montecatini', 'grill d', 'british sausage co', 'the british sausage co', 'british', 'beak sons',
  'small batch', 'continental kosher butchers', 'continental kosher butcher', 'continental', 'kosher butchers',
  'lewis and sons', 'lewis and son', 'olga s fine foods', 'richmond valley', 'yumbah', 'seabounty fresh',
  'karumba', 'fremantle', 'cooke seafood', 'always fresh', 'heritage', 'x gami',
]

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’'`]/g, ' ')
  .replace(/é/g, 'e')
  .replace(/[^a-z0-9.\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Plural -> singular for the words that matter. Generic: drop a trailing s
// from words of 4+ letters that do not end in ss/us/is. A few irregulars.
const IRREGULAR = { pieces: 'portion', piece: 'portion', slices: 'slice', sliced: 'slice', cheeses: 'cheese', patties: 'burger', patty: 'burger', loins: 'loin', midloins: 'loin', midloin: 'loin', giblets: 'giblet', kebabs: 'kebab', skewers: 'kebab', skewer: 'kebab', shaslicks: 'kebab', shaslick: 'kebab', kafta: 'kofta', koftas: 'kofta', chevapi: 'chevap', cevapi: 'chevap', chevaps: 'chevap', drumettes: 'drumette', calamari: 'calamari', bites: 'bite', hotdogs: 'hotdog', 'hot dog': 'hotdog', rashers: 'rasher', bugs: 'bug', fillets: 'fillet', steaks: 'steak', chops: 'chop', portions: 'portion', schnitzels: 'schnitzel', tenders: 'tender', breasts: 'breast', legs: 'leg', ribs: 'rib', riblets: 'riblet', medallions: 'medallion', cheeks: 'cheek', tubes: 'tube', rings: 'ring', tails: 'tail', oysters: 'oyster', mussels: 'mussel', prawns: 'prawn', sausages: 'sausage', burgers: 'burger' }
function singular(t) {
  if (IRREGULAR[t]) return IRREGULAR[t]
  if (t.length >= 4 && /s$/.test(t) && !/(ss|us|is)$/.test(t)) return t.slice(0, -1)
  return t
}

const WEIGHT_RE = /\b(\d+(?:\.\d+)?)\s*(kg|g)\b/
const toGrams = (v, u) => Number(v) * (u === 'kg' ? 1000 : 1)

export function parseMeatName(rawName, ctx = {}) {
  let s = ` ${norm(rawName)} `
  const brand = norm(ctx.brand)

  // 1. Brand out. The brand column first, then the known prefixes, repeatedly
  // ("Coles Made Easy ..." under brand "Coles").
  for (let guard = 0; guard < 3; guard++) {
    const before = s
    if (brand && s.startsWith(` ${brand} `)) s = s.slice(brand.length + 1)
    for (const b of BRAND_PREFIXES) if (s.startsWith(` ${b} `)) { s = s.slice(b.length + 1); break }
    if (s === before) break
  }

  // Weight and counts. norm() has already turned "-" and "/" into spaces, so
  // "4 - 6 Pieces" arrives as "4 6 pieces" and "1/2 kg" as "1 2 kg".
  s = s.replace(/\b1 2 ?kg\b/g, ' 0.5kg ')
  let nameWeight = null
  const wm = s.match(WEIGHT_RE)
  if (wm) nameWeight = toGrams(wm[1], wm[2])
  // Every weight goes (a second one would otherwise be residue); the first counts.
  s = s.replace(new RegExp(WEIGHT_RE.source, 'g'), ' ')
  let count = null
  s = s.replace(/\b(\d+)\s*pack\b|\bpack of (\d+)\b/g, (_, a, b) => { count = Number(a || b); return ' ' })
  s = s.replace(/\btwin pack\b/g, () => { count = 2; return ' ' })
  s = s.replace(/\b\d+\s*x\s*\d+\b/g, ' ')            // Coles' "11x9", "7x5" trim specs
  s = s.replace(/\b\d+ \d+ pieces?\b/g, ' ')           // Woolworths' "4 - 6 Pieces"

  // A product whose name ends in "sauce" is the sauce ("Beef Stir Fry Sauce",
  // "... With Bourbon BBQ Sauce" ready meals), whatever meat it names.
  const isSauce = /\bsauce\s*$/.test(s.trim())

  // 2. Phrases.
  for (const [re, rep] of PHRASES) s = s.replace(re, rep)
  s = s.replace(/\b1 2\b/g, ' half ')                   // "1/2 Chicken" after punctuation went
  s = s.replace(/\b\d+(\.\d+)?\b/g, ' ')                // any number left is a count

  // 3. Classify. A word is looked up as written first, then singular — so a
  // lexicon entry that is itself plural ("lovely_legs", "gyros") is found.
  const known = (w) => SPECIES[w] || OUT_OF_SCOPE.has(w) || ATTRS.has(w) || CUT_WORDS.has(w) || FLAVOURS.has(w) || IGNORABLE.has(w)
  const words = [...new Set(s.split(/\s+/).filter((w) => w.length > 1)
    .map((w) => (!IRREGULAR[w] && known(w) ? w : singular(w))))]
  const species = new Set()
  const cut = new Set(), attrs = new Set(), flavours = new Set(), outOfScope = [], residual = []
  for (const w of words) {
    if (SPECIES[w]) { species.add(SPECIES[w]); if (w === 'bacon' || w === 'ham') cut.add(w); continue }
    if (OUT_OF_SCOPE.has(w)) { outOfScope.push(w); continue }
    if (ATTRS.has(w)) { attrs.add(w); continue }
    if (CUT_WORDS.has(w)) { cut.add(w); continue }
    if (FLAVOURS.has(w)) { flavours.add(w); continue }
    if (IGNORABLE.has(w)) continue
    residual.push(w)
  }

  // No species word: a breed that implies one, a single-species brand, the
  // retailer's own category, and — for sausages and burgers only — an explicit
  // `unspecified`, which can only match another unspecified line.
  if (!species.size) for (const [a, sp] of Object.entries(SPECIES_FROM_ATTR)) if (attrs.has(a)) species.add(sp)
  if (!species.size) for (const [f, sp] of Object.entries(SPECIES_FROM_FLAVOUR)) if (flavours.has(f)) species.add(sp)
  if (!species.size && SPECIES_FROM_BRAND[brand]) species.add(SPECIES_FROM_BRAND[brand])
  if (!species.size && [...cut].some((c) => CHICKEN_ONLY_CUTS.has(c))) species.add('chicken')
  if (!species.size) {
    const cat = `${ctx.retailerCategory || ''} ${ctx.subcategory || ''}`
    for (const [re, sp] of SPECIES_FROM_CATEGORY) if (re.test(cat)) { species.add(sp); break }
  }
  if (!species.size && [...cut].some((c) => UNSPECIFIED_OK.has(c))) species.add('unspecified')
  if (ctx.isOrganic) attrs.add('organic')
  // A brand that only makes one quality of product says so on every pack even
  // when the name does not ("Boneless Butterflied Chicken" by The Bare Bird is
  // free range). This is a fact about the product, not brand matching.
  for (const a of ATTRS_FROM_BRAND[brand] || []) attrs.add(a)
  if (/frozen|fzn/i.test(`${rawName} ${ctx.retailerCategory || ''} ${ctx.subcategory || ''}`)) attrs.add('frozen')
  // Both retailers file coated lines under a CRUMBED subcategory whether or not
  // the name says so ("Chicken Tenders" at both). Taking it from there keeps a
  // crumbed line from ever keying the same as a plain one.
  if (/crumb/i.test(ctx.subcategory || '')) flavours.add('crumbed')
  // Cooked, ready-to-heat ranges, whatever the name says: Coles files "Honey
  // Soy Wing Nibbles" (cooked) under Made Easy / Slow Cook, next to raw
  // nibbles with nearly the same name.
  // Ham and bacon are cured and ready to eat by nature, so for them the shelf
  // says nothing new (Coles files its leg ham under "Ready to Eat Protein").
  const cured = cut.has('ham') || cut.has('bacon')
  if (!cured && /made easy|ready to eat|cooked poultry/i.test(`${ctx.retailerCategory || ''} ${ctx.subcategory || ''}`)) flavours.add('slow_cooked')
  // Woolworths' deli smallgoods shelf holds cooked lines ("Primo Corned Beef
  // Silverside") beside the raw butcher's cuts of the same name. Ham and bacon
  // are smallgoods by nature, so for them the shelf says nothing new.
  // Only Woolworths' "SMALLGOODS MEAT" / "SMALLGOODS BULK" shelves: Coles' sap
  // subcategory "SMALLGOODS" holds raw Cleaver's sausages and meatballs. Smoked
  // bones and hocks there are raw too.
  if (/smallgoods (meat|bulk)/i.test(ctx.subcategory || '') && !cured && !cut.has('bone') && !cut.has('hock')) attrs.add('deli_cooked')

  // A sauce, or a slow-cooked dish, with no cut NAMED is a meal or a
  // condiment ("Thai Red Curry Sauce", "Slow Cooked Beef In Red Wine Sauce").
  // Decided before normalisation, which supplies default cuts and folds a lone
  // "sauce" into "marinated".
  if (isSauce) outOfScope.push('sauce')
  else if (!cut.size && (flavours.has('sauce') || flavours.has('slow_cooked'))) outOfScope.push(flavours.has('sauce') ? 'sauce' : 'slow_cooked')

  // 5. Normalise, species-aware.
  const sp = [...species].sort()
  const one = sp.length === 1 ? sp[0] : null
  normaliseCut(one, cut, attrs, flavours)

  const speciesKey = sp.join('+') || null
  const cutKey = [...cut].sort().join('-') || null

  let kind
  if (outOfScope.length) kind = 'out_of_scope'
  else if (!speciesKey || !cutKey || residual.length) kind = 'unparsed'
  else kind = flavours.size ? 'meat_prepared' : 'meat'

  // The item key groups one retailer's sizes of the same product. It is every
  // meaningful word, so an unparsed product still groups with its own sizes.
  const itemTokens = [speciesKey, ...[...cut].sort(), ...[...attrs].sort(), ...[...flavours].sort(), ...residual.sort(), ...outOfScope.sort()].filter(Boolean)

  return {
    species: speciesKey, cut: [...cut].sort(), cutKey, attrs: [...attrs].sort(), flavours: [...flavours].sort(),
    kind, residual, outOfScope,
    nameWeight, count,
    itemKey: itemTokens.join('|'),
    itemName: titleName(rawName, ctx.brand),
  }
}

// Words that say "this is prepared" without saying how. Next to a real flavour
// they add nothing ("Souvlaki Seasoning" = "Souvlaki", "Marinated Garlic
// Mussels" = "Garlic Mussels"). Woolworths' BBQ range puts "BBQ" in front of
// every marinated line ("Woolworths BBQ Chicken Wing Nibbles Honey Soy"), so
// bbq is generic too — but on its own ("BBQ Sausages", "Pork Ribs BBQ") it is
// the flavour.
const GENERIC_PREP = new Set(['marinated', 'marinade', 'seasoned', 'seasoning', 'rub', 'glaze', 'glazed', 'sauce', 'flavoured', 'lightly', 'bbq'])
const SAME_FLAVOUR = { peppered: 'pepper', peppercorn: 'pepper', feta: 'fetta', smoky: 'smokey', kiev: 'kyiv', parmi: 'parmigiana', parmigia: 'parmigiana' }

function normaliseFlavours(sp, flavours, attrs) {
  // "Plain Crumb" and a CRUMBED subcategory are one fact.
  if (flavours.delete('crumb')) flavours.add('crumbed')
  for (const [from, to] of Object.entries(SAME_FLAVOUR)) if (flavours.delete(from)) flavours.add(to)
  // Cooked meat (not seafood, where cooked/raw is an attribute) is the
  // slow-cooked ready-to-heat line: "Cooked Duck Breasts Peking Flavoured" =
  // "Peking Duck Breasts Slow Cooked". Confit is slow-cooked by definition.
  const seafood = sp && (FISH.has(sp) || GRADED_SEAFOOD.has(sp) || ['mussel', 'squid', 'octopus', 'crab', 'bug', 'lobster', 'marinara'].includes(sp))
  if (!seafood && attrs.has('cooked')) flavours.add('slow_cooked')
  if (flavours.has('confit')) flavours.add('slow_cooked')
  const specific = [...flavours].filter((f) => !GENERIC_PREP.has(f) && f !== 'crumbed' && f !== 'slow_cooked')
  if (specific.length) for (const g of GENERIC_PREP) flavours.delete(g)
  else if ([...flavours].some((f) => GENERIC_PREP.has(f) && f !== 'bbq')) {
    const bbq = flavours.has('bbq')
    for (const g of GENERIC_PREP) flavours.delete(g)
    flavours.add('marinated')
    if (bbq) flavours.add('bbq')
  }
}

function normaliseCut(sp, cut, attrs, flavours) {
  normaliseFlavours(sp, flavours, attrs)
  // Seafood state words are attributes; for meat they mean nothing ("Chicken
  // Portions Raw").
  const fish = sp && FISH.has(sp)
  if (sp && !GRADED_SEAFOOD.has(sp)) {
    for (const g of ['x_small', 'small', 'medium', 'large', 'x_large']) attrs.delete(g)
    if (!fish && !['mussel', 'squid', 'octopus', 'crab', 'bug', 'lobster', 'marinara'].includes(sp)) {
      attrs.delete('raw'); attrs.delete('cooked'); attrs.delete('peeled')
    }
  }
  // Grades for anything other than mince are not a grade.
  const isMince = cut.has('mince')
  if (isMince) {
    // Mince fat band, one canonical value. Unstated = regular (Woolworths'
    // plain "Beef Mince" sits beside "Lean" and "Heart Smart Extra Lean";
    // Coles names its regular "Regular"/"3 Star"). Coles/Cleaver's "Premium"
    // is the 4-star band. Kangaroo, chicken and turkey mince carry no band.
    const band = attrs.has('extra_lean') ? 'extra_lean' : (attrs.has('lean') || attrs.has('premium')) ? 'lean' : 'regular'
    for (const a of ['extra_lean', 'lean', 'premium', 'regular']) attrs.delete(a)
    if (['beef', 'pork', 'lamb', 'veal'].includes(sp) || (sp == null)) attrs.add(`grade_${band}`)
    else if (band !== 'regular') attrs.add(`grade_${band}`)
  } else {
    attrs.delete('regular'); attrs.delete('premium')
  }

  // A steak cut does not need the word steak.
  if ([...cut].some((c) => STEAK_CUTS.has(c))) cut.delete('steak')
  // A thin-sliced steak cut is the thin-cut steak (Woolworths "Scotch Fillet
  // Thin Slice" = Coles "Scotch Fillet Thin Cut", both $52.50/kg).
  if (attrs.has('thin_cut') && [...cut].some((c) => STEAK_CUTS.has(c))) cut.delete('slice')
  if (cut.has('scotch')) cut.delete('fillet')

  if (sp === 'chicken') {
    // "Chicken Breast" with nothing else = breast fillet; same for thigh.
    const breastQual = ['steak', 'diced', 'strip', 'schnitzel', 'supreme', 'mince', 'double', 'portion', 'roast', 'tender', 'kyiv', 'burger', 'nugget', 'kebab']
    if (cut.has('breast') && !breastQual.some((q) => cut.has(q))) cut.add('fillet')
    if (cut.has('thigh') && !['cutlet', 'roast', 'diced', 'burger', 'schnitzel', 'kebab'].some((q) => cut.has(q))) cut.add('fillet')
    // A burger or kebab "of thigh fillet" is a thigh burger: the fillet is
    // what it is made from, not what it is.
    if (['burger', 'kebab'].some((q) => cut.has(q))) cut.delete('fillet')
    // Fillets are skinless and boneless unless they say otherwise.
    if (cut.has('fillet')) { attrs.delete('skinless'); attrs.delete('boneless') }
    // "Little Roast Chicken", "Family Roast Whole Chicken": a whole bird.
    if (cut.has('roast') && cut.size === 1) { cut.delete('roast'); cut.add('whole') }
    if (cut.has('whole') && cut.has('roast')) cut.delete('roast')
    // Whole boneless = butterflied boneless (Coles names it one way, Woolworths
    // and The Bare Bird the other).
    if (attrs.has('boneless') && (cut.has('whole') || cut.has('butterflied'))) { cut.add('whole'); cut.add('butterflied') }
    if (cut.has('wing_nibble')) cut.delete('wing')
    // Tenders are breast meat: "Crumbed Chicken Breast Tenders" = "Chicken Tenders".
    if (cut.has('tender')) cut.delete('breast')
  }
  if (sp === 'turkey' && cut.has('breast') && cut.has('portion')) cut.delete('portion')
  if (sp === 'pork') {
    // Woolworths "Pork Rashers" are belly rashers; Coles calls them slices.
    if (cut.has('rasher') && !cut.has('bacon')) { cut.delete('rasher'); cut.add('belly'); cut.add('slice') }
    if (cut.has('hock')) cut.delete('leg')
    // Pork medallions are cut from the loin: "Pork Loin Medallions" = "Pork Medallion".
    if (cut.has('medallion')) cut.delete('loin')
  }
  if (sp === 'pork' && cut.has('bacon')) cut.delete('rasher')
  if (sp === 'beef' && cut.has('corned')) cut.add('silverside')
  // "Diced Steak" (Graze) is diced beef (Macro "Diced Beef", both $26/kg).
  if (sp === 'beef' && cut.has('diced')) cut.delete('steak')
  if (sp === 'beef' && cut.has('fillet') && cut.size <= 2 && !cut.has('eye_fillet')) { cut.delete('fillet'); cut.add('eye_fillet'); cut.delete('steak') }
  if (sp === 'lamb' && cut.has('fry')) { cut.delete('fry'); cut.add('liver') }
  if (sp === 'kangaroo' && cut.has('fillet')) cut.delete('steak')

  if (sp && FISH.has(sp)) {
    // A fish fillet, portion or steak is the same thing sold under three names.
    for (const c of ['fillet', 'steak']) if (cut.delete(c)) cut.add('portion')
    // Smoked fish IS the product; "sliced" is how all of it comes.
    if (['smoked', 'hot_smoked', 'double_smoked', 'triple_smoked', 'gravlax'].some((c) => cut.has(c))) cut.delete('slice')
    if (!cut.size) cut.add('portion')
  }
  if (sp === 'prawn') {
    // Three shapes: whole (head and shell on), peeled, and cutlets (peeled,
    // butterflied, tail on). "Prawn meat" and anything stating a tail are
    // peeled; a peeled prawn is tail-off unless it says tail-on.
    if (cut.delete('meat')) attrs.add('peeled')
    if (attrs.has('tail_on') || attrs.has('tail_off')) attrs.add('peeled')
    if (cut.has('cutlet')) attrs.delete('tail_on')
    else if (attrs.has('peeled')) { cut.delete('whole'); cut.add('peeled') }
    else if (!cut.size) cut.add('whole')
    attrs.delete('peeled'); attrs.delete('tail_off')
  }
  if (['mussel', 'oyster', 'scallop', 'squid', 'octopus', 'crab', 'bug', 'lobster', 'marinara', 'surimi', 'herring'].includes(sp) && !cut.size) cut.add('whole')
  if (sp === 'mussel' && cut.has('meat')) attrs.delete('cooked')
  // "Blue Swimmer" is the only crab either retailer sells as crab meat.
  if (sp === 'crab') attrs.delete('blue')

  // Defaults: what a listing that says nothing is, so that silence on one side
  // and the default stated on the other agree.
  // Certified organic chicken is free range; organic beef and lamb are grass fed.
  if (attrs.has('organic') && sp === 'chicken') attrs.add('free_range')
  if (attrs.has('organic') && (sp === 'beef' || sp === 'lamb')) attrs.add('grass_fed')
  // A lamb leg or shoulder roast is on the bone unless it says boneless; a
  // "whole leg" is the default leg.
  if (sp === 'lamb' && (cut.has('leg') || cut.has('shoulder'))) { attrs.delete('bone_in'); cut.delete('whole') }
  // A lamb shoulder sold whole is the roast: Woolworths "Boneless Lamb Shoulder
  // Rolled" = Coles "Lamb Boneless Shoulder Roast" (both $23/kg).
  if (sp === 'lamb' && cut.size === 1 && cut.has('shoulder')) cut.add('roast')
  // A chicken thigh cutlet is on the bone by definition.
  if (sp === 'chicken' && cut.has('cutlet')) attrs.delete('bone_in')
  // Pork belly is sold boneless.
  if (sp === 'pork' && cut.has('belly')) attrs.delete('boneless')
  // Diced fish has no skin.
  if (fish && cut.has('diced')) attrs.delete('skinless')
  // Supermarket sausages are thin unless they say thick.
  if (cut.has('sausage') || cut.has('chipolata')) attrs.delete('thin')
  // "Heart Smart" / "lean" on a cut that is lean anyway is a label, not a
  // different product (Woolworths Pork Fillet Heart Smart). It only grades mince.
  // Stir-fry strips are lean too (Macro "Organic Extra Lean Stir Fry" = Coles
  // "Organic Grass-fed Beef Stirfry", both $34.44/kg).
  if (!isMince && ['fillet', 'eye_fillet', 'tenderloin', 'backstrap', 'medallion', 'schnitzel', 'stir_fry'].some((c) => cut.has(c))) {
    attrs.delete('lean'); attrs.delete('extra_lean')
  }

  // Schnitzel, kyiv, nugget, popcorn are coated by definition.
  for (const c of ['schnitzel', 'kyiv', 'nugget', 'popcorn']) if (cut.has(c)) { flavours.delete('crumb'); flavours.delete('crumbed') }
}

function titleName(raw, brand) {
  let n = String(raw || '').replace(/\s+/g, ' ').trim()
  if (brand && n.toLowerCase().startsWith(brand.toLowerCase() + ' ')) n = n.slice(brand.length + 1)
  return n.replace(/\s*\|\s*/g, ' ').replace(/\b(\d+(?:\.\d+)?)\s*(kg|g)\b/gi, '').replace(/\s+/g, ' ').trim()
}

/** "approx. 1.6kg", "1.1–1.7kg (priced at 1.7kg)", "per kg at the counter", "500g". */
export function meatSizeLabel(packageSizeRaw, soldBy) {
  const p = parsePackSize(packageSizeRaw)
  if (p.mode === 'per-kg') return 'per kg · service counter'
  if (p.rangeG) return `${fmtG(p.rangeG[0])}–${fmtG(p.rangeG[1])} · priced at ${fmtG(p.rangeG[1])}`
  if (p.mode === 'variable-pack') return `approx. ${fmtG(p.weightG)}`
  if (p.mode === 'fixed') return fmtG(p.weightG) + (p.count ? ` · ${p.count} pack` : '')
  return String(packageSizeRaw || soldBy || '')
}
