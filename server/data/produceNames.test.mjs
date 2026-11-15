// node --test server/  — produceNames.js against names seen in the 16 Sep
// 2026 Coles and Woolworths captures. Each case is a real product_name and
// the reading a shopper would give it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProduceName, sizeLabel, normaliseSize, pickItemName, sizeRank } from './produceNames.js'

const each = { soldBy: 'each', packageSize: 'each' }
const pack = (sz) => ({ soldBy: 'pack', packageSize: sz })
const weight = (sz) => ({ soldBy: 'weight', packageSize: sz })

// [raw, ctx, itemKey, sizeLabel, extra checks]
const CASES = [
  ['Woolworths Brushed Potatoes Bag', pack('2kg'), 'brushed|potato', '2kg bag', { packFormat: 'bag' }],
  ['Woolworths Brushed Potatoes Bag', pack('4kg'), 'brushed|potato', '4kg bag'],
  ['Potato Brushed', each, 'brushed|potato', 'each', { itemName: 'Brushed Potato' }],
  ['Brushed Potatoes', pack('2Kg'), 'brushed|potato', '2kg'],
  ['Royal Gala Apples 1kg', { soldBy: 'each', packageSize: '1 each' }, 'apple|gala|royal', '1kg', { nameWeight: '1kg', packFormat: 'pack' }],
  ['Royal Gala Apples Loose', weight('approx. 170g'), 'apple|gala|royal', 'approx. 170g loose', { packFormat: 'loose' }],
  ['Apple Royal Gala', each, 'apple|gala|royal', 'each', { itemName: 'Royal Gala Apple' }],
  ['Woolworths Fresh Pink Lady Apples Punnet', pack('1kg'), 'apple|lady|pink', '1kg punnet'],
  ['Pink Lady Apples Medium', weight('approx. 200g each'), 'apple|lady|pink', 'approx. 200g loose', { sizeGrade: 'medium' }],
  ['Apple Cosmic Crisp Md Apple Cosmic Crisp', each, 'apple|cosmic|crisp', 'each', { itemName: 'Cosmic Crisp Apple', sizeGrade: 'medium' }],
  ['Woolworths Asparagus Green Bunch', each, 'asparagus|green', 'bunch', { packFormat: 'bunch' }],
  ['Spring Onions', { soldBy: 'each', packageSize: '1 Bunch' }, 'spring_onion', 'bunch', { itemName: 'Spring Onions' }],
  ['Cabbage Half Drumhead White', { soldBy: 'each', packageSize: '1 each' }, 'cabbage|drumhead|white', 'each · half', { portion: 'half' }],
  ['Woolworths Green Cabbage Quarter', each, 'cabbage|green', 'each · quarter', { portion: 'quarter' }],
  ['Cabbage Green Whole', each, 'cabbage|green', 'each', { portion: 'whole', itemName: 'Green Cabbage' }],
  ['White Seedless Grapes Bag Approx. 900g', each, 'grape|seedless|white', '900g bag'],
  ['Lemons 5 Pack', { soldBy: 'each', packageSize: '1 Each' }, 'lemon', '5 pack', { multipack: 5 }],
  ['Lemon Lemon Bag', pack('500g'), 'lemon', '500g bag'],
  ['Woolworths Sweet Solanato Tomato Punnet Punnet', pack('200g'), 'solanato|sweet|tomato', '200g punnet'],
  ['Cara Cara Oranges', pack('2Kg'), 'cara_cara|orange', '2kg', { itemName: 'Cara Cara Oranges' }],
  ['Sweet Potato Gold', each, 'gold|sweet_potato', 'each', { itemName: 'Gold Sweet Potato' }],
  ['Woolworths Gold Sweet Potatoes Bag', pack('1kg'), 'gold|sweet_potato', '1kg bag'],
  ['Kiwi Fruit Green', each, 'green|kiwifruit', 'each', { itemName: 'Green Kiwifruit' }],
  ['Potato Salad', pack('250g'), 'potato|salad', '250g', { itemName: 'Potato Salad' }],
  ['Just Veg. Carrot Sticks', pack('150g'), 'carrot|stick', '150g', { itemName: 'Carrot Sticks' }],
  ['Sleeved Herbs Basil', { soldBy: 'each', packageSize: '1 Bunch' }, 'basil', 'bunch'],
  ["I'm Perfect Potatoes Imperfect", pack('4Kg'), 'imperfect|potato', '4kg', { imperfect: true }],
  ['The Odd Bunch Tomato Prepacked', pack('1kg'), 'imperfect|tomato', '1kg prepack', { imperfect: true }],
  ['Mushrooms Cups Loose', weight('per 200g'), 'cup|mushroom', 'per 200g loose'],
  ['Mandarin Amorette� Seedless', each, 'amorette|mandarin|seedless', 'each'],
  ['Bravo Apple Punnet', pack('750g'), 'apple|bravo', '750g punnet'],   // brand column says Bravo; the name keeps it
  // `organic` leaves the KEY and stays in the NAME. Woolworths says it in the
  // name, Coles in the brand column, so a key carrying the token could never
  // join the two. is_organic segments the item id instead.
  ['Macro Organic Beetroot Punnet', pack('1kg'), 'beetroot', '1kg punnet', { itemName: 'Organic Beetroot' }],
  ['Beetroot', pack('1kg'), 'beetroot', '1kg'],
  ['Macro Organic Pink Lady Apple Punnet', pack('1kg'), 'apple|lady|pink', '1kg punnet', { itemName: 'Organic Pink Lady Apple' }],
  ['Macro Organic Snow Peas', pack('200g'), 'snow_pea', '200g'],
  ['Organic Washed Potatoes 1kg', pack('1kg'), 'potato|washed', '1kg'],
]

for (const [raw, ctx, key, label, extra = {}] of CASES) {
  test(`${raw}  [${ctx.packageSize}]`, () => {
    const p = parseProduceName(raw, ctx)
    assert.equal(p.itemKey, key, 'itemKey')
    assert.equal(sizeLabel(p, ctx), label, 'sizeLabel')
    for (const [k, v] of Object.entries(extra)) assert.equal(p[k], v, k)
  })
}

test('normaliseSize', () => {
  assert.equal(normaliseSize('2Kg'), '2kg')
  assert.equal(normaliseSize('1 Each'), 'each')
  assert.equal(normaliseSize('approx. 2kg each'), 'approx. 2kg')
  assert.equal(normaliseSize('1 Bunch'), 'bunch')
  assert.equal(normaliseSize(''), '')
})

test('pickItemName prefers the common spelling, then the plural', () => {
  assert.equal(pickItemName(['Brushed Potato', 'Brushed Potatoes', 'Brushed Potatoes']), 'Brushed Potatoes')
  assert.equal(pickItemName(['Brushed Potato', 'Brushed Potatoes']), 'Brushed Potatoes')
  assert.equal(pickItemName([]), '')
})

// The pair this whole change exists for: the two spellings of one organic item
// at the two retailers have to land on one key.
test('both retailers spell organic differently and still share a key', () => {
  const w = parseProduceName('Macro Organic Beetroot Punnet', pack('1kg'))   // W says it in the name
  const c = parseProduceName('Beetroot', pack('1kg'))                        // C says it in brand
  assert.equal(w.itemKey, c.itemKey)
  assert.equal(w.itemKey, 'beetroot')
  assert.notEqual(w.itemName, c.itemName, 'the name still records which is which')
})

test('sizeRank orders by quantity, multipacks then loose last', () => {
  const r = ['each', '5 pack', '4kg bag', '250g punnet', 'approx. 170g loose'].map((s) => ({ sizeLabel: s, multipack: s === '5 pack' ? 5 : null }))
  assert.deepEqual(r.sort((a, b) => sizeRank(a) - sizeRank(b)).map((x) => x.sizeLabel), ['approx. 170g loose', '250g punnet', '4kg bag', '5 pack', 'each'])
})
