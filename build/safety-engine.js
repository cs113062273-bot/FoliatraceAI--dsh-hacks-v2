// FoliaTrace safety engine. Pure functions, no DOM, no network.
// Matches label wording to NIH (NCCIH) fact-sheet statements and the person's medicines.
// It never chooses between candidate species and never reports "safe".
import {medicineExclusion} from './medicine-language.js';

export const norm = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-')
  .replace(/×/g, 'x').toLowerCase().replace(/\s+/g, ' ').trim();

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = alias => new RegExp('(^|[^a-z0-9])' + escapeRe(norm(alias)).replace(/\\ /g, '[\\s-]+').replace(/'/g, "'?") + '(?=$|[^a-z0-9])', 'i');

export function levenshtein(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const tolerance = len => len >= 9 ? 2 : len >= 5 ? 1 : 0;

// ------------------------------------------------------------- knowledge index
export function indexKnowledge(kb) {
  const herbs = new Map(kb.herbs.map(h => [h.id, {...h, res: h.aliases.map(a => ({alias: a, re: wordRe(a)}))}]));
  const meds = new Map();
  for (const m of kb.medicines) for (const a of [m.name, ...m.aliases]) meds.set(norm(a), m);
  const ambiguous = kb.ambiguous.map(a => ({...a, re: new RegExp(a.pattern, 'i'), qre: new RegExp(a.qualified, 'i')}));
  const hints = kb.unverified_hints.map(h => ({hint: h, re: wordRe(h)}));
  return {kb, herbs, meds, ambiguous, hints};
}

// ------------------------------------------------------------------ products
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(mcg|µg|ug|mg|g|iu|ml|%)\b/i;

/** Discard only clear OCR debris and headings; short ingredient names stay visible. */
export function isLabelNoise(text) {
  const t = norm(text);
  return !/\p{L}/u.test(t)
    || /^(?:amount(?:\s+per\s+serving)?|supplement\s+facts)[\s:=_-]*$/i.test(t)
    || /^me(?:\s*[-_=]){2,}\s*$/i.test(t);
}

/** Parse free label text (typed, pasted or OCR) into ingredient lines. */
export function parseLabelText(text, name = 'Product') {
  const lines = String(text || '').split(/\r?\n|;|•|·/).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 1);
  const ingredients = []; let blend = null;
  for (const line of lines) {
    const amount = line.match(AMOUNT);
    const isBlend = /proprietary|blend|complex|matrix|formula\b/i.test(line);
    if (isBlend) {
      const [head, ...rest] = line.split(/:\s*/);
      blend = {name: head.replace(AMOUNT, '').replace(/[\-–\s]+$/, '').trim(), total: amount ? amount[0] : null};
      // Ingredients listed on the same line after a colon belong to the blend.
      const after = rest.join(':');
      if (after) for (const part of after.split(/,(?![^()]*\))/)) {
        const t = part.trim(); const a = t.match(AMOUNT);
        if (t.length > 1) ingredients.push({text: t, name: t.replace(AMOUNT, '').trim(), amount: a ? a[0] : null, blend: a ? null : blend.name, blendTotal: a ? null : blend.total});
      }
      continue;
    }
    if (/^(other ingredients|inactive|directions|suggested use|warning|caution|serving size|servings per|amount per|% ?daily|supplement facts|keep out|store)/i.test(line)) { blend = null; if (!/^(other ingredients|inactive)/i.test(line)) continue; ingredients.push({text: line, other: true}); continue; }
    for (const part of line.split(/,(?![^()]*\))/)) {
      const t = part.trim(); if (isLabelNoise(t)) continue;
      const a = t.match(AMOUNT);
      ingredients.push({text: t, name: t.replace(AMOUNT, '').replace(/\s+/g, ' ').trim() || t, amount: a ? a[0] : null, blend: blend && !a ? blend.name : null, blendTotal: blend && !a ? blend.total : null});
    }
  }
  return {name, source: 'text', ingredients, raw: String(text || '')};
}

/** Convert an NIH DSLD label record into the same product shape. */
export function fromDsldLabel(label) {
  const ingredients = [];
  const walk = (rows, blend) => {
    for (const r of rows || []) {
      const q = (r.quantity || [])[0];
      const amount = q && q.quantity ? `${q.quantity} ${q.unit || ''}`.trim() : null;
      const notes = r.notes || '';
      const genus = (notes.match(/Genus:\s*([A-Za-z]+)/) || [])[1] || null;
      const species = (notes.match(/Species:\s*([a-z][a-z-]+)/) || [])[1] || null;
      const part = (notes.match(/PlantPart:\s*([A-Za-z ,]+?)(?=\s+(?:Genus|Species|Form)|$)/) || [])[1] || null;
      const forms = (r.forms || []).map(f => f.name).filter(Boolean);
      const nested = r.nestedRows && r.nestedRows.length;
      if (nested) { walk(r.nestedRows, {name: r.name, total: amount}); continue; }
      ingredients.push({text: [r.name, notes, forms.join(' ')].filter(Boolean).join(' · '), name: r.name, category: r.category,
        amount, genus, species, part, blend: blend && !amount ? blend.name : null, blendTotal: blend && !amount ? blend.total : null});
    }
  };
  walk(label.ingredientRows);
  for (const o of (label.otheringredients?.ingredients || [])) ingredients.push({text: o.name, name: o.name, other: true});
  const statements = (label.statements || []).filter(s => /precaution|warning/i.test(s.type || '')).map(s => s.notes).filter(Boolean);
  return {name: label.fullName || 'NIH label', brand: label.brandName || '', source: 'dsld', dsldId: label.id,
    url: `https://dsld.od.nih.gov/label/${label.id}`, version: label.productVersionCode || null, upc: label.upcSku || null,
    offMarket: label.offMarket === 1, entered: (label.events || []).find(e => /entered/i.test(e.type))?.date || null,
    labelWarnings: statements, ingredients};
}

// -------------------------------------------------------------- herb matching
function matchFuzzy(textNorm, alias) {
  const words = textNorm.split(/[^a-z0-9']+/).filter(Boolean), aw = alias.split(' ');
  if (alias.length < 5) return false;
  for (let i = 0; i + aw.length <= words.length; i++) {
    const w = words.slice(i, i + aw.length).join(' ');
    if (Math.abs(w.length - alias.length) <= 2 && levenshtein(w, alias, 2) <= tolerance(alias.length)) return w;
  }
  return false;
}

/** Find NIH-covered herbs, ambiguous names and unverified botanicals in a product. */
export function identify(product, idx, {fuzzy = false} = {}) {
  const found = [];
  for (const [i, ing] of product.ingredients.entries()) {
    if (ing.other) continue;
    const t = norm(ing.text);
    const hit = new Set();
    // 1. Label-declared genus/species (DSLD) resolves identity directly.
    if (ing.genus) {
      const latin = norm(ing.genus + ' ' + (ing.species || ''));
      for (const h of idx.herbs.values()) {
        if (h.latin.some(l => norm(l).startsWith(latin.trim())) || h.res.some(r => r.alias === latin.trim())) {
          found.push({ingredient: i, herb: h.id, matched: `${ing.genus} ${ing.species || ''}`.trim(), basis: 'label_species'}); hit.add(h.id);
        }
      }
      if (!hit.size && ing.species) {
        found.push({ingredient: i, herb: null, unverified: `${ing.genus} ${ing.species}`, basis: 'label_species'}); continue;
      }
    }
    if (hit.size) continue;
    // 2. Ambiguous common names (never auto-resolved).
    let ambiguousHit = false;
    for (const a of idx.ambiguous) if (a.re.test(t) && !a.qre.test(t)) { found.push({ingredient: i, ambiguous: a.term, matched: a.term, basis: 'name'}); ambiguousHit = true; }
    // 3. Specific names/aliases.
    for (const h of idx.herbs.values()) {
      if (hit.has(h.id)) continue;
      let m = h.res.find(r => r.re.test(t));
      let how = 'name';
      if (!m && fuzzy) { for (const r of h.res) { const w = matchFuzzy(t, r.alias); if (w) { m = {alias: r.alias, read: w}; how = 'fuzzy'; break; } } }
      if (m) {
        // Qualified non-covered species such as "Siberian ginseng" must not map to Asian ginseng.
        if (h.id === 'asian-ginseng' && /siberian|eleuthero|american|quinquefolius|indian|brazilian|peruvian/.test(t)) continue;
        found.push({ingredient: i, herb: h.id, matched: m.alias, read: m.read, basis: how}); hit.add(h.id);
      }
    }
    if (hit.size || ambiguousHit) continue;
    // 4. Botanicals outside the verified set.
    const hint = idx.hints.find(h => h.re.test(t));
    if (hint) found.push({ingredient: i, herb: null, unverified: hint.hint, basis: 'name'});
    else if (ing.category === 'botanical') found.push({ingredient: i, herb: null, unverified: ing.name || ing.text, basis: 'label_category'});
    else found.push({ingredient: i, herb: null, unmatched: true});
  }
  return found;
}

// ----------------------------------------------------------------- medicines
/**
 * Dictionary first (exact, brand, typo). Only if that fails, an on-device AI reading of the phrase
 * (ai[input] = {group, score}, from ai-worker.js) maps it to a medicine group; such a medicine is
 * marked inferred, so every finding and question says the exact medicine still needs confirming.
 */
export function resolveMedicines(inputs, idx, ai = {}) {
  const groups = new Map((idx.kb.ai_medicine_groups?.groups || []).map(g => [g.id, g]));
  return inputs.map(s => String(s).trim()).filter(Boolean).map(input => {
    if (medicineExclusion(input)) return {input, known: false, classes: [], excluded: medicineExclusion(input)};
    const r = resolveOne(input, idx);
    if (r.known) return r;
    const a = ai[input]; const g = a && Number.isFinite(a.score) && a.score >= idx.kb.ai_medicine_groups.threshold && a.group && groups.get(a.group);
    return g ? {input, known: true, inferred: true, name: g.label, group: g.id, classes: g.classes, aiScore: a.score} : r;
  });
}
function resolveOne(input, idx) {
  {
    const n = norm(input).replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|units?|iu)\b/g, '').replace(/\b(tablet|tablets|daily|once|twice|er|xr|sr|hcl)\b/g, '').replace(/\s+/g, ' ').trim();
    let m = idx.meds.get(n);
    if (!m) for (const [k, v] of idx.meds) if (k.length > 3 && (n === k || n.startsWith(k + ' ') || n.endsWith(' ' + k) || n.includes(' ' + k + ' '))) { m = v; break; }
    let corrected = null;
    if (!m && n.length >= 5) {
      let best = 3;
      for (const [k, v] of idx.meds) { if (k.length < 5) continue; const d = levenshtein(n, k, 2); if (d <= tolerance(k.length) && d < best) { best = d; m = v; corrected = k; } }
    }
    return m ? {input, name: m.name, classes: m.classes, known: true, corrected} : {input, known: false, classes: []};
  }
}

// ------------------------------------------------------------------ analysis
const LEVEL_ORDER = {discuss: 0, caution: 1, note: 2};

/**
 * Findings are grouped: one card per herb x reason (same medicines / conditions),
 * holding one or more verbatim NIH quotes and every product that contains the herb.
 * Statements that apply only if an ambiguous name is a particular species are
 * returned inside that identity gap (gap.candidates[].findings), never in the main list.
 * @param {{products: object[], medicines: string[], conditions: string[], fuzzy?: boolean}} input
 */
export function analyze(input, idx) {
  const {kb} = idx;
  const meds = resolveMedicines(input.medicines || [], idx, input.aiMedicines || {});
  const conditions = new Set(input.conditions || []);
  const findings = [], gaps = [], checked = [], unmatched = [], perHerb = new Map();

  const add = (list, f) => {
    const medKey = (f.medicines || []).map(m => m.input).sort().join(','), condKey = (f.conditions || []).slice().sort().join(',');
    const key = [f.level, f.herb, f.because, medKey, condKey, f.variant || ''].join('|');
    const q = {text: f.quote, items: f.items || []};
    const existing = list.find(x => x.key === key);
    if (existing) {
      const eq = existing.quotes.find(x => x.text === q.text);
      if (eq) { for (const i of q.items) if (!eq.items.includes(i)) eq.items.push(i); } else existing.quotes.push(q);
      if (!existing.products.includes(f.productName)) existing.products.push(f.productName);
      return;
    }
    const {quote, items, productName, ...rest} = f;
    list.push({...rest, key, quotes: [q], products: [productName], medicines: f.medicines || [], conditions: f.conditions || []});
  };

  const applyHerb = (herbId, ctx, list) => {
    const h = idx.herbs.get(herbId); const src = kb.sources[h.source];
    const base = {herb: h.id, herbName: h.name, productName: ctx.productName, source: {url: src.url, title: src.title, updated: src.updated}};
    let flagged = false; const matchedMeds = new Set();
    const text = norm(ctx.ingredientText) + ' ' + norm(ctx.productText);
    for (const v of h.variants || []) if (new RegExp(v.pattern, 'i').test(text)) {
      add(list, {...base, level: v.level || 'note', quote: v.quote, because: 'variant', variant: v.label}); flagged = true;
    }
    for (const r of h.rules) {
      if ((r.meds || []).length) {
        const hits = meds.filter(m => m.classes.some(c => r.meds.includes(c)));
        // One card per medicine keeps "who" unambiguous in the brief.
        for (const m of hits) {
          const cls = m.classes.find(c => r.meds.includes(c));
          const item = r.items ? m.classes.map(c => r.items[c]).find(Boolean) : null;
          // "metformin is metformin" says nothing: fall back to a descriptive group the medicine belongs to.
          let label = m.inferred ? m.name : kb.class_labels[cls];
          if (!m.inferred && norm(label) === norm(m.name)) label = m.classes.map(c => kb.class_labels[c]).find(l => l && norm(l) !== norm(m.name) && /^an? /.test(l)) || null;
          add(list, {...base, level: r.level, quote: r.quote, items: item ? [item] : [], because: 'medicine', effect: r.effect,
            medicines: [{input: m.input, name: m.name, label, corrected: m.corrected, inferred: !!m.inferred, aiScore: m.aiScore}]});
          matchedMeds.add(m.input); flagged = true;
        }
      }
      const hitConds = (r.conditions || []).filter(c => conditions.has(c));
      if (hitConds.length) { add(list, {...base, level: r.level === 'discuss' ? 'discuss' : 'caution', quote: r.quote, because: 'condition', conditions: hitConds}); flagged = true; }
      if (!r.meds && !r.conditions && !r.always && r.level === 'note') add(list, {...base, level: 'note', quote: r.quote, because: 'label'});
    }
    // "Interacts with many medicines" statements: attach the medicines not already covered by a specific statement.
    for (const r of h.rules.filter(r => r.always)) {
      if (r.level !== 'discuss') {
        // Already shown for the person's own condition: don't repeat it as a general caution.
        if (!(r.conditions || []).some(c => conditions.has(c))) add(list, {...base, level: r.level, quote: r.quote, because: 'always', effect: r.effect});
        flagged = true; continue;
      }
      const rest = meds.filter(m => !matchedMeds.has(m.input));
      if (!meds.length) { add(list, {...base, level: 'caution', quote: r.quote, because: 'always', effect: r.effect}); flagged = true; }
      else if (rest.length) { add(list, {...base, level: 'discuss', quote: r.quote, because: 'always', effect: r.effect,
        medicines: rest.map(m => ({input: m.input, name: m.name || m.input, label: 'another medicine you take'}))}); flagged = true; }
    }
    return flagged;
  };

  for (const [pi, product] of (input.products || []).entries()) {
    const productText = product.ingredients.map(i => i.text).join(' ') + ' ' + (product.name || '');
    const found = identify(product, idx, {fuzzy: input.fuzzy || product.source === 'ocr'});
    const seenBlend = new Set();
    for (const f of found) {
      const ing = product.ingredients[f.ingredient];
      const ctx = {productName: product.name, ingredientText: ing.text, productText};
      const label = ing.name || ing.text;
      if (ing.blend && !seenBlend.has(label)) {
        seenBlend.add(label);
        const g = gaps.find(x => x.type === 'blend' && x.product === pi && x.blend === ing.blend);
        if (g) g.ingredients.push(label); else gaps.push({type: 'blend', product: pi, productName: product.name, ingredients: [label], blend: ing.blend, total: ing.blendTotal});
      }
      if (f.herb) {
        const flagged = applyHerb(f.herb, ctx, findings);
        const prior = perHerb.get(f.herb) || new Set(); prior.add(pi); perHerb.set(f.herb, prior);
        const herb = idx.herbs.get(f.herb);
        checked.push({product: pi, productName: product.name, ingredient: label, herb: f.herb, herbName: herb.name,
          basis: f.basis, matched: f.matched, read: f.read || null, flagged, amount: ing.amount || null,
          species: ing.genus ? `${ing.genus} ${ing.species || ''}`.trim() : null, identity_note: herb.identity_note || null,
          source: kb.sources[herb.source]});
      } else if (f.ambiguous) {
        const a = idx.ambiguous.find(x => x.term === f.ambiguous);
        const candidates = a.candidates.map(c => {
          const list = [];
          if (c.herb) applyHerb(c.herb, ctx, list);
          return {...c, findings: list.filter(x => x.level !== 'note'), flagged: list.some(x => x.level !== 'note')};
        });
        gaps.push({type: 'identity', product: pi, productName: product.name, ingredient: label, amount: ing.amount || null, term: a.term, candidates,
          source: a.source_page ? {url: kb.sources[a.source_page].url, quote: a.source_quote} : null});
      } else if (f.unverified) {
        gaps.push({type: 'unverified', product: pi, productName: product.name, ingredient: label, name: f.unverified});
      } else if (f.unmatched) {
        unmatched.push({product: pi, productName: product.name, ingredient: label});
      }
    }
  }
  for (const [herb, products] of perHerb) if (products.size > 1)
    gaps.push({type: 'duplicate', herb, herbName: idx.herbs.get(herb).name, products: [...products].map(p => input.products[p].name)});
  for (const m of meds) if (!m.known) gaps.push({type: 'unknown_medicine', input: m.input});
  for (const m of meds) if (m.inferred) gaps.push({type: 'inferred_medicine', input: m.input, label: m.name, score: m.aiScore});

  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.because === 'always') - (b.because === 'always') || a.herbName.localeCompare(b.herbName));
  for (const f of findings) f.question = askLine(f, kb);
  for (const g of gaps) for (const c of g.candidates || []) for (const f of c.findings) f.question = askLine(f, kb, c.species);
  const counts = {discuss: findings.filter(f => f.level === 'discuss').length, caution: findings.filter(f => f.level === 'caution').length,
    note: findings.filter(f => f.level === 'note').length, gaps: gaps.length, checked: checked.length,
    identity: gaps.filter(g => g.type === 'identity').length};
  return {findings, gaps, checked, unmatched, medicines: meds, conditions: [...conditions], counts, kbVersion: kb.version};
}

export function askLine(f, kb, ifSpecies = null) {
  const who = f.medicines.map(m => m.input).join(', ');
  const products = f.products.join(' and ');
  const herb = ifSpecies ? `${f.herbName} (if the label's ingredient is ${ifSpecies})` : f.herbName;
  if (f.because === 'medicine' && f.medicines[0]?.inferred) return `I take ${who}, which I think is ${f.medicines[0].label}. Which medicine is it exactly, and is it OK with the ${herb} in ${products}?`;
  if (f.because === 'medicine') return `I take ${who}. ${products} contains ${herb}. Should I take them together, and is there anything to watch for?`;
  if (f.because === 'always' && who) return `${products} contains ${herb}, which NIH says interacts with many medicines. Could it affect ${who}?`;
  if (f.because === 'condition') return `${f.conditions.map(c => kb.conditions[c]).join('; ')}: is the ${herb} in ${products} appropriate for me?`;
  if (f.because === 'variant') return `${products} uses a “${f.variant.toLowerCase()}” form of ${f.herbName}. Does that change anything for me?`;
  if (f.because === 'label') return `Can we check the quality and contents of the ${f.herbName} in ${products}?`;
  return `Is the ${herb} in ${products} right for me?`;
}
