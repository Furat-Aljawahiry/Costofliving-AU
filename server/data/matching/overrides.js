// Curated corrections to what the lexicon decided. Reviewed data, not code.
//
// This is the escape hatch, and the reason it is a list of dated, noted records
// rather than a tweak to a scoring function: when a match is wrong, the fix
// should be a reviewable statement of fact that `git log` can explain six months
// later. A threshold quietly nudged from 0.8 to 0.75 explains nothing.
//
//   matchKey  the key whose match is being corrected
//   retailer  the OTHER retailer's row being confirmed or rejected
//   sku       its SKU
//   verdict   'reject' removes it from that key's matches
//             'alias' (meat and snacks) moves this SKU onto the key in `to`: "this is
//             the same product as that", for a pair no lexicon rule can join
//             without dragging others along. `matchKey` is the key the SKU
//             parsed to when reviewed; if the lexicon later changes it, the
//             alias stops applying (see withAlias in index.js)
//             'confirm' records that a human has checked it (no behaviour change
//             yet — it is provenance, and the hook for a future "verified" badge)
//   note      why. Required. An override without a reason is a mystery.
//   date      when the call was made, so a stale one can be re-examined
//
// NOT the same thing as LAMBDA_OUTPUT_SPEC.md §8.1 tier 2 ("curated SKU
// allowlist"). That tier is the PRIMARY matching path for branded staples, where
// the index must track one fixed representative product over time. This file is a
// correction layer over an attribute rule, which is that spec's tier 3. The two
// become the same shape at P2.6, when packaged goods arrive with real GTINs.
//
// Produce: nothing has been reviewed yet. Entries are added as the
// data-quality page (P1.3) surfaces bad matches. The shape is exercised by
// matching.test.mjs so it cannot rot while unused.
//
// Meat: verdicts from the 18 Oct review of data/review/meat (see
// docs/MEAT_DATA_TODO.md). A reject holds from both sides — see applyOverrides.
export const OVERRIDES = [
  {
    matchKey: 'meat:beef:scotch', retailer: 'coles', sku: '2086390',
    verdict: 'reject',
    note: 'Coles Finest "Rib Eye Steak approx. 800g" at $64/kg. Coles names its boneless cut "Scotch Fillet" on every other line; an 800g single rib eye at a 35% premium is the bone-in steak, which is not a scotch fillet.',
    date: '2026-10-18',
  },
  {
    matchKey: 'meat:chicken:portion', retailer: 'coles', sku: '1852549',
    verdict: 'reject',
    note: 'El-Amin\'s "Halal Chicken Portions Family Pack approx. 2.2kg" at $11/kg against Woolworths "Mixed Pieces" at $4.50/kg. "Portions" says nothing about the mix; at more than twice the price of a cut-up bird it is not one (the independent review, 18 Oct, finding 11).',
    date: '2026-10-18',
  },
  // Meat: aliases from the 22 Oct review — each pair was listed as "your call"
  // and the user chose to match all twenty. The side that moves is the one
  // that had no counterpart, so no existing pair is lost (except where noted).
  ...[
    ['coles', '3580600', 'meat:lamb:diced-leg', 'meat:lamb:diced', '"Lamb Leg Diced" = Woolworths "Diced Lamb": 450g, $28.89/kg both'],
    ['woolworths', '899858', 'meat:unspecified:burger:f-bbq', 'meat:beef:burger:f-bbq', 'Market Value "BBQ Burgers 10 Pack 1kg" are beef: = Coles "Beef BBQ Burgers 10 Pack 1kg", $10.50/kg both'],
    ['coles', '4312184', 'meat:chicken:strip:free_range:organic', 'meat:chicken:breast-strip:free_range:organic', '"Organic Chicken Strips Plain" = Macro "Organic Chicken Breast Strips"'],
    ['woolworths', '210537', 'meat:turkey:breast:deli_cooked:f-oven:f-roasted', 'meat:turkey:breast:f-oven:f-roasted:f-slow_cooked', 'Ingham\'s "Turkey Breast Oven Roasted 800g" (deli shelf) = Coles "Oven Roasted Turkey Breast 800g" (ready-to-eat shelf): both cooked'],
    ['woolworths', '6044283', 'meat:turkey:rissole:f-herb:f-onion', 'meat:turkey:rissole', 'Ingham\'s "Turkey Rissoles Herb & Onion 400g" = Coles "Turkey Rissoles 400g", $21.25/kg both'],
    ['coles', '6869141', 'meat:unspecified:sausage_mince', 'meat:beef:sausage_mince', 'Coles "Sausage Mince" = Woolworths "Beef Sausage Mince": 500g, $11/kg both'],
    ['woolworths', '134032', 'meat:chicken:kyiv:boneless:f-creamy:f-garlic:f-stuffed', 'meat:chicken:kyiv:f-butter:f-garlic', '"Creamy Garlic Stuffed Boneless Chicken Kyiv 700g" = Coles "Chicken Kyiv Garlic Butter 700g"'],
    ['coles', '2598520', 'meat:beef:sausage:gluten_free:grass_fed:organic', 'meat:beef:sausage:grass_fed:organic', 'Coles organic "Beef Sausages Gluten Free 450g" = Macro "Organic Beef Sausage 450g": gluten-free is not a different product here'],
    ['coles', '1532752', 'meat:pork:loin-steak:thin_cut', 'meat:pork:loin-steak', '"Pork Loin Steaks Thin Cut 500g" = Woolworths "Loin Steaks Pork 500g", $20/kg both'],
    ['woolworths', '666554', 'meat:pork:mince:free_range:grade_lean', 'meat:pork:mince:free_range:grade_regular', 'Macro "Free Range Lean Pork Mince" = Coles "Free Range Pork Mince": 500g, $17/kg both'],
    ['woolworths', '898511', 'meat:pork:sausage:f-fennel:f-italian', 'meat:pork:sausage:f-italian', 'Italian sausage is fennel sausage: = Coles "Italian Style Pork Sausages", $20/kg both'],
    ['coles', '6764926', 'meat:lamb:butterflied-leg:f-rosemary_garlic', 'meat:lamb:butterflied-leg:f-garlic_herb', 'Butterflied lamb leg "Rosemary & Garlic" = Woolworths "Garlic & Herbs", $28/kg both'],
    ['woolworths', '6036654', 'meat:prawn:whole:cooked:frozen:tiger', 'meat:prawn:whole:cooked:tiger', '"Cooked Tiger Prawns Whole 1kg" (frozen) = Coles "Cooked Tiger Prawns 1kg" (Tassal, deli shelf)'],
    ['woolworths', '6001486', 'meat:pork:leg-roast', 'meat:pork:leg-roast:boneless', '"Pork Leg Mini Roast" is boneless: = Coles "Boneless Mini Pork Leg Roast"'],
    ['woolworths', '200152', 'meat:lamb:leg-roast', 'meat:lamb:leg-roast:boneless', '"Lamb Easy Carve Leg Roast" = Coles "Lamb Leg Roast Boneless". Leaves the bone-in leg roasts (Coles whole leg) it matched before'],
    ['coles', '8902667', 'meat:prawn:peeled', 'meat:prawn:peeled:raw', 'Coles "Prawn Meat 240g" is raw: = Woolworths "Raw Prawn Meat 220g"'],
    ['coles', '5306642', 'meat:tuna:portion', 'meat:tuna:portion:skinless:yellowfin', 'Coles "Tuna Steaks 200g" = Woolworths "Yellowfin Tuna Fillets Skinless 200g"'],
    ['coles', '5406818', 'meat:unspecified:sausage:f-honey', 'meat:unspecified:sausage:f-herb:f-honey', '"Honey BBQ Sausages 8 Pack" = Market Value "Thin Honey & Herb BBQ Sausages 8 Pack"'],
    ['coles', '1496411', 'meat:lamb:strip:f-souvlaki', 'meat:lamb:slice:f-souvlaki', '"Lamb Strips With Souvlaki Seasoning" = Woolworths "Lamb Slices Souvlaki", 500g both'],
    ['coles', '3942620', 'meat:lamb:cutlet:extra_trim:grass_fed', 'meat:lamb:cutlet:extra_trim', 'Graze "Lamb Extra Trim Cutlets" = Woolworths "Lamb Extra Trim Cutlets": grass fed is not a different product here'],
  ].map(([retailer, sku, matchKey, to, note]) => ({ matchKey, retailer, sku, verdict: 'alias', to, note, date: '2026-10-22' })),
  // {
  //   matchKey: 'apples:pink-lady', retailer: 'coles', sku: '2022580',
  //   verdict: 'reject',
  //   note: 'Grab N Glow is a 6-pack of small snack apples; not the same fruit as a loose Pink Lady. Currently also blocked automatically by the per-each pack-semantics guard, so this entry is illustrative.',
  //   date: '2026-09-26',
  // },
  // Snacks: aliases from the 22 Oct review of data/review/snacks
  // (docs/SNACKS_DATA_TODO.md). One word apart, same brand, same pack — but a
  // word no lexicon rule can drop everywhere.
  {
    matchKey: 'snack:snickers:confectionery:caramel.nougat.peanut', retailer: 'woolworths', sku: '206890',
    verdict: 'alias', to: 'snack:snickers:confectionery:caramel.peanut',
    note: 'Woolworths "Snickers Chocolate Bar Peanuts Caramel Nougat 44g" = Coles "Snickers Milk Chocolate Bar Peanuts Caramel 44g": the standard Snickers bar. Every Snickers has nougat; "nougat" cannot be dropped in general (Milky Way, Mars and Toblerone name it as the variant).',
    date: '2026-10-22',
  },
]
