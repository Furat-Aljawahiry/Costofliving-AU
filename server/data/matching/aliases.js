// Hand-set rules: "these two spellings mean the same thing".
//
// THIS FILE IS FOR HUMANS TO EDIT. It is data, not logic. Everything else in
// server/data/matching/ derives its answers from the captures; this file is the
// one place where a person overrules the derivation because they know something
// the data does not say.
//
// Add to it whenever the reports show two things that obviously ought to match
// but do not. The two questions to ask, in order:
//
//   1. Is it a WORD problem?      -> TOKEN_ALIASES
//      One retailer spells or splits a word differently. "Cayanne" for cayenne,
//      "Sweetpotato" for sweet potato, "Kiwi Fruit" for kiwifruit.
//
//   2. Is it a PRODUCT problem?   -> VARIETY_ALIASES
//      Both spellings are correct, but one retailer names the default cultivar
//      and the other leaves it implied. "Cavendish Bananas" vs "Bananas".
//
// Every entry carries a note and a date. An alias without a reason is a mystery
// six months from now, and these are exactly the decisions that get re-litigated.
//
// After editing: `npm run test:server` then `npm run matching-report check`, and
// `npm run matching-report unmatched` to see what it freed up.

// ---------------------------------------------------------------- 1. words

/**
 * token -> token, applied to the parsed name tokens before any lexicon lookup.
 *
 * These are spelling and word-splitting differences, so the rewrite is safe
 * everywhere: there is no context in which "cayanne" means something other than
 * cayenne. Applied to both the itemKey tokens and the brand tokens.
 *
 * NOTE most word-joining is already handled upstream in produceNames.js
 * (`JOIN_PHRASES`), which runs on the raw name before it is split — that is the
 * right place for MULTI-WORD forms like "kiwi fruit" or "paw paw". Use this map
 * for SINGLE tokens that arrive already split or already wrong.
 */
export const TOKEN_ALIASES = {
  // Coles ships this misspelling in the live captures, on its red and green
  // cayenne chilli lines. Carrying it here is cheaper and more honest than
  // fuzzy-matching every token in the file.  — 2026-09-29
  cayanne: 'cayenne',

  // Defensive: if either retailer ever writes the compound closed up, it lands
  // on the same token produceNames.js produces for the two-word form.  — 2026-09-29
  sweetpotato: 'sweet_potato',
  kiwifruits: 'kiwifruit',
  rockmelons: 'rockmelon',
  capsicums: 'capsicum',
}

// ---------------------------------------------------------------- 2. products

/**
 * group -> { variety the lexicon found : the variety it should be treated as }.
 *
 * For when one retailer names the default cultivar and the other implies it. In
 * Australia an unqualified banana IS a Cavendish and an unqualified cabbage IS
 * the green/drumhead one, so Woolworths naming it and Coles not naming it must
 * not split the product in two.
 *
 * This is a stronger claim than a spelling fix — it asserts two DIFFERENT words
 * describe one product — so it is scoped per group and each entry says why.
 *
 * Careful: only alias a cultivar to the base when the base genuinely means that
 * cultivar by default. `royal-gala` must NOT alias to `apple`, because an
 * unqualified apple is not a Royal Gala.
 */
export const VARIETY_ALIASES = {
  bananas: {
    // ~95% of bananas sold in Australia are Cavendish, and both retailers'
    // unqualified "Bananas" line is one. Woolworths says "Cavendish Bananas",
    // Coles says "Bananas approx. 170g" — same fruit, same shelf position.
    // Without this they sat in two keys and never compared.  — 2026-09-29
    cavendish: 'banana',
  },
  brassicas: {
    // Woolworths writes "Cabbage Green Whole", Coles writes "Cabbage Whole".
    // The unqualified cabbage on an Australian shelf is the green/drumhead
    // one; the red, savoy and wombok lines all say so in their names and keep
    // their own keys.  — 2026-09-29
    'green-cabbage': 'cabbage',
    'drumhead-cabbage': 'cabbage',
  },
}

// ---------------------------------------------------------------- application

export const aliasToken = (t) => TOKEN_ALIASES[t] ?? t

export function aliasVariety(group, variety) {
  if (!variety) return variety
  return VARIETY_ALIASES[group]?.[variety] ?? variety
}

// Used by the report tool so a person can see which hand-set rules are actually
// firing, rather than assuming an entry did something.
export const ALIAS_COUNTS = { tokens: Object.keys(TOKEN_ALIASES).length, varieties: Object.values(VARIETY_ALIASES).reduce((n, g) => n + Object.keys(g).length, 0) }
