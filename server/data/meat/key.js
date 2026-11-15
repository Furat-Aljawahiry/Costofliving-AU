// The meat match key.
//
//   meat:<species>:<cut>[:<attr>...][:f-<flavour>...]
//
// e.g. meat:chicken:fillet-thigh · meat:beef:mince:grade_lean ·
//      meat:salmon:portion:skin_on · meat:chicken:kebab:f-honey_soy
//
// The group (`meat:<species>:<cut>`) is what a "related products" link uses;
// two listings share a KEY only when every attribute and every flavour agrees.
// Brand is not in it — the user's ruling, 18 Oct.

export function meatKeyFor(p) {
  const m = p.meat
  if (!m) return { key: null, group: null, variety: null, source: 'meat', kind: 'unparsed' }
  const group = m.species && m.cutKey ? `meat:${m.species}:${m.cutKey}` : null
  const variety = [...m.attrs, ...m.flavours.map((f) => `f-${f}`)].join(':') || 'plain'
  if (m.kind === 'out_of_scope' || m.kind === 'unparsed') {
    return { key: null, group: m.kind === 'unparsed' ? group : null, variety: null, source: 'meat', kind: m.kind }
  }
  const parts = [group, ...m.attrs, ...m.flavours.map((f) => `f-${f}`)]
  return { key: parts.join(':'), group, variety, source: 'meat', kind: m.kind }
}
