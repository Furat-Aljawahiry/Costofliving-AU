// Historical price index by category, 2014 -> 2026 (100 = 2014 baseline).
// Shape matches ABS food CPI sub-groups so it can be replaced 1:1 with real
// ABS series (6401.0). Served via /api/history.

const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]

const SERIES = {
  vegetables: [100, 101, 103, 102, 104, 106, 108, 110, 121, 129, 132, 134, 135],
  canned:     [100, 101, 102, 103, 104, 105, 107, 110, 120, 130, 136, 139, 141],
  meat:       [100, 103, 105, 106, 108, 111, 115, 120, 129, 138, 143, 147, 150],
  snacks:     [100, 101, 102, 103, 105, 106, 108, 111, 118, 127, 133, 137, 140],
  chocolate:  [100, 102, 103, 105, 107, 109, 112, 115, 123, 134, 145, 158, 172],
  staples:    [100, 101, 102, 103, 104, 106, 109, 112, 122, 133, 139, 143, 146],
}

export const HISTORY = YEARS.map((year, i) => {
  const row = { year }
  for (const cat of Object.keys(SERIES)) row[cat] = SERIES[cat][i]
  return row
})
