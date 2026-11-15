// What season is it, and what is supposed to be cheap in it.
//
// Fruit and vegetables are the one aisle whose price is set mostly by the
// weather: they cannot be stockpiled and are almost all grown here, so a
// seasonal page is not decoration, it is the actual mechanism. This module is
// the HYPOTHESIS half of that page. The measurement half lives in ./index.js.
//
// THE HONESTY SPLIT
// -----------------
// Our own archive starts 4 Sep 2026 — one season, late winter into mid spring.
// We therefore cannot measure a summer we have not lived through, and principle
// #1 (never show an estimate as a measurement) forbids implying otherwise. So
// the two halves are kept strictly apart:
//
//   SEASONALITY (here)  what SHOULD be cheap now. Hand-maintained horticultural
//                       fact, every entry tagged `source: 'general'`, exactly the
//                       convention client/src/lib/facts/vegetables.js already
//                       uses for prose whose number we did not measure.
//   ./index.js          what WE MEASURED. Every number, always.
//
// The page then states the claim and tests it, and a contradiction is content
// rather than an embarrassment: sweet corn is listed as a summer vegetable and
// our spring captures show it RISING 70–83% at both retailers, which is the
// local crop not having arrived yet. That row is worth more than a row we quietly
// dropped for disagreeing with us.
//
// Nothing in the table was fitted to our captures. It is written from the
// horticultural season so it can disagree with us; a table tuned to our own
// numbers would confirm itself and be worthless as a test.
//
// WHY MET SEASONS AND SYDNEY DATES
// --------------------------------
// Australian meteorological seasons (spring = 1 Sep) rather than astronomical
// ones, because that is what an Australian means by "spring" and what every
// seasonality guide is written against.
//
// Dates are resolved in Australia/Sydney, NOT UTC, and this is load-bearing
// rather than fussiness: the schedule fires at 06:00 and 18:00 UTC, so the
// evening run on 31 Aug UTC is 04:00 on 1 SEPTEMBER in Sydney. Bucketed by UTC
// date, that run lands in winter; bucketed by the date the shopper was actually
// living, it lands in spring. The client already shows every timestamp in
// Australia/Sydney (client/src/lib/format.js), so UTC bucketing here would also
// put a run in a different season from the date printed beside it.
//
// KEYS
// ----
// Keyed by the matcher's own vocabulary, most specific first, so a lookup key is
// literally a match key prefix: `apples` or `apples:pink-lady`. `seasonalityFor`
// tries `group:variety` then `group`, and the `:organic` / `:imperfect` suffixes
// a match key can carry are stripped first.
//
// A group whose varieties do not share a season gets NO group-level entry and is
// described per variety instead — `continental-veg` holds eggplant (summer) and
// leek (winter), and an entry covering both would be false for each. An
// unlisted key yields null, which the page reports as "not in the calendar"
// rather than guessing.
//
// Keys are validated against the matcher's real groups and varieties in
// season.test.mjs, so a typo here fails the suite instead of silently never
// matching a product.
import { GROUP_HEAD_TOKENS } from '../matching/groups.js'

// ---- season arithmetic ----

// Ordered by position within a calendar year, which is what makes `prevSeason`
// arithmetic rather than a lookup table. Summer is last because it STARTS in
// December and runs into the following January and February.
export const SEASON_ORDER = ['autumn', 'winter', 'spring', 'summer']
export const SEASON_START_MONTH = { autumn: 3, winter: 6, spring: 9, summer: 12 }

// A new season needs this many measured days before the page will compare
// against it. Below it, the page holds the previous season and says so: on
// 1 December summer has one day of baseline and every percentage computed from
// it would be noise wearing a number's clothes.
export const MIN_BASELINE_DAYS = 10

const SYDNEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
})

/**
 * The Sydney calendar date of an instant, as `YYYY-MM-DD`.
 *
 * Assembled from formatToParts rather than trusting the locale's pattern: the
 * one thing this must never do is silently emit DD-MM-YYYY under a different
 * ICU build, because every comparison downstream is a string comparison.
 */
export function sydneyDate(at) {
  // `new Date(null)` is the epoch, not an invalid date, so a null reaching here
  // would silently resolve to 1 Jan 1970 and report "summer" rather than
  // nothing. Reject the empty cases before constructing a Date.
  if (at == null || at === '') return null
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return null
  const p = {}
  for (const { type, value } of SYDNEY.formatToParts(d)) p[type] = value
  return `${p.year}-${p.month}-${p.day}`
}

// Accepts an instant (ISO string or Date, resolved in Sydney) or an already
// resolved `YYYY-MM-DD`. The latter passes through untouched so that a date
// already bucketed by this module is never shifted a second time.
const asDate = (at) => (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : sydneyDate(at))

const monthOf = (date) => Number(date.slice(5, 7))
const yearOf = (date) => Number(date.slice(0, 4))

/** 'spring' for any date in September, October or November. */
export function seasonOf(at) {
  const date = asDate(at)
  if (!date) return null
  const m = monthOf(date)
  if (m >= 12 || m <= 2) return 'summer'
  if (m <= 5) return 'autumn'
  if (m <= 8) return 'winter'
  return 'spring'
}

/**
 * The calendar year the current season BEGAN in — so January 2027 is summer
 * 2026, because that summer started in December 2026. Without this, a summer
 * would be split in half at new year and its baseline thrown away.
 */
export function seasonYearOf(at) {
  const date = asDate(at)
  if (!date) return null
  return monthOf(date) <= 2 ? yearOf(date) - 1 : yearOf(date)
}

/** First day of a season, as `YYYY-MM-DD`. */
export function seasonStart(season, year) {
  const m = SEASON_START_MONTH[season]
  if (!m) return null
  return `${year}-${String(m).padStart(2, '0')}-01`
}

export function prevSeason(season, year) {
  const i = SEASON_ORDER.indexOf(season)
  if (i < 0) return null
  // Wrapping below autumn lands on the summer that began the previous year.
  return i === 0
    ? { season: 'summer', year: year - 1 }
    : { season: SEASON_ORDER[i - 1], year }
}

export function nextSeason(season, year) {
  const i = SEASON_ORDER.indexOf(season)
  if (i < 0) return null
  return i === SEASON_ORDER.length - 1
    ? { season: 'autumn', year: year + 1 }
    : { season: SEASON_ORDER[i + 1], year }
}

export const seasonLabel = (season, year) =>
  season ? `${season[0].toUpperCase()}${season.slice(1)}${year == null ? '' : ` ${year}`}` : null

/**
 * Which season the page should actually report on, given the days we have
 * measured.
 *
 * Returns the calendar season once it has MIN_BASELINE_DAYS of captures, and
 * otherwise holds the previous season with `lagging: true` so the header can say
 * "summer began 1 Dec, 7 days measured — still showing spring". The page is then
 * never empty and never wrong, at the cost of trailing the calendar by a week or
 * two, which it admits to rather than hides.
 *
 * `dates` are Sydney dates (`YYYY-MM-DD`); duplicates are fine, days are counted
 * distinctly.
 */
export function activeSeason(dates, { today = new Date() } = {}) {
  const now = asDate(today)
  const calendarSeason = seasonOf(now)
  const calendarYear = seasonYearOf(now)
  const unique = new Set(dates.map(asDate).filter(Boolean))

  const daysIn = (season, year) => {
    const from = seasonStart(season, year)
    const next = nextSeason(season, year)
    const to = seasonStart(next.season, next.year)
    let n = 0
    for (const d of unique) if (d >= from && d < to) n++
    return n
  }

  const calendarDays = daysIn(calendarSeason, calendarYear)
  if (calendarDays >= MIN_BASELINE_DAYS) {
    return {
      season: calendarSeason, year: calendarYear,
      start: seasonStart(calendarSeason, calendarYear),
      daysMeasured: calendarDays, lagging: false,
      calendarSeason, calendarYear, calendarDays, minBaselineDays: MIN_BASELINE_DAYS,
    }
  }
  const prev = prevSeason(calendarSeason, calendarYear)
  return {
    season: prev.season, year: prev.year,
    start: seasonStart(prev.season, prev.year),
    daysMeasured: daysIn(prev.season, prev.year), lagging: true,
    calendarSeason, calendarYear, calendarDays, minBaselineDays: MIN_BASELINE_DAYS,
  }
}

// ---- the seasonality table ----
//
// Each entry: { seasons, peak, yearRound, note }
//   seasons    the seasons the Australian crop is actually in. Deliberately NOT
//              padded with the shoulder months a price starts moving in —
//              `statusFor` derives `coming` and `going` from the neighbours, so
//              melons are `['summer']` and spring reads as "coming into season"
//              without summer's entry having to lie about spring.
//   peak       the cheapest, most abundant season, or null.
//   yearRound  true for a crop that is stored, glasshouse-grown or imported
//              year round. Such a row expects no seasonal move at all, which
//              makes it the control group: if a year-round item swings 40%, that
//              is a promotion or a supply shock, not a season.
//   note       one plain sentence of why, shown beside the claim.
export const SEASONALITY = {
  // --- fruit ---
  apples: { seasons: ['autumn', 'winter'], peak: 'autumn', note: 'Picked February to May, then held in controlled-atmosphere storage, so apples are sold all year but are freshest and cheapest just after harvest.' },
  pears: { seasons: ['autumn', 'winter'], peak: 'autumn', note: 'Harvested late summer into autumn and stored much like apples.' },
  'pears:green-nashi': { seasons: ['autumn'], peak: 'autumn', note: 'Nashi are a short autumn crop and do not store as long as European pears.' },
  'pears:brown-nashi': { seasons: ['autumn'], peak: 'autumn', note: 'Nashi are a short autumn crop and do not store as long as European pears.' },
  citrus: { seasons: ['winter', 'spring'], peak: 'winter', note: 'Australian oranges and lemons are a winter crop — citrus is at its best when little other local fruit is.' },
  'citrus:lime': { seasons: ['summer', 'autumn'], peak: 'autumn', note: 'Limes run opposite to the rest of the citrus, cropping through the warm months.' },
  'citrus:lemon': { seasons: ['winter'], peak: 'winter', yearRound: true, note: 'Lemons fruit heaviest in winter but are available all year.' },
  'citrus:blood-orange': { seasons: ['winter'], peak: 'winter', note: 'A short mid-winter crop; the red flesh needs cold nights to colour.' },
  mandarins: { seasons: ['autumn', 'winter'], peak: 'winter', note: 'Imperials start the season in autumn and the late Afourer and Murcott varieties finish it in early spring.' },
  mangoes: { seasons: ['spring', 'summer'], peak: 'summer', note: 'The Northern Territory crop reaches the southern markets from September and the season moves south through to January — the first mangoes are the signal of an Australian summer.' },
  berries: { seasons: ['spring', 'summer'], peak: 'summer', note: 'Berry supply builds from spring into summer as the growing regions move south.' },
  'berries:strawberry': { seasons: ['spring', 'summer'], peak: 'spring', note: 'Queensland supplies winter and early spring, then the Victorian crop arrives and prices fall.' },
  'stone-fruit': { seasons: ['summer'], peak: 'summer', note: 'Cherries, apricots, peaches, nectarines and plums are all summer fruit; cherries are the shortest season of the lot.' },
  'stone-fruit:plum': { seasons: ['summer', 'autumn'], peak: 'summer', note: 'Plums run later than the rest of the stone fruit, from December into early autumn.' },
  grapes: { seasons: ['summer', 'autumn'], peak: 'summer', note: 'Table grapes crop from the new year through to about May.' },
  melons: { seasons: ['summer'], peak: 'summer', note: 'Watermelon, rockmelon and honeydew are hot-weather crops and are at their cheapest in the heat.' },
  avocados: { seasons: ['winter', 'spring'], peak: 'spring', note: 'Hass, the main variety, runs roughly autumn through to spring.' },
  bananas: { seasons: [], yearRound: true, peak: null, note: 'Grown in tropical north Queensland, which has no winter, so bananas crop all year. Their price moves with cyclones, not seasons.' },
  dates: { seasons: [], yearRound: true, peak: null, note: 'Sold dried or semi-dried and largely imported, so there is no fresh season.' },
  // `tropical-fruit` holds crops from pineapple to kiwifruit; no group entry.
  'tropical-fruit:pineapple': { seasons: ['summer'], peak: 'summer', note: 'A Queensland crop that peaks over the hottest months.' },
  'tropical-fruit:passionfruit': { seasons: ['summer', 'autumn'], peak: 'autumn', note: 'Two crops a year in Queensland, the heavier one through late summer and autumn.' },
  'tropical-fruit:panama-passionfruit': { seasons: ['summer', 'autumn'], peak: 'autumn', note: 'The larger Panama types follow the same late-summer crop.' },
  'tropical-fruit:persimmon': { seasons: ['autumn'], peak: 'autumn', note: 'A short autumn season, over within about two months.' },
  'tropical-fruit:pomegranate': { seasons: ['autumn'], peak: 'autumn', note: 'Harvested in autumn and stored only briefly.' },
  'tropical-fruit:kiwifruit': { seasons: ['autumn', 'winter'], peak: 'winter', note: 'The local and New Zealand crops are picked in autumn and keep through winter.' },
  'tropical-fruit:green-kiwifruit': { seasons: ['autumn', 'winter'], peak: 'winter', note: 'The local and New Zealand crops are picked in autumn and keep through winter.' },
  'tropical-fruit:gold-kiwifruit': { seasons: ['autumn', 'winter'], peak: 'winter', note: 'The gold varieties run slightly earlier than green.' },
  'tropical-fruit:papaya': { seasons: [], yearRound: true, peak: null, note: 'A tropical crop with no real off season.' },
  'tropical-fruit:pawpaw': { seasons: [], yearRound: true, peak: null, note: 'A tropical crop with no real off season.' },
  'tropical-fruit:coconut': { seasons: [], yearRound: true, peak: null, note: 'Almost all imported, from equatorial countries that have no seasons to speak of, so supply is flat all year.' },
  'tropical-fruit:drinking-coconut': { seasons: [], yearRound: true, peak: null, note: 'Imported young and shipped chilled year round; demand rises in summer but supply does not change.' },
  rhubarb: { seasons: ['winter', 'spring'], peak: 'spring', note: 'A cool-season crop, best through the second half of winter and into spring.' },

  // --- vegetables ---
  asparagus: { seasons: ['spring', 'summer'], peak: 'spring', note: 'A true spring vegetable: the Victorian and NSW crops run September to December and the price falls fast once cutting starts.' },
  tomatoes: { seasons: ['summer', 'autumn'], peak: 'summer', note: 'Field tomatoes are a hot-weather crop; the glasshouse trade fills winter at a higher price.' },
  cucumbers: { seasons: ['summer', 'autumn'], peak: 'summer', note: 'A warm-season crop, cheapest once field-grown fruit replaces glasshouse supply.' },
  zucchini: { seasons: ['summer', 'autumn'], peak: 'summer', note: 'Crops heavily in the heat, which is when it is cheapest.' },
  capsicums: { seasons: ['summer', 'autumn'], peak: 'summer', note: 'A warm-season fruit vegetable; winter supply is glasshouse-grown and dearer.' },
  chillies: { seasons: ['summer', 'autumn'], peak: 'summer', note: 'Same growing pattern as capsicum, which it is a close relative of.' },
  'sweet-corn': { seasons: ['summer', 'autumn'], peak: 'summer', note: 'Needs heat and a lot of water; the main crop runs from about November to April.' },
  'peas-beans': { seasons: ['summer', 'autumn'], peak: 'summer', note: 'Green and runner beans are a warm-season crop.' },
  'peas-beans:snow-pea': { seasons: ['spring'], peak: 'spring', note: 'Peas prefer cool weather and bolt in the heat, so they run opposite to beans.' },
  'peas-beans:sugar-snap': { seasons: ['spring'], peak: 'spring', note: 'Peas prefer cool weather and bolt in the heat, so they run opposite to beans.' },
  brassicas: { seasons: ['autumn', 'winter'], peak: 'winter', note: 'Cabbage, cauliflower and broccoli are cool-season crops that sweeten with frost and run out as the weather warms.' },
  pumpkin: { seasons: ['autumn', 'winter'], peak: 'autumn', note: 'Harvested in autumn and stored through winter, so the cheapest pumpkin is just after harvest and the dearest is the last of the stored crop in spring.' },
  'root-veg': { seasons: ['autumn', 'winter'], peak: 'winter', note: 'Beetroot, parsnip, swede and turnip are cool-season roots.' },
  'root-veg:radish': { seasons: [], yearRound: true, peak: null, note: 'Ready about four weeks from sowing, so it is grown continuously all year.' },
  'continental-veg:eggplant': { seasons: ['summer', 'autumn'], peak: 'autumn', note: 'Peaks from late summer into early autumn.' },
  'continental-veg:lebanese-eggplant': { seasons: ['summer', 'autumn'], peak: 'autumn', note: 'Peaks from late summer into early autumn.' },
  'continental-veg:leek': { seasons: ['autumn', 'winter'], peak: 'winter', note: 'A cool-season allium, at its best through winter.' },
  'continental-veg:fennel': { seasons: ['winter', 'spring'], peak: 'spring', note: 'Grown through the cooler months; it bolts in summer heat.' },
  celery: { seasons: ['summer'], peak: 'summer', yearRound: true, note: 'Available all year; the Victorian summer crop is the cheapest and crispest.' },
  lettuce: { seasons: [], yearRound: true, peak: null, note: 'Grown continuously, with the growing regions moving to follow the weather.' },
  'leafy-greens': { seasons: [], yearRound: true, peak: null, note: 'Spinach, rocket and Asian greens are fast crops grown all year, much of it hydroponically.' },
  herbs: { seasons: [], yearRound: true, peak: null, note: 'Mostly grown under cover in small pots and bunches, so supply barely moves with the season.' },
  mushrooms: { seasons: [], yearRound: true, peak: null, note: 'Grown indoors in climate-controlled sheds, which is why mushrooms are the one produce line with almost no seasonal price move at all.' },
  potatoes: { seasons: [], yearRound: true, peak: null, note: 'Several regions crop in sequence and the harvest stores for months, so potatoes are available all year.' },
  'sweet-potatoes': { seasons: [], yearRound: true, peak: null, note: 'Queensland crops most of the year and the roots store well.' },
  carrots: { seasons: [], yearRound: true, peak: null, note: 'Grown in sequence across several regions and stored, so supply is steady all year.' },
  onions: { seasons: [], yearRound: true, peak: null, note: 'Harvested in the warmer months and stored dry for most of the year.' },
  garlic: { seasons: [], yearRound: true, peak: null, note: 'The Australian crop is harvested in spring and summer, but imported garlic fills the rest of the year.' },
  ginger: { seasons: ['autumn', 'winter'], peak: 'autumn', note: 'The Queensland crop is dug from about March; young "green" ginger appears first and the stored mature crop follows.' },
}

// ---- lookups ----

const STRIP = new Set(['organic', 'imperfect'])

/**
 * The calendar entry for a match key, group, or `group:variety` pair.
 *
 * Tries `group:variety` before `group`, so a variety that runs against its
 * group's season (limes against the winter citrus, snow peas against the summer
 * beans) wins. `:organic` and `:imperfect` are stripped: neither changes when a
 * thing grows.
 *
 * Returns null for anything unlisted, which the page reports rather than
 * guessing at.
 */
export function seasonalityFor(key, variety) {
  if (!key) return null
  const parts = variety == null
    ? String(key).split(':').filter((p) => !STRIP.has(p))
    : [String(key), String(variety)]
  const [group, v] = parts
  if (!group) return null
  const entry = (v && SEASONALITY[`${group}:${v}`]) || SEASONALITY[group] || null
  if (!entry) return null
  // `source` is set here rather than repeated on 60 entries: it is a property of
  // this whole table, and one entry that forgot it would be the one that gets
  // mistaken for a measurement.
  return { ...entry, seasons: entry.seasons || [], yearRound: !!entry.yearRound, source: 'general', key: group }
}

/**
 * Where a crop sits relative to a given season.
 *
 * `coming` and `going` are derived from the neighbouring seasons rather than
 * declared, which is what lets each entry state only the seasons the crop is
 * actually in. They matter more than `in` for a price page, because the sharp
 * moves happen on the way into and out of a season, not during it.
 */
export function statusFor(entry, season) {
  if (!entry || !season) return null
  if (entry.yearRound && !entry.seasons.includes(season)) return 'year-round'
  if (entry.peak === season) return 'peak'
  if (entry.seasons.includes(season)) return 'in'
  const next = nextSeason(season, 2000), prev = prevSeason(season, 2000)
  if (entry.seasons.includes(next.season)) return 'coming'
  if (entry.seasons.includes(prev.season)) return 'going'
  return 'out'
}

/**
 * Which way the calendar expects the price to be MOVING — the claim our own
 * series then confirms or contradicts.
 *
 * THE SPRING GAP: why `coming` expects RISING, not falling
 * --------------------------------------------------------
 * The obvious guess is that a crop about to come into season is already getting
 * cheaper. Our spring 2026 captures say the opposite, loudly and at both
 * retailers at once: sweet corn +83% and +70%, yellow capsicum +81%, lime +62%,
 * zucchini +51%, roma tomatoes +41% — every one a summer crop, every one
 * climbing through October.
 *
 * That is the shoulder between two seasons. The last of the previous crop is
 * running out while the new one is not yet picked, so supply is at its thinnest
 * and the price peaks just BEFORE it collapses. A crop coming into season is
 * therefore dear now and cheap soon, which is the single most actionable thing
 * this page can tell a shopper: wait two weeks on the corn.
 *
 * Note that `coming` and `going` both expect rising but mean opposite things to
 * a shopper — wait, versus buy something else. The direction is the testable
 * claim; `statusFor` carries the advice. Nothing here was fitted to our numbers
 * beyond this one correction, and the correction changed no season in the table.
 *
 * `in` expects nothing: mid-season is where a price sits still, and claiming a
 * direction there would manufacture verdicts out of noise.
 */
export function expectationFor(entry, season) {
  const status = statusFor(entry, season)
  if (status === 'peak') return 'falling'
  if (status === 'coming' || status === 'going' || status === 'out') return 'rising'
  if (status === 'in' || status === 'year-round') return 'flat'
  return null
}

// Every group the matcher can produce, for the key-validation test and for
// reporting how much of the shelf the calendar actually covers.
export const KNOWN_GROUPS = new Set(GROUP_HEAD_TOKENS.keys())
