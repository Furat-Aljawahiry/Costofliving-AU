// Vocabulary for snacks & confectionery: chips, biscuits, crackers, chocolate,
// lollies, gum, muesli bars, nuts and dried fruit.
//
// The rule this serves is the opposite of meat's (CROSS_RETAILER_MATCHING.md
// §3.4). Two listings are the same product only when brand, product line,
// flavour, form and pack size all agree — the user's ruling, 22 Oct. Coles
// publishes no barcode, so "agree" is decided from the name.
//
// Every entry is a ruling. Overturn one here, never in names.js, and re-run
// `node server/scripts/snacks-report.mjs` (docs/SNACKS_DATA_TODO.md).
//
// The direction of failure is deliberate: a word this file does not know is
// KEPT in the key, so an unknown word can only stop a match, never make one.
// Only the IGNORABLE list removes words, and it holds packaging and marketing
// words alone — never a flavour or a variant.

// Own-label ranges. A Coles chip is not a Woolworths chip, so these brands are
// keyed per retailer (`house-coles`) and only ever find their own shelf.
export const HOUSE_BRANDS = {
  coles: ['coles', 'coles simply', 'coles finest', 'coles kitchen', 'coles nature s kitchen', 'coles natures kitchen', 'coles organic', 'coles i m free from', 'coles im free from', 'coles australian', 'coles bakery'],
  woolworths: ['woolworths', 'macro', 'woolworths gold', 'woolworths free from', 'essentials', 'woolworths essentials', 'woolworths select', 'woolworths finest'],
}

// Brand spellings, to one canonical form. Keys and values are normalised
// (lowercase, apostrophes dropped, "&" and "and" removed, no spaces).
export const BRAND_ALIASES = {
  sourpatch: 'sourpatchkids',
  macytailor: 'macytailor',
  kitkat: 'kitkat',
  nestlekitkat: 'kitkat',
  djanda: 'dja',
  thenaturalconfectionery: 'thenaturalconfectioneryco',
  naturalconfectioneryco: 'thenaturalconfectioneryco',
}

// A brand column that names a range rather than just the maker: the extra
// words belong to the product name. Coles files "Lindt Lindor" as a brand;
// Woolworths files the same block under "Lindt" with "Lindor" in the name.
export const BRAND_WITH_LINE = {
  lindtlindor: { brand: 'lindt', line: ['lindor'] },
  lindtexcellence: { brand: 'lindt', line: ['excellence'] },
  cadburydairymilk: { brand: 'cadbury', line: ['dairy', 'milk'] },
}

// A parent company in the brand column, with the real brand leading the
// name. Coles lists "Kit Kat Chunky Strawberry Bar" under brand "Nestle";
// Woolworths lists the same bar under "KitKat". When the brand column is one
// of these AND the name opens with a sub-brand, the sub-brand is the brand.
export const PARENT_BRANDS = ['nestle', 'mars', 'marswrigley', 'mondelez', 'ferrero', 'pepsico', 'mondelezinternational']
export const SUB_BRANDS = {
  'kit kat': 'kitkat', kitkat: 'kitkat', aero: 'aero', milkybar: 'milkybar', smarties: 'smarties',
  'killer python': 'killerpython', 'peppermint crisp': 'peppermintcrisp', 'violet crumble': 'violetcrumble',
  'golden rough': 'goldenrough', 'scorched almonds': 'scorchedalmonds', allens: 'allens', 'allen s': 'allens',
  snickers: 'snickers', 'm m s': 'mms', mms: 'mms', mars: 'mars', maltesers: 'maltesers', twix: 'twix',
  milo: 'milo', kinder: 'kinder', 'ferrero rocher': 'ferrerorocher', nutella: 'nutella',
}

// Multi-word spellings to one token, applied to the name after normalising
// ("&" has already become "and"). Order matters: longer first.
export const PHRASES = [
  [/\bsalt and vinegar\b/g, 'salt_vinegar'],
  [/\bvinegar and sea salt\b/g, 'salt_vinegar'],
  [/\bsea salt and vinegar\b/g, 'salt_vinegar'],
  [/\bsour cream and onion\b/g, 'sour_cream_onion'],
  [/\bsour cream and chives?\b/g, 'sour_cream_chives'],
  [/\bcheese and onion\b/g, 'cheese_onion'],
  [/\bcheese and bacon\b/g, 'cheese_bacon'],
  [/\bhoney soy chicken\b/g, 'honey_soy_chicken'],
  [/\bsweet chill?i\b/g, 'sweet_chilli'],
  [/\bthai sweet chill?i\b/g, 'thai_sweet_chilli'],
  [/\bsalt and pepper\b/g, 'salt_pepper'],
  [/\bfruit and nut\b/g, 'fruit_nut'],
  [/\bcookies and cream\b/g, 'cookies_cream'],
  [/\bcookies n cream\b/g, 'cookies_cream'],
  [/\bpeanut butter\b/g, 'peanut_butter'],
  [/\bsalted caramel\b/g, 'salted_caramel'],
  [/\bsea salt\b/g, 'sea_salt'],
  [/\bcheese supreme\b/g, 'cheese_supreme'],
  [/\bsupreme cheese\b/g, 'cheese_supreme'],
  [/\bcrinkle cut\b/g, 'crinkle_cut'],
  [/\bdairy milk\b/g, 'dairy_milk'],
  [/\btim tam\b/g, 'tim_tam'],
  [/\bhot chips\b/g, 'hot_chips_flavour'],
  [/\bfun size\b/g, 'fun_size'],
  [/\bgluten free\b/g, 'gluten_free'],
  [/\bsugar free\b/g, 'sugar_free'],
  [/\bno added sugar\b/g, 'no_added_sugar'],
  [/\bchoc\b/g, 'chocolate'],
  [/\bbbq\b/g, 'barbecue'],
  [/\bbar b q\b/g, 'barbecue'],
  [/\bbarbeque\b/g, 'barbecue'],
  [/\bcovered\b/g, 'coated'],
  [/\bcheddar cheese\b/g, 'cheddar'],
  [/\bcrinkle\b/g, 'crinkle_cut'],
  [/\bassorted\b/g, 'variety'],
  [/\bvarieties\b/g, 'variety'],
  [/\bgrain waves\b/g, 'grainwaves'],
  [/\bmini bars\b/g, 'mini'],
  [/\bready to eat\b/g, ''],
  [/\bsnack and share\b/g, ''],
  // The 4-finger IS the standard KitKat bar (Chunky is the one-finger);
  // Coles says "4 Finger Bar 42g", Woolworths "Chocolate Bar 42g".
  // "2 finger" still counts.
  [/\b4 finger\b/g, ''],
  [/\blimited edition\b/g, ''],
  [/\blunch box\b/g, ''],
  [/\bchilli\b/g, 'chilli'],
  [/\bchili\b/g, 'chilli'],
  [/\bflavou?red\b/g, ''],
  [/\bflavou?rs?\b/g, ''],
]

// The FORM of the product. Two listings of one brand, line and size can still
// be different things (Smith's makes chips AND crackers), so the form is part
// of the key. The name's own form word wins; a name with none takes its
// retailer's subcategory (FORM_FROM_SUBCATEGORY). Form words are then removed
// from the name so "Potato Chips" and "Chips" read the same.
export const FORM_WORDS = {
  chip: ['chips', 'chip', 'crisps', 'crisp', 'potato chips', 'potato chip', 'potato crisps'],
  cracker: ['cracker biscuits', 'cracker biscuit', 'crackers', 'cracker', 'crispbreads', 'crispbread'],
  biscuit: ['biscuits', 'biscuit', 'cookies', 'cookie'],
  lolly: ['lollies', 'lolly', 'lollipops', 'lollipop', 'confectionery', 'candy', 'sweets'],
  popcorn: ['popcorn'],
  muesli_bar: ['muesli bars', 'muesli bar'],
  // Salsa and dips sit on the chip shelf at both retailers; a jar of salsa
  // is not a bag of chips.
  dip: ['salsa dip', 'salsa', 'dip'],
}

// Retailer subcategory -> form, for a name that states none. Matched on the
// normalised subcategory text; first hit wins.
export const FORM_FROM_SUBCATEGORY = [
  // Before the generic `confec` rule: Woolworths files gum and mints under
  // "CONFEC ON THE GO - REFRESH & LOZENGE".
  [/\brefresh\b|\blozenges?\b|\bgum\b|\bmints?\b/, 'refresh'],
  [/\bpopcorn\b/, 'popcorn'],
  [/\bchips?\b/, 'chip'],
  [/\bcrackers?\b|\bcrispbread|\bbiscuits savoury\b|\brice corn snacks\b/, 'cracker'],
  [/\bbiscuits?\b|\bcookies\b/, 'biscuit'],
  [/\bmuesli\b/, 'muesli_bar'],
  [/\blollies\b|\blicorice\b|\bconfec sharing sugar\b/, 'lolly'],
  [/\bchocolate\b|\bconfec\b|\bseasonal\b/, 'confectionery'],
  [/\bnuts?\b|\bdried fruit\b|\btrail\b/, 'nuts'],
]

// Packaging and marketing words. They describe the pack, which the weight and
// the count already state, not the product. Each is a ruling.
export const IGNORABLE = new Set([
  'pack', 'packs', 'packet', 'bag', 'bags', 'box', 'tub', 'tube', 'canister', 'pouch', 'carton',
  'share', 'sharing', 'sharepack', 'sharebag', 'value', 'family', 'party', 'size', 'large', 'jumbo',
  'lunchbox', 'school', 'multipack', 'multi', 'snack', 'snacks', 'snacking', 'new',
  'piece', 'pieces', 'pcs', 'pc', 'block', 'blocks', 'bar', 'bars', 'the', 'of', 'with', 'in', 'a', 'and',
  'tin',
])

// The unflavoured product. "Shapes Original Barbecue" (Coles) is "Shapes
// Barbecue" (Woolworths); Arnott's "Plain Biscuits Marie" is "Marie Biscuits".
// A listing that names no flavour IS the original.
export const DEFAULT_WORDS = new Set(['original', 'plain'])

// Words that say nothing in one form. Chocolate is what confectionery is made
// of; milk chocolate is its default ("Cadbury Crunchie Milk Chocolate Bar" =
// "Crunchie Chocolate Bar" = Coles' "Crunchie"), and "Dairy Milk" is Cadbury's
// default milk chocolate. Dark, white, Old Gold and every flavour still count.
// Potato and corn say nothing on a chip once the brand is known (Doritos are
// corn chips, Smith's potato chips).
export const REDUNDANT_IN_FORM = {
  confectionery: new Set(['chocolate', 'milk', 'dairy_milk']),
  chip: new Set(['potato', 'corn']),
}

// Packaging words that are a PRODUCT in one form. Cadbury "Dairy Milk Snack"
// is its own block (mixed centres), not "Dairy Milk" — the 22 Oct review
// caught the two 180g blocks paired. On a chip or a muesli bar "snack" is
// still packaging ("Twisties Cheese Snacks" = "Twisties Cheese").
export const KEPT_IN_FORM = { confectionery: new Set(['snack']) }

// Words that describe the pieces of a multipack rather than the product:
// "Snickers Fun Size Bars 12 pack" is Coles' "Snickers Party Share Bag 12
// Pieces"; "Freddo Mini Bars 12 pack" is "Freddo Sharepack 12 Pack".
export const REDUNDANT_IN_MULTIPACK = new Set(['mini', 'fun_size'])

// A word made redundant by a more specific one.
export const REDUNDANT_WITH = { caramello: ['caramel'] }

// Extra words of a canonical brand, for a brand whose columns disagree ("Sour
// Patch" at Coles, "Sour Patch Kids" at Woolworths). A brand's own words are
// never product words (names.js).
export const BRAND_WORDS = { sourpatchkids: ['sour', 'patch', 'kids', 'kid'] }
// Deliberately NOT ignorable, because each names a real variant somewhere on
// these shelves: medium / mild / hot (salsa heat), deluxe (Tim Tam Deluxe),
// classic, original, mini, mega (Natural Confectionery Co. Mega Snakes),
// australian (an origin claim on dried fruit), light, thins.
