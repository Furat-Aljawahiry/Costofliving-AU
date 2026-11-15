// Season arithmetic and the seasonality calendar.
//
// No I/O against data/out: pure functions and the committed table only, so the
// suite does not change meaning when the archive grows. The clock is injected
// everywhere (`{ today }`), because a suite that reads the real date passes in
// October and fails in December.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEASON_ORDER, MIN_BASELINE_DAYS, SEASONALITY, KNOWN_GROUPS,
  sydneyDate, seasonOf, seasonYearOf, seasonStart, prevSeason, nextSeason,
  seasonLabel, activeSeason, seasonalityFor, statusFor, expectationFor,
} from './calendar.js'
import { VARIETIES } from '../matching/varieties.js'

// ---- season boundaries ----

test('seasonOf covers the four meteorological seasons', () => {
  assert.equal(seasonOf('2026-09-01'), 'spring')
  assert.equal(seasonOf('2026-11-30'), 'spring')
  assert.equal(seasonOf('2026-12-01'), 'summer')
  assert.equal(seasonOf('2027-02-28'), 'summer')
  assert.equal(seasonOf('2027-03-01'), 'autumn')
  assert.equal(seasonOf('2027-05-31'), 'autumn')
  assert.equal(seasonOf('2027-06-01'), 'winter')
  assert.equal(seasonOf('2027-08-31'), 'winter')
})

test('seasonOf returns null for an unparseable date', () => {
  assert.equal(seasonOf('not a date'), null)
  assert.equal(seasonOf(null), null)
})

// ---- the UTC/Sydney boundary, which is why sydneyDate exists ----

test('the 18:00 UTC run on 31 Aug is a SPRING run, because Sydney is already 1 Sep', () => {
  // AEST (+10): 18:00 UTC 31 Aug -> 04:00 1 Sep in Sydney. Bucketed by UTC date
  // this run would land in winter and be excluded from spring's baseline.
  assert.equal(sydneyDate('2026-08-31T18:00:38Z'), '2026-09-01')
  assert.equal(seasonOf('2026-08-31T18:00:38Z'), 'spring')
})

test('sydneyDate handles the AEDT offset too', () => {
  // AEDT (+11) from early October: 18:00 UTC 21 Oct -> 05:00 22 Oct.
  assert.equal(sydneyDate('2026-10-21T18:00:38Z'), '2026-10-22')
  // The 06:00 UTC run on the same day is still that afternoon in Sydney.
  assert.equal(sydneyDate('2026-10-21T06:30:33Z'), '2026-10-21')
})

test('an already-resolved YYYY-MM-DD is not shifted a second time', () => {
  assert.equal(sydneyDate('2026-10-22'), '2026-10-22')
  assert.equal(seasonOf('2026-12-01'), 'summer')
})

// ---- the summer that spans new year ----

test('seasonYearOf keeps a summer together across new year', () => {
  assert.equal(seasonYearOf('2026-12-15'), 2026)
  assert.equal(seasonYearOf('2027-01-15'), 2026)
  assert.equal(seasonYearOf('2027-02-28'), 2026)
  assert.equal(seasonYearOf('2027-03-01'), 2027)
})

test('seasonStart', () => {
  assert.equal(seasonStart('spring', 2026), '2026-09-01')
  assert.equal(seasonStart('summer', 2026), '2026-12-01')
  assert.equal(seasonStart('autumn', 2027), '2027-03-01')
  assert.equal(seasonStart('nonsense', 2026), null)
})

test('prevSeason and nextSeason wrap through the year boundary', () => {
  assert.deepEqual(prevSeason('spring', 2026), { season: 'winter', year: 2026 })
  assert.deepEqual(prevSeason('summer', 2026), { season: 'spring', year: 2026 })
  // Autumn is the first season of a calendar year, so its predecessor is the
  // summer that began the December before.
  assert.deepEqual(prevSeason('autumn', 2026), { season: 'summer', year: 2025 })
  assert.deepEqual(nextSeason('summer', 2026), { season: 'autumn', year: 2027 })
  assert.deepEqual(nextSeason('spring', 2026), { season: 'summer', year: 2026 })
})

test('SEASON_ORDER runs in calendar order within a year', () => {
  assert.deepEqual(SEASON_ORDER, ['autumn', 'winter', 'spring', 'summer'])
})

test('seasonLabel', () => {
  assert.equal(seasonLabel('spring', 2026), 'Spring 2026')
  assert.equal(seasonLabel('spring'), 'Spring')
  assert.equal(seasonLabel(null), null)
})

// ---- activeSeason: the young-season hold ----

const springDays = (n, from = 4) =>
  Array.from({ length: n }, (_, i) => `2026-09-${String(from + i).padStart(2, '0')}`)

test('a season with enough measured days is reported directly', () => {
  const a = activeSeason(springDays(20), { today: '2026-10-22' })
  assert.equal(a.season, 'spring')
  assert.equal(a.year, 2026)
  assert.equal(a.start, '2026-09-01')
  assert.equal(a.daysMeasured, 20)
  assert.equal(a.lagging, false)
})

test('on 1 December the page HOLDS spring rather than comparing against one summer day', () => {
  const a = activeSeason([...springDays(20), '2026-12-01'], { today: '2026-12-01' })
  assert.equal(a.season, 'spring', 'holds the previous season')
  assert.equal(a.lagging, true)
  assert.equal(a.calendarSeason, 'summer', 'but still reports what the calendar says')
  assert.equal(a.calendarDays, 1)
  assert.equal(a.daysMeasured, 20, 'the days reported are spring\'s, not summer\'s')
  assert.equal(a.minBaselineDays, MIN_BASELINE_DAYS)
})

test('the hold releases as soon as the new season has MIN_BASELINE_DAYS', () => {
  const summer = Array.from({ length: MIN_BASELINE_DAYS },
    (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`)
  const a = activeSeason([...springDays(20), ...summer], { today: '2026-12-10' })
  assert.equal(a.season, 'summer')
  assert.equal(a.lagging, false)
  assert.equal(a.daysMeasured, MIN_BASELINE_DAYS)
})

test('activeSeason counts distinct days, so two runs a day are one day', () => {
  // The schedule fires twice daily; without the de-dupe every window would
  // appear to have twice the history it does.
  const a = activeSeason(
    ['2026-09-04T06:30:00Z', '2026-09-04T18:00:00Z', '2026-09-05T06:30:00Z'],
    { today: '2026-09-20' })
  assert.equal(a.calendarDays, 2)
})

test('activeSeason only counts days inside the season window', () => {
  const a = activeSeason(['2026-08-01', '2026-08-15', ...springDays(12)], { today: '2026-10-22' })
  assert.equal(a.daysMeasured, 12, 'the two August days belong to winter')
})

// ---- the calendar table ----

test('seasonalityFor resolves a match key to its group', () => {
  const e = seasonalityFor('apples:pink-lady')
  assert.equal(e.key, 'apples')
  assert.equal(e.peak, 'autumn')
  assert.equal(e.source, 'general')
})

test('a variety that runs against its group wins over the group entry', () => {
  // Citrus is a winter crop; limes are not. Without the override a lime would
  // inherit "winter" and every verdict on it would be backwards.
  assert.equal(seasonalityFor('citrus').peak, 'winter')
  assert.equal(seasonalityFor('citrus:lime').peak, 'autumn')
  assert.deepEqual(seasonalityFor('citrus:lime').seasons, ['summer', 'autumn'])
  // Same shape in the other direction: peas against the summer beans.
  assert.equal(seasonalityFor('peas-beans').peak, 'summer')
  assert.equal(seasonalityFor('peas-beans:snow-pea').peak, 'spring')
})

test('the organic and imperfect suffixes are stripped', () => {
  // Neither changes when a thing grows, so both must resolve to the same entry.
  assert.equal(seasonalityFor('apples:pink-lady:organic').peak, 'autumn')
  assert.equal(seasonalityFor('cucumbers:lebanese:imperfect').peak, 'summer')
  assert.equal(seasonalityFor('mushrooms:cup:organic').yearRound, true)
})

test('a group whose varieties disagree has no group entry', () => {
  // continental-veg holds eggplant (summer) and leek (winter): an entry covering
  // both would be false for each, so the bare group must return null.
  assert.equal(seasonalityFor('continental-veg'), null)
  assert.equal(seasonalityFor('continental-veg:eggplant').peak, 'autumn')
  assert.equal(seasonalityFor('continental-veg:leek').peak, 'winter')
})

test('an unlisted key returns null rather than a guess', () => {
  assert.equal(seasonalityFor('sprockets'), null)
  assert.equal(seasonalityFor('sprockets:widget'), null)
  assert.equal(seasonalityFor(''), null)
  assert.equal(seasonalityFor(null), null)
})

test('seasonalityFor accepts group and variety as two arguments', () => {
  assert.equal(seasonalityFor('citrus', 'lime').peak, 'autumn')
  assert.equal(seasonalityFor('citrus', null).peak, 'winter')
})

// ---- status and expectation ----

test('spring: asparagus is at peak and expected to be falling', () => {
  const e = seasonalityFor('asparagus')
  assert.equal(statusFor(e, 'spring'), 'peak')
  assert.equal(expectationFor(e, 'spring'), 'falling')
})

test('spring: a summer crop reads as coming into season', () => {
  for (const key of ['melons', 'tomatoes', 'cucumbers', 'sweet-corn']) {
    assert.equal(statusFor(seasonalityFor(key), 'spring'), 'coming', key)
  }
})

test('the spring gap: a crop coming into season expects RISING, not falling', () => {
  // Measured at both retailers in spring 2026: sweet corn +83%/+70%, yellow
  // capsicum +81%, lime +62%, zucchini +51%. The last of the old crop runs out
  // before the new one is picked, so the price peaks just before it collapses.
  for (const key of ['sweet-corn', 'zucchini', 'capsicums', 'tomatoes']) {
    assert.equal(expectationFor(seasonalityFor(key), 'spring'), 'rising', key)
  }
})

test('coming and going expect the same direction but are different advice', () => {
  // Both climb, but one means "wait two weeks" and the other "buy something
  // else" — so the page must branch on the status, never on the direction.
  const coming = seasonalityFor('sweet-corn'), going = seasonalityFor('pumpkin')
  assert.equal(expectationFor(coming, 'spring'), expectationFor(going, 'spring'))
  assert.notEqual(statusFor(coming, 'spring'), statusFor(going, 'spring'))
})

test('spring: a stored winter crop reads as going out and expected to be rising', () => {
  // This is the pumpkin case our captures confirm at +75% at both retailers.
  for (const key of ['pumpkin', 'brassicas', 'mandarins']) {
    assert.equal(statusFor(seasonalityFor(key), 'spring'), 'going', key)
    assert.equal(expectationFor(seasonalityFor(key), 'spring'), 'rising', key)
  }
})

test('a year-round crop expects no seasonal move at all', () => {
  // These are the control group: a 40% swing on a mushroom is a promotion or a
  // supply shock, never a season.
  for (const key of ['mushrooms', 'potatoes', 'bananas', 'carrots']) {
    assert.equal(statusFor(seasonalityFor(key), 'spring'), 'year-round', key)
    assert.equal(expectationFor(seasonalityFor(key), 'spring'), 'flat', key)
  }
})

test('mid-season asserts no direction', () => {
  // asparagus is in both spring and summer but peaks in spring, so summer is
  // `in` — and `in` must not manufacture a direction out of noise.
  const e = seasonalityFor('asparagus')
  assert.equal(statusFor(e, 'summer'), 'in')
  assert.equal(expectationFor(e, 'summer'), 'flat')
})

test('the season opposite a single-season crop is out, not merely going', () => {
  // Melons are summer only, so winter is two seasons from the crop in both
  // directions — a watermelon in July is not "going out", it is out.
  const melons = seasonalityFor('melons')
  assert.equal(statusFor(melons, 'winter'), 'out')
  assert.equal(expectationFor(melons, 'winter'), 'rising')
  // Autumn, directly after summer, is the `going` case rather than `out`.
  assert.equal(statusFor(melons, 'autumn'), 'going')
})

test('statusFor is null without an entry or a season', () => {
  assert.equal(statusFor(null, 'spring'), null)
  assert.equal(statusFor(seasonalityFor('apples'), null), null)
  assert.equal(expectationFor(null, 'spring'), null)
})

// ---- the table is wired to the matcher's real vocabulary ----
//
// These are the tests that make the calendar maintainable: a typo in a key would
// otherwise never match a product and never fail anything, so the row would
// simply be missing from the page for good.

test('every calendar key names a group the matcher actually produces', () => {
  for (const key of Object.keys(SEASONALITY)) {
    const group = key.split(':')[0]
    assert.ok(KNOWN_GROUPS.has(group), `${key}: unknown group "${group}"`)
  }
})

test('every variety override names a variety in the lexicon', () => {
  for (const key of Object.keys(SEASONALITY)) {
    const [group, variety] = key.split(':')
    if (!variety) continue
    const slugs = new Set((VARIETIES[group] || []).map(([slug]) => slug))
    assert.ok(slugs.has(variety), `${key}: "${variety}" is not a ${group} variety`)
  }
})

test('every entry carries a note and a peak that is one of its own seasons', () => {
  for (const [key, entry] of Object.entries(SEASONALITY)) {
    assert.ok(entry.note && entry.note.length > 20, `${key}: needs a note explaining why`)
    if (entry.peak != null) {
      assert.ok(SEASON_ORDER.includes(entry.peak), `${key}: "${entry.peak}" is not a season`)
      assert.ok((entry.seasons || []).includes(entry.peak),
        `${key}: peak "${entry.peak}" is not among its seasons`)
    }
    for (const s of entry.seasons || []) {
      assert.ok(SEASON_ORDER.includes(s), `${key}: "${s}" is not a season`)
    }
    // A crop is either seasonal or year-round; an entry with neither says nothing.
    assert.ok(entry.yearRound || (entry.seasons || []).length > 0,
      `${key}: needs seasons or yearRound`)
  }
})

test('every lookup carries source general, so it can never read as measured', () => {
  for (const key of Object.keys(SEASONALITY)) {
    assert.equal(seasonalityFor(key.includes(':') ? key : `${key}:x`).source, 'general', key)
  }
})
