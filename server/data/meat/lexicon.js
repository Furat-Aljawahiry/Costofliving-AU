// The meat, poultry & seafood vocabulary. Every word in a product name must be
// one of these, or the product gets no match key (names.js, the residual rule).
//
// Built by reading every name in the 18 Oct discovery crawl — 555 Coles and 606
// Woolworths rows (data/MEAT_DISCOVERY.md). Like the produce lexicon this is
// curated judgement that will be wrong in places; each non-obvious ruling is
// written down in docs/MEAT_DATA_TODO.md, and a ruling is changed here, not
// patched around in the matcher.
//
// BRAND IS IGNORED. Decided with the user on 18 Oct: Lilydale, Steggles and
// the house brand are the same product if species, cut and attributes agree.
// Brand words are stripped from the name before anything else looks at it.

// ---------------------------------------------------------------- phrases
//
// Applied in order to the lower-cased, punctuation-free name, BEFORE it is
// split into words. A phrase either becomes one token (`free range` ->
// `free_range`) or disappears (`rspca approved`). Longest and most specific
// first: `heart smart` must win before `smart` is seen as an unknown word.
export const PHRASES = [
  // Certifications and claims that both retailers' house lines carry. Recorded
  // nowhere; not part of the key. (RSPCA: both house chicken ranges.)
  [/\brspca approved\b|\brspca\b/g, ' '],
  [/\bno added hormones?\b|\bhormone free\b/g, ' '],
  [/\bfrom the deli\b/g, ' deli '],
  [/\bsouth american\b|\bnew zealand\b|\bmoreton bay\b|\bmargaret river\b/g, ' '],
  [/\bhot dogs?\b/g, ' hotdog '],
  [/\boff the bone\b/g, ' '],
  [/\ba l orange\b/g, ' orange '],
  [/\bspring onion\b/g, ' onion '],
  [/\bsalt (and )?pepper\b/g, ' salt_pepper '],
  // Bertocchi: "short rindless" is shortcut, "long rindless" is middle bacon.
  [/\bshort rindless\b/g, ' shortcut rindless '],
  [/\blong rindless\b/g, ' middle rindless '],
  [/\bsalt ?water\b/g, ' '],
  [/\bwild caught\b/g, ' wild '],
  [/\bto go\b/g, ' '],
  // Talley's "Marinated Plain" mussels are Coles' "Mussels Natural" (the same
  // 375g pack; its garlic sibling already matched).
  [/\bmarinated (plain|natural)\b/g, ' '],
  // Regal sells "Manuka Wood Smoked" at Coles and "Manuka Cold Smoked" at
  // Woolworths. The wood is the flavour.
  [/\b(manuka|beech) wood\b/g, ' $1 '],
  [/\bmountain ash\b/g, ' mountain_ash '],
  [/\btenderlion\b/g, ' tenderloin '],     // sic, Coles 18 Oct
  [/\bbutterfly\b/g, ' butterflied '],
  [/\bpops\b/g, ' popcorn '],              // "Southern Fried Chicken Pops" = popcorn chicken
  [/\bkafta fingers\b/g, ' kofta '],
  [/\blimited edition\b|\bchef s cut\b|\bchefs? cut\b|\bready to roast\b|\bready to cook\b|\beasy carve\b|\bmade easy\b|\bfamily classics\b|\bfamily favourites\b|\bworld flavours\b/g, ' '],
  [/\bslow cooked\b/g, ' slow_cooked '],
  [/\bslow cook\b/g, ' '],
  // "Thinly sliced" is both how thick and what shape: keep the slice.
  [/\bthinly sliced\b|\bthin slic(ed|e)\b/g, ' thin_cut slice '],
  [/\bquick cook\b|\bthin cut\b/g, ' thin_cut '],
  [/\bthick cut\b/g, ' thick_cut '],
  [/\bfree range\b/g, ' free_range '],
  [/\bbarn bred\b/g, ' barn_bred '],
  [/\bgrass ?fed\b|\bgrassfed\b/g, ' grass_fed '],
  [/\bgraze\b/g, ' grass_fed '],        // Coles' grass-fed line; every Graze name also says so
  [/\bgrain fed\b/g, ' grain_fed '],
  [/\bheart smart\b|\bextra lean\b|\b5 star\b/g, ' extra_lean '],
  [/\b4 star\b/g, ' lean '],
  [/\b3 star\b/g, ' regular '],
  [/\bskin on\b/g, ' skin_on '],
  [/\bskin off\b|\bskinless\b/g, ' skinless '],
  [/\bon the bone\b|\bbone in\b/g, ' bone_in '],
  [/\brib eye bone\b/g, ' scotch bone_in '],
  [/\btail on\b/g, ' tail_on '],
  [/\btail off\b/g, ' tail_off '],
  [/\broe off\b/g, ' roe_off '],
  [/\bstir ?fry\b|\bstirfry\b|\bstifry\b/g, ' stir_fry '],
  [/\bwing nibbles?\b|\bnibbles\b/g, ' wing_nibble '],
  [/\bwing tips?\b/g, ' wing_tip '],
  [/\bv wings?\b/g, ' v_wing '],
  [/\bthree joint\b/g, ' '],
  [/\blovely legs\b/g, ' lovely_legs '],
  [/\bleg fillets?\b/g, ' thigh fillet '],   // Woolworths' "Chicken Leg Fillet Diced" is thigh meat
  [/\bwing pieces\b/g, ' wing '],
  [/\b\d+ cut pieces\b|\bmixed pieces\b|\bmixed portions\b|\broasting portions\b/g, ' portion '],
  [/\brib eye\b|\bscotch fillet\b/g, ' scotch '],
  [/\beye fillet\b/g, ' eye_fillet '],
  [/\bnew york strip\b|\bsirloin\b/g, ' porterhouse '],
  [/\bt ?bone\b/g, ' t_bone '],
  [/\boyster blade\b/g, ' oyster_blade '],
  [/\bflat iron\b|\biron sharing\b/g, ' flat_iron '],
  [/\bpicanha\b|\brump cap\b/g, ' rump cap '],
  // Rib fingers are the boneless meat between the ribs; short ribs are on the bone.
  [/\bshort rib fingers\b/g, ' short_rib boneless '],
  [/\bshort ribs?\b/g, ' short_rib '],
  [/\bmarrow bones\b/g, ' marrow bone '],
  [/\bcountry style\b/g, ' country_style '],
  [/\bspare ribs?\b/g, ' spare_rib '],
  [/\bgravy beef\b/g, ' shin '],
  [/\bsoup bones\b|\bmarrow bones\b|\bmeat bones\b/g, ' bone '],
  [/\bsausage mince\b/g, ' sausage_mince '],
  [/\bkanga bangas?\b|\bbangas?\b/g, ' sausage '],
  [/\bquarter pound\b/g, ' quarter_pound '],
  // A tomahawk is a rib eye on a long bone (first seen in the 18 Oct Lambda run).
  [/\btomahawk\b/g, ' scotch bone_in tomahawk_bone '],
  [/\bshort cut\b|\bshortcut\b/g, ' shortcut '],
  [/\bpan ?sized?\b/g, ' '],
  [/\bcooked (and|&)? ?smoked\b|\bhot smoked\b/g, ' hot_smoked '],
  [/\bcold smoked\b/g, ' smoked '],
  [/\bdouble smoked\b/g, ' double_smoked '],
  [/\btriple smoked\b/g, ' triple_smoked '],
  [/\bsea sticks\b/g, ' surimi '],
  [/\bmarinara mix\b|\bmarinara seafood mix\b|\bseafood marinara mix\b/g, ' marinara '],
  [/\bprawn cutlets\b/g, ' prawn cutlet '],
  [/\bgluten free\b/g, ' gluten_free '],
  [/\bhigh protein\b/g, ' high_protein '],
  [/\bsalt reduced\b/g, ' salt_reduced '],
  [/\bmoisture infused\b/g, ' moisture_infused '],
  [/\bextra trim\b/g, ' extra_trim '],
  [/\bsouthern (fried|style)\b/g, ' southern_fried '],
  [/\bchar siu\b/g, ' char_siu '],
  [/\bperi peri\b/g, ' peri_peri '],
  [/\bcaf ?e de paris\b/g, ' cafe_de_paris '],
  [/\bsweet chilli\b/g, ' sweet_chilli '],
  // norm() has already turned "&" into a space, so "Mustard & Dill" arrives as
  // "mustard dill": the "and" is optional, never "&" (review, 22 Oct).
  [/\bhoney soy\b|\bhoney (and )?soy\b/g, ' honey_soy '],
  [/\bsoy garlic\b/g, ' soy_garlic '],
  [/\bgarlic (and )?herbs?\b|\bherbs? (and )?garlic\b/g, ' garlic_herb '],
  [/\blemon (and )?herbs?\b/g, ' lemon_herb '],
  [/\blemon (and )?garlic\b/g, ' lemon_garlic '],
  [/\bmustard (and )?dill\b/g, ' mustard_dill '],
  [/\bhoney (and )?mint\b/g, ' honey_mint '],
  [/\bhoney (and )?rosemary\b|\bhoney rosemary\b/g, ' honey_rosemary '],
  [/\brosemary (and )?garlic\b/g, ' rosemary_garlic '],
  [/\brosemary (and )?mint\b/g, ' rosemary_mint '],
  [/\bcracked (black )?pepper(corn)?\b|\bblack pepper\b/g, ' pepper '],
  [/\bsmokey bbq\b|\bsmoky bbq\b/g, ' smokey bbq '],
  [/\bx large\b|\bextra large\b|\bx-large\b|\bxl\b/g, ' x_large '],
  [/\bx small\b|\bextra small\b/g, ' x_small '],
  [/\bblack tiger\b/g, ' tiger '],
  [/\bking salmon\b/g, ' king salmon '],
]

// ---------------------------------------------------------------- species

// Word -> species. A name naming two species is a mix (`beef+pork` mince) and
// gets a combined species, so it can only ever match the same mix.
export const SPECIES = {
  chicken: 'chicken', beef: 'beef', veal: 'veal', lamb: 'lamb', pork: 'pork',
  turkey: 'turkey', duck: 'duck', kangaroo: 'kangaroo', roo: 'kangaroo', quail: 'quail',
  bacon: 'pork', ham: 'pork',
  salmon: 'salmon', trout: 'trout', steelhead: 'trout', prawn: 'prawn', barramundi: 'barramundi',
  basa: 'basa', hoki: 'hoki', flathead: 'flathead', snapper: 'snapper', whiting: 'whiting',
  cod: 'cod', shark: 'shark', tuna: 'tuna', kingfish: 'kingfish', mussel: 'mussel',
  oyster: 'oyster', scallop: 'scallop', squid: 'squid', calamari: 'squid', octopus: 'octopus',
  crab: 'crab', bug: 'bug', lobster: 'lobster', marinara: 'marinara', herring: 'herring',
  surimi: 'surimi',
}

// A breed that names its species: "Wagyu Burger 2 Pack" is beef.
export const SPECIES_FROM_ATTR = { wagyu: 'beef', angus: 'beef' }

// A sausage style that names its species: Cumberland is a pork sausage
// (British Sausage Co. "Cumberland Sausages" at Coles = Woolworths' "Classic
// Cumberland Pork Sausages").
export const SPECIES_FROM_FLAVOUR = { cumberland: 'pork' }

// Brands that only sell one species, for names that never say it
// ("The Bare Bird Free Range Boneless Butterflied").
// Cuts only a chicken has ("Honey Soy Wing Nibbles").
export const CHICKEN_ONLY_CUTS = new Set(['wing_nibble', 'drumstick', 'maryland', 'lovely_legs', 'wing_tip', 'v_wing', 'drumette'])

// Brands that sell only one quality, keyed by the normalised brand column.
export const ATTRS_FROM_BRAND = {
  'the bare bird': ['free_range'], lilydale: ['free_range'],
  'inglewood farms': ['organic', 'free_range'], inglewood: ['organic', 'free_range'],
  regal: ['king'],   // Regal (NZ King Salmon Co.) sells only king salmon
  'cleaver s organic': ['organic'], 'cleavers organic': ['organic'], 'cleaver s': ['organic'], cleavers: ['organic'],
}

export const SPECIES_FROM_BRAND = { 'the bare bird': 'chicken', lilydale: 'chicken', 'k roo': 'kangaroo', 'luv a duck': 'duck' }

// Sausages, burgers and the like are often sold with no species in the name
// ("BBQ Sausages", "Country Style Rissoles"). They get species `unspecified`,
// which can only ever match another unspecified line — never beef or pork.
export const UNSPECIFIED_OK = new Set(['sausage', 'chipolata', 'sausage_mince', 'burger', 'rissole', 'meatball', 'kofta'])

export const FISH = new Set(['salmon', 'trout', 'barramundi', 'basa', 'hoki', 'flathead', 'snapper', 'whiting', 'cod', 'shark', 'tuna', 'kingfish', 'herring'])
export const GRADED_SEAFOOD = new Set(['prawn', 'oyster', 'scallop'])

// When the name carries no species word ("Diced Casserole", "Shoulder
// Souvlaki"), the retailer's own category may: Coles' category_name and
// Woolworths' subcategory_name are both reliable at species level.
export const SPECIES_FROM_CATEGORY = [
  [/beef|veal/i, 'beef'], [/lamb/i, 'lamb'], [/pork/i, 'pork'],
  [/poultry|chicken/i, 'chicken'], [/turkey/i, 'turkey'], [/kangaroo/i, 'kangaroo'],
]

// ---------------------------------------------------------------- cut words

// What part of the animal, and how it is cut. The key's cut is the SET of these
// in the name, so "Diced Chicken Breast" and "Chicken Breast Diced" agree.
export const CUT_WORDS = new Set([
  // poultry
  'breast', 'thigh', 'fillet', 'cutlet', 'drumstick', 'drumette', 'maryland', 'supreme', 'wing',
  'wing_nibble', 'wing_tip', 'v_wing', 'lovely_legs', 'tenderloin', 'tender', 'whole', 'butterflied',
  'portion', 'liver', 'giblet', 'heart', 'neck', 'kidney', 'fry', 'splits', 'half', 'leg', 'double',
  // red meat
  'mince', 'diced', 'stir_fry', 'strip', 'slice', 'steak', 'roast', 'rump', 'cap', 'porterhouse',
  'scotch', 'eye_fillet', 't_bone', 'sizzle', 'chuck', 'oyster_blade', 'blade', 'brisket', 'silverside',
  'corned', 'topside', 'rib', 'short_rib', 'spare_rib', 'riblet', 'shin', 'bone', 'cheek', 'shank',
  'shoulder', 'forequarter', 'loin', 'chop', 'rack', 'backstrap', 'medallion', 'belly', 'hock', 'knuckle',
  'flat_iron', 'sandwich', 'offcut', 'rasher', 'marrow',
  // smallgoods kept in scope
  'bacon', 'ham', 'middle', 'streaky', 'shortcut', 'picnic',
  // sausages, burgers & co.
  'sausage', 'chipolata', 'sausage_mince', 'burger', 'rissole', 'meatball', 'kofta', 'chevap',
  'schnitzel', 'kebab', 'nugget', 'popcorn', 'kyiv', 'bite', 'porchetta',
  // seafood
  'side', 'smoked', 'hot_smoked', 'double_smoked', 'triple_smoked', 'gravlax', 'tube', 'ring', 'meat',
  'tail', 'mix', 'bundle',
])

// Cuts that ARE a steak: "Rump Steak" = "Rump", "Pork Scotch Steak" = "Pork
// Scotch Fillet Steak". The word `steak` adds nothing next to them.
export const STEAK_CUTS = new Set(['rump', 'porterhouse', 'scotch', 'eye_fillet', 't_bone', 'sizzle', 'chuck', 'oyster_blade', 'flat_iron'])

// Seafood words that are an attribute for seafood rather than a cut.
export const SEAFOOD_STATE = new Set(['raw', 'cooked', 'peeled'])

// ---------------------------------------------------------------- attributes

// Must agree between two listings for them to share a key. Order-free.
export const ATTRS = new Set([
  'free_range', 'barn_bred', 'organic', 'grass_fed', 'grain_fed', 'wagyu', 'angus', 'skin_on', 'skinless',
  'bone_in', 'boneless', 'thin_cut', 'thick_cut', 'thin', 'thick', 'frozen', 'thawed', 'wild', 'farmed',
  'tail_on', 'tail_off', 'roe_off', 'whole_shell', 'sharing', 'frenched', 'extra_trim',
  'tomahawk_bone', 'gluten_free', 'high_protein', 'salt_reduced', 'moisture_infused', 'quarter_pound', 'slider', 'smash',
  'stacker', 'jumbo', 'king', 'coho', 'sockeye', 'norwegian', 'tiger', 'banana', 'vannamei', 'blue',
  'greenshell', 'pacific', 'rock', 'yellowfin', 'goldband', 'crimson', 'tropical', 'gummy', 'rainbow',
  'lean', 'regular', 'extra_lean', 'premium', 'raw', 'cooked', 'peeled', 'cocktail', 'rindless', 'cooking', 'quarter',
  // prawn and oyster grade (only for GRADED_SEAFOOD; ignored elsewhere)
  'x_small', 'small', 'medium', 'large', 'x_large',
])

// Flavour, marinade, coating, filling. Present = a prepared line. Kept IN the
// key, so honey-soy kebabs match honey-soy kebabs and never plain chicken.
export const FLAVOURS = new Set([
  'slow_cooked', 'southern_fried', 'char_siu', 'peri_peri', 'cafe_de_paris', 'sweet_chilli', 'honey_soy',
  'soy_garlic', 'garlic_herb', 'lemon_herb', 'lemon_garlic', 'mustard_dill', 'honey_mint', 'honey_rosemary',
  'rosemary_garlic', 'rosemary_mint',
  'marinated', 'marinade', 'seasoned', 'seasoning', 'rub', 'glaze', 'glazed', 'sauce', 'stuffed', 'stuffing',
  'filled', 'wrapped', 'topped', 'crumb', 'crumbed', 'panko', 'fried', 'butter', 'confit', 'peking',
  'teriyaki', 'satay', 'hoisin', 'tikka', 'masala', 'souvlaki', 'shawarma', 'gyros', 'greek', 'mexican',
  'italian', 'korean', 'japanese', 'thai', 'asian', 'moroccan', 'mediterranean', 'texan', 'texas',
  'bavarian', 'chinese', 'portuguese', 'baharat', 'steakhouse', 'cajun', 'buffalo', 'buttermilk', 'spicy',
  'bbq', 'smokey', 'smoky', 'honey', 'soy', 'garlic', 'herb', 'rosemary', 'thyme', 'lemon', 'pepper',
  'peppered', 'peppercorn', 'sweet', 'chilli', 'lime', 'mustard', 'dill', 'sriracha', 'mango', 'coconut',
  'bearnaise', 'caramelised', 'onion', 'red', 'wine', 'shiraz', 'balsamic', 'fennel', 'orange', 'apple',
  'cheese', 'cheeseburger', 'spinach', 'fetta', 'feta', 'parsley', 'oregano', 'mint', 'sage', 'tomato',
  'zucchini', 'cheddar', 'sesame', 'manuka', 'beech', 'beechwood', 'hickory', 'wood', 'spice', 'spices',
  'creamy', 'ricotta', 'pesto', 'basil', 'napolitana', 'sundried', 'capsicum', 'mild', 'paprika',
  'bourbon', 'carolina', 'pumpkin', 'loaded', 'jam', 'tarragon', 'tzatziki', 'tahini', 'noodles',
  'vegetables', 'veg', 'olives', 'cumberland', 'chorizo', 'royal', 'gala', 'lightly', 'roasted',
  'oven', 'baked', 'crispy', 'sticky', 'smoke', 'infused', 'green', 'pub', 'chargrilled',
  'flavoured', 'triple', 'rustic', 'kiev', 'country_style', 'salt', 'salt_pepper', 'sour', 'hot', 'crusted', 'maple', 'pinot',
  'mountain_ash', 'parmigia', 'parmigiana', 'parmi', 'bismarck', 'cranberry', 'ginger', 'cured', 'quinoa',
  'wholemeal', 'filling', 'champagne', 'bread',
])

// Products that are not fresh meat at all. Captured, listed in the review
// (OUT_OF_SCOPE), never matched: deli counter meats, continental smallgoods,
// ready meals, sauces, fats, roe.
export const OUT_OF_SCOPE = new Set([
  'deli', 'salami', 'mortadella', 'pastrami', 'devon', 'berliner', 'kransky', 'frankfurt', 'frankfurts',
  'hotdog', 'hotdogs', 'kabana', 'vienna', 'pariser', 'wurst', 'liverwurst', 'weisswurst', 'pancetta',
  'speck', 'guanciale', 'prosciutto', 'biltong', 'basturma', 'sujuk', 'pepperoni', 'kaiser', 'fleisch',
  'blackpudding', 'whitepudding', 'pudding', 'caviar', 'blinis', 'lasagne', 'enchilada', 'stroganoff',
  'kit', 'pancake', 'parcel', 'pastry', 'roll', 'fat', 'spread', 'salad', 'shredded', 'pulled', 'rendang',
  'rollmops', 'shaved', 'sous', 'vide', 'blanket', 'blankets', 'platter',
  'sliders', 'selection', 'gravy', 'curry', 'tartare', 'puff', 'dried', 'air', 'lumpfish', 'rendered',
  'tortilla',
])

// Words that carry nothing a shopper would pay differently for, at least not
// in a way the two retailers' names express consistently. Sizes are here
// because the weight says it better (weights.js); grades for prawns are not
// (see GRADED_SEAFOOD).
export const IGNORABLE = new Set([
  'the', 'and', 'with', 'in', 'of', 'a', 'for', 'on', 'to', 'n', 'x',
  'fresh', 'australian', 'australia', 'aussie', 'tasmanian', 'tassie', 'tasmania', 'atlantic', 'patagonian',
  'halal', 'kosher', 'msc', 'wa', 'nz', 'cv', 'vsp', 'rr',
  'pack', 'packs', 'bag', 'value', 'bulk', 'big', 'family', 'little', 'mini', 'single', 'twin', 'carton',
  'piece', 'pieces', 'approx', 'each', 'tray', 'plate', 'pk',
  'everyday', 'classic', 'original', 'traditional', 'homestyle', 'country', 'style', 'inspired', 'gourmet',
  'authentic', 'brothers', 'butcher', 'butchers', 'brand', 'choice', 'entertaining', 'simply', 'finest',
  'signature', 'natural', 'plain', 'chilled', 'chef', 'chefs', 'cut', 'cook', 'sizzlin',
  'trimmed', 'chunky', 'casserole', 'bolar', 'hand', 'meaty', 'offal', 'seafood', 'meats', 'deveined', 'bird', 'bolognese', 'ocean', 'juicy', 'eater', 'swimmer', 'brother', 'made', 'gold', 'shell', 'shelled',
  'christmas', 'rolled', 'caught', 'long', 'french', 'turkish', 'swedish', 'rich', 'quick',
])
