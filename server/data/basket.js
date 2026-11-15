// Single source of truth for the tracked basket + categories + stores.
// Served to the client via /api/basket, /api/categories, /api/stores.

export const CATEGORIES = [
  { id: 'vegetables', label: 'Fruit & vegetables', icon: '🥦', blurb: 'Fresh produce — the most volatile prices, hit hard by weather and floods.' },
  { id: 'meat', label: 'Meat & poultry', icon: '🍗', blurb: 'Chicken, beef and pork — steadily the biggest riser since 2014.' },
  { id: 'canned', label: 'Canned & pantry', icon: '🥫', blurb: 'Long-life staples: tinned veg, beans, tuna.' },
  { id: 'snacks', label: 'Snacks & confectionery', icon: '🍫', blurb: 'Chips, biscuits, chocolate and lollies — cocoa costs sent these soaring.' },
  { id: 'staples', label: 'Everyday staples', icon: '🥛', blurb: 'Milk, bread, eggs, coffee — the headline cost-of-living basket.' },
]

export const STORES = [
  { id: 'woolworths', label: 'Woolworths', color: '#178841' },
  { id: 'coles', label: 'Coles', color: '#e01a22' },
  { id: 'aldi', label: 'Aldi', color: '#f0a500' },
  { id: 'market', label: 'Market', color: '#6a4c93' },
]

export const BASKET = [
  { id: 'potato', name: 'Potatoes (brushed)', category: 'vegetables', unit: 'kg', brandTier: 'fresh', base: 3.5, keywords: ['brushed potatoes'] },
  { id: 'onion', name: 'Brown onions', category: 'vegetables', unit: 'kg', brandTier: 'fresh', base: 2.5, keywords: ['brown onions'] },
  { id: 'carrot', name: 'Carrots', category: 'vegetables', unit: 'kg', brandTier: 'fresh', base: 2.2, keywords: ['carrots'] },
  { id: 'tomato', name: 'Tomatoes', category: 'vegetables', unit: 'kg', brandTier: 'fresh', base: 6.0, keywords: ['tomatoes loose'] },
  { id: 'broccoli', name: 'Broccoli', category: 'vegetables', unit: 'kg', brandTier: 'fresh', base: 6.9, keywords: ['broccoli'] },
  { id: 'lettuce', name: 'Iceberg lettuce', category: 'vegetables', unit: 'each', brandTier: 'fresh', base: 3.5, keywords: ['iceberg lettuce'] },
  { id: 'avocado', name: 'Avocado', category: 'vegetables', unit: 'each', brandTier: 'fresh', base: 1.5, keywords: ['avocado'] },
  { id: 'bananas', name: 'Bananas', category: 'vegetables', unit: 'kg', brandTier: 'fresh', base: 4.0, keywords: ['bananas'] },

  { id: 'diced-tomato', name: 'Diced tomatoes 400g', category: 'canned', unit: 'can', brandTier: 'private_label', base: 1.1, keywords: ['diced tomatoes 400g'] },
  { id: 'corn', name: 'Corn kernels 420g', category: 'canned', unit: 'can', brandTier: 'private_label', base: 1.6, keywords: ['corn kernels 420g'] },
  { id: 'chickpeas', name: 'Chickpeas 400g', category: 'canned', unit: 'can', brandTier: 'private_label', base: 1.2, keywords: ['chickpeas 400g'] },
  { id: 'baked-beans', name: 'Baked beans 420g', category: 'canned', unit: 'can', brandTier: 'branded', base: 2.2, keywords: ['baked beans 420g'] },
  { id: 'tuna', name: 'Tuna springwater 95g', category: 'canned', unit: 'can', brandTier: 'branded', base: 1.5, keywords: ['tuna in springwater 95g'] },

  { id: 'chicken-breast', name: 'Chicken breast fillet', category: 'meat', unit: 'kg', brandTier: 'fresh', base: 12.0, keywords: ['chicken breast fillet'] },
  { id: 'chicken-thigh', name: 'Chicken thigh fillet', category: 'meat', unit: 'kg', brandTier: 'fresh', base: 11.0, keywords: ['chicken thigh fillet'] },
  { id: 'whole-chicken', name: 'Whole chicken', category: 'meat', unit: 'kg', brandTier: 'fresh', base: 6.5, keywords: ['whole chicken'] },
  { id: 'beef-mince', name: 'Beef mince (regular)', category: 'meat', unit: 'kg', brandTier: 'fresh', base: 14.0, keywords: ['beef mince regular'] },
  { id: 'bacon', name: 'Bacon rashers', category: 'meat', unit: 'kg', brandTier: 'branded', base: 16.0, keywords: ['bacon rashers'] },

  { id: 'smiths-chips', name: "Smith's chips", category: 'snacks', unit: 'pack', brandTier: 'branded', base: 4.5, keywords: ["smith's original chips"] },
  { id: 'shapes', name: "Arnott's Shapes", category: 'snacks', unit: 'box', brandTier: 'branded', base: 3.8, keywords: ['arnotts shapes'] },
  { id: 'timtam', name: 'Tim Tam original', category: 'snacks', unit: 'pack', brandTier: 'branded', base: 4.5, keywords: ['tim tam original'] },
  { id: 'doritos', name: 'Doritos corn chips', category: 'snacks', unit: 'pack', brandTier: 'branded', base: 4.8, keywords: ['doritos'] },

  { id: 'cadbury', name: 'Cadbury Dairy Milk 180g', category: 'snacks', unit: 'block', brandTier: 'branded', base: 6.0, keywords: ['cadbury dairy milk 180g'] },
  { id: 'kitkat', name: 'KitKat 4 finger', category: 'snacks', unit: 'bar', brandTier: 'branded', base: 2.2, keywords: ['kitkat 4 finger'] },
  { id: 'snickers', name: 'Snickers bar', category: 'snacks', unit: 'bar', brandTier: 'branded', base: 2.0, keywords: ['snickers bar'] },
  { id: 'snakes', name: "Allen's Snakes Alive", category: 'snacks', unit: 'bag', brandTier: 'branded', base: 3.0, keywords: ['allens snakes alive'] },
  { id: 'lindt', name: 'Lindt block', category: 'snacks', unit: 'block', brandTier: 'branded', base: 6.5, keywords: ['lindt block'] },

  { id: 'milk', name: 'Full cream milk 2L', category: 'staples', unit: '2L', brandTier: 'private_label', base: 3.3, keywords: ['full cream milk 2l'] },
  { id: 'bread', name: 'White bread loaf', category: 'staples', unit: 'loaf', brandTier: 'private_label', base: 2.9, keywords: ['white bread 650g'] },
  { id: 'eggs', name: 'Eggs (dozen, free range)', category: 'staples', unit: 'dozen', brandTier: 'branded', base: 6.5, keywords: ['free range eggs 12'] },
  { id: 'butter', name: 'Butter 250g', category: 'staples', unit: 'pack', brandTier: 'branded', base: 6.9, keywords: ['butter 250g'] },
  { id: 'rice', name: 'Rice 1kg', category: 'staples', unit: 'kg', brandTier: 'private_label', base: 3.0, keywords: ['white rice 1kg'] },
  { id: 'pasta', name: 'Pasta 500g', category: 'staples', unit: 'pack', brandTier: 'private_label', base: 1.4, keywords: ['pasta 500g'] },
  { id: 'coffee', name: 'Instant coffee jar', category: 'staples', unit: 'jar', brandTier: 'branded', base: 9.5, keywords: ['instant coffee 100g'] },
]
