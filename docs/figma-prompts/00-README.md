# Figma agent prompts — Cost of Living AU

The Figma agent only reads ~2,000 words per message, so the brief is split into
five self-contained prompts. Each one repeats the same short "Context + Art
direction" block at the top, so the agent never loses the brand rules between
messages.

Send them **in this order**, one file per message, and wait for each screen to
finish before sending the next:

| # | File | What it produces | Words |
|---|------|------------------|-------|
| 1 | `01-home.md` | Landing page (desktop + mobile) | ~1,050 |
| 2 | `02-category.md` | Category page, e.g. Canned & pantry — Coles vs Woolies, cheapest highlighted | ~900 |
| 3 | `03-product.md` | Product detail page with the backtracked price history chart | ~950 |
| 4 | `04-other-pages.md` | Cheapest today wall, Build your basket, Shrinkflation, Specials checker, Methodology, states | ~950 |
| 5 | `05-components-tokens.md` | Component library, tokens, page structure, prototype links, realistic data | ~900 |

Tips:
- Paste the whole file including the Context block — do not trim it.
- If the agent drifts (gradients, generic hero), reply with just the
  "Art direction" block again and "fix the last screen against this".
- After all five, a good sixth message: "Review every screen against the
  quality bar in section 7 of the last prompt and fix anything that fails."

The single-file version of the full brief is `../FIGMA_DESIGN_BRIEF.md`.
