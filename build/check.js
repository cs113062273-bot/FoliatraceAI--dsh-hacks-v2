import {indexKnowledge, parseLabelText, fromDsldLabel, analyze, resolveMedicines, norm} from './safety-engine.js';
import {EXAMPLES} from './safety-examples.js';
import {researchQueries} from './research-evidence.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const DSLD = 'https://api.ods.od.nih.gov/dsld/v9/';
const STORE = 'foliatrace.check.v2';
let saveAllowed = !location.hash.startsWith('#brief=');

let kb, idx, result = null, ocrWorker = null, ocrPending = false;
const state = {products: [], medicines: [], conditions: [], example: null, aiMeds: {}, reason: ''};

function save() { if (!saveAllowed) return; try { localStorage.setItem(STORE, JSON.stringify({...state, aiVersion: 2})); } catch {} }
function cleanAi(a) {
  const out = {};
  for (const [k, v] of Object.entries(a && typeof a === 'object' ? a : {}).slice(0, 40)) {
    if (typeof k === 'string' && k.length <= 80 && v && typeof v === 'object') out[k] = {group: typeof v.group === 'string' && kb.ai_medicine_groups.groups.some(g => g.id === v.group) ? v.group : null, score: Number(v.score) || 0};
  }
  return out;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && Array.isArray(s.products) && s.products.length <= 12 && Array.isArray(s.medicines) && s.medicines.length <= 40) {
      state.products = s.products.filter(p => p && typeof p.name === 'string' && Array.isArray(p.ingredients) && p.ingredients.length <= 120);
      state.medicines = s.medicines.filter(m => typeof m === 'string' && m.length <= 80);
      state.conditions = (s.conditions || []).filter(c => kb.conditions[c]);
      state.aiMeds = s.aiVersion === 2 ? cleanAi(s.aiMeds) : {}; state.reason = typeof s.reason === 'string' ? s.reason.slice(0, 120) : '';
    }
  } catch {}
}

// ------------------------------------------------------------- on-device AI
// 1. Language understanding (ai-worker.js, all-MiniLM-L6-v2): how a person describes a medicine.
// 2. Research ranking (model-search-worker.js, MiniLM cross-encoder): studies for each herb and reason.
function workerClient(file) {
  let w = null, seq = 0; const waiting = new Map();
  return (msg, onProgress) => {
    if (!w) {
      w = new Worker(new URL(file, location.href), {type: 'module'});
      w.onmessage = ({data}) => { const p = waiting.get(data.id); if (!p) return; if (data.type === 'progress') { p.onProgress?.(data.text); return; } waiting.delete(data.id); data.type === 'error' ? p.reject(Error(data.text)) : p.resolve(data); };
      w.onerror = () => { for (const p of waiting.values()) p.reject(Error('on-device AI could not start')); waiting.clear(); w = null; };
    }
    const id = ++seq; return new Promise((resolve, reject) => { waiting.set(id, {resolve, reject, onProgress}); w.postMessage({...msg, id}); });
  };
}
const understandAI = workerClient('ai-worker.js');
const researchAI = workerClient('model-search-worker.js');
let aiBusy = false, aiPending = Promise.resolve();
const aiInFlight = new Set();
function understandMedicines() {
  const todo = resolveMedicines(state.medicines, idx).filter(m => !m.known && !m.excluded && !(m.input in state.aiMeds) && !aiInFlight.has(m.input)).map(m => m.input);
  if (!todo.length) return aiPending;
  aiBusy = true; renderMeds();
  todo.forEach(t => aiInFlight.add(t));
  aiPending = aiPending.then(() => understandAI({type: 'classify', texts: todo, threshold: kb.ai_medicine_groups.threshold, margin: kb.ai_medicine_groups.margin,
    groups: kb.ai_medicine_groups.groups}))
    .then(({results}) => { let changed = false; for (const r of results) if (state.medicines.includes(r.text)) { state.aiMeds[r.text] = {group: r.group, score: r.score}; changed = true; } if (changed) save(); })
    .catch(() => { $('#run-hint').textContent = 'Medicine AI is unavailable. Enter the exact name, or keep it as a question for your pharmacist.'; })
    .finally(() => { todo.forEach(t => aiInFlight.delete(t)); aiBusy = aiInFlight.size > 0; renderMeds(); });
  return aiPending;
}

// ------------------------------------------------------------------ rendering
function renderExamples() {
  const box = $('#example-list'); box.replaceChildren();
  for (const ex of EXAMPLES) {
    const b = el('button', undefined, 'example'); b.type = 'button'; b.dataset.example = ex.id;
    const meds = ex.medicines.map(m => m.replace(/\s*\d+\s*mg/i, '')).join(' + ');
    b.innerHTML = `<span class="ex-name">${esc(ex.person)}</span><span class="ex-story">${esc(ex.story)}</span><span class="ex-meta">${esc(meds)} · ${ex.products.length} product${ex.products.length > 1 ? 's' : ''}</span><span class="ex-go" aria-hidden="true">Run check →</span>`;
    b.setAttribute('aria-label', `Run the check for ${ex.person}: ${ex.story}`);
    b.onclick = () => runExample(ex.id);
    box.append(b);
  }
}

function runExample(id) {
  invalidateBrief();
  const ex = EXAMPLES.find(e => e.id === id);
  state.products = ex.products.map(p => ({...parseLabelText(p.text, p.name), fictional: true}));
  state.medicines = [...ex.medicines]; state.conditions = [...ex.conditions]; state.example = ex.id; state.reason = ex.reason || '';
  $('#reason-input').value = state.reason;
  save(); renderAll(); runCheck(true);
}

function renderProducts() {
  const box = $('#product-list'); box.replaceChildren();
  if (!state.products.length) { box.append(el('p', 'No product yet. Search NIH, paste the label, or photograph it.', 'small empty')); }
  for (const [i, p] of state.products.entries()) {
    const card = el('article', undefined, 'product-card');
    const head = el('div', undefined, 'product-head');
    head.append(el('strong', p.name));
    const src = p.source === 'dsld' ? `NIH label #${p.dsldId}${p.brand ? ' · ' + p.brand : ''}` : p.source === 'ocr' ? 'Read from your photo' : p.fictional ? 'Fictional example label' : 'Typed label text';
    head.append(el('span', src, 'badge ' + (p.source === 'dsld' ? 'badge-nih' : '')));
    const active = p.ingredients.filter(x => !x.other);
    card.append(head, el('p', active.slice(0, 6).map(x => x.name || x.text).join(' · ') + (active.length > 6 ? ` · +${active.length - 6} more` : ''), 'small ingredients-line'));
    const rm = el('button', 'Remove', 'quiet small-btn'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + p.name);
    rm.onclick = () => { invalidateBrief(); state.products.splice(i, 1); state.example = null; save(); renderAll(); };
    if (p.url) { const a = el('a', 'View NIH record ↗'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'small'; card.append(a); }
    card.append(rm);
    box.append(card);
  }
}

function renderMeds() {
  const box = $('#med-list'); box.replaceChildren();
  const resolved = resolveMedicines(state.medicines, idx, state.aiMeds);
  for (const [i, m] of resolved.entries()) {
    const pending = !m.known && aiBusy && !(m.input in state.aiMeds);
    const li = el('li', undefined, 'chip ' + (m.inferred ? 'ai' : m.known ? 'known' : pending ? 'pending' : 'unknown'));
    li.append(el('span', m.input));
    if (m.inferred || pending) li.append(el('span', 'AI', 'pill pill-ai'));
    li.append(el('span', m.inferred ? `suggests ${m.name} · confirm` : pending ? 'AI is reading…' : m.known ? (m.corrected ? `read as ${m.name}` : (norm(m.input).startsWith(m.name) ? '✓' : m.name)) : m.excluded === 'not_current' ? 'confirm if currently taken' : 'not recognised', 'chip-note'));
    const x = el('button', '×', 'chip-x'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + m.input);
    x.onclick = () => { invalidateBrief(); state.medicines.splice(i, 1); state.example = null; save(); renderAll(); };
    li.append(x); box.append(li);
  }
}

function renderConditions() {
  const box = $('#condition-list'); box.replaceChildren();
  for (const [id, label] of Object.entries(kb.conditions)) {
    const l = el('label', undefined, 'check'); const c = el('input'); c.type = 'checkbox'; c.value = id; c.checked = state.conditions.includes(id);
    c.onchange = () => { invalidateBrief(); state.conditions = [...box.querySelectorAll('input:checked')].map(x => x.value); state.example = null; save(); };
    l.append(c, el('span', label)); box.append(l);
  }
  if (state.conditions.length) $('#conditions-box').open = true;
}

function renderAll() {
  renderProducts(); renderMeds(); renderConditions();
  for (const b of document.querySelectorAll('.example')) b.setAttribute('aria-pressed', String(b.dataset.example === state.example));
  $('#run-check').disabled = !state.products.length;
  $('#run-hint').textContent = state.products.length ? `${state.products.length} product${state.products.length > 1 ? 's' : ''} · ${state.medicines.length} medicine${state.medicines.length === 1 ? '' : 's'} ready to check.` : 'Add at least one product.';
}

// ---------------------------------------------------------------- brief HTML
const LEVEL_TAG = {discuss: 'Discuss before combining', caution: 'Ask about this', note: 'Label & quality'};
const fmtQuote = q => `“${esc(q.text)}”${q.items.length ? `<span class="nih-item">NIH’s list includes: <q>${q.items.map(esc).join('</q>, <q>')}</q></span>` : ''}`;

function findingTitle(f) {
  const herb = esc(f.herbName);
  if (f.because === 'medicine') return `${herb} <span class="x">×</span> ${esc(f.medicines[0].input)}`;
  if (f.because === 'always') return `${herb} interacts with many medicines`;
  if (f.because === 'condition') return `${herb} <span class="x">·</span> ${f.conditions.map(c => esc(kb.conditions[c])).join('; ')}`;
  if (f.because === 'variant') return `${herb}: ${esc(f.variant)}`;
  if (f.because === 'label') return `${herb}: what the label may not tell you`;
  return herb;
}
function findingSub(f) {
  const parts = [`In ${f.products.map(esc).join(' and ')}`];
  if (f.because === 'medicine') { const m = f.medicines[0]; if (m.inferred) parts.push(`<span class="pill pill-ai">AI</span> understood “${esc(m.input)}” as ${esc(m.label)}`); else if (m.label) parts.push(`${esc(m.corrected ? m.name : m.input)} is ${esc(m.label)}`); else if (m.corrected) parts.push(`read as ${esc(m.name)}`); }
  if (f.because === 'always' && f.medicines.length) parts.push(`Also ask about: ${f.medicines.map(m => esc(m.input)).join(', ')}`);
  return parts.join(' · ');
}
function sourceLine(s) {
  return `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">NIH · ${esc(s.title.replace(/\s*\|\s*NCCIH$/, ''))}</a>${s.updated ? ` · page updated ${esc(s.updated)}` : ''}`;
}
function findingHTML(f, compact = false) {
  return `<article class="finding ${f.level}"><header><span class="tag">${LEVEL_TAG[f.level]}</span><h4>${findingTitle(f)}</h4><p class="small">${findingSub(f)}</p></header>
  ${f.quotes.map(q => `<blockquote class="nih"><p>${fmtQuote(q)}</p></blockquote>`).join('')}
  <p class="nih-source small">${sourceLine(f.source)}</p>${compact ? '' : `<p class="ask"><strong>Ask:</strong> ${esc(f.question)}</p>`}</article>`;
}

function gapHTML(g) {
  if (g.type === 'identity') {
    const cands = g.candidates.map(c => {
      let body;
      if (c.herb && c.findings.length) body = c.findings.map(f => `<div class="if-finding"><p>${fmtQuote(f.quotes[0])}</p><p class="small">${sourceLine(f.source)}</p><p class="ask"><strong>Ask:</strong> ${esc(f.question)}</p></div>`).join('');
      else if (c.herb) body = '<p class="small">No NIH statement for your medicines.</p>';
      else body = '<p class="small">Not covered — ask your pharmacist.</p>';
      return `<li><p><strong><i>${esc(c.species)}</i></strong> · ${esc(c.common)}${c.flagged ? ' <span class="pill pill-warn">applies to you</span>' : ''}</p>${body}</li>`;
    }).join('');
    return `<article class="gap identity"><h4>“${esc(g.ingredient)}” — which ${esc(g.term)}?</h4><p class="small">In ${esc(g.productName)}. This name fits more than one plant.</p><ul class="candidates">${cands}</ul><p class="ask"><strong>Ask:</strong> Which species is the “${esc(g.ingredient)}” in ${esc(g.productName)}?</p></article>`;
  }
  if (g.type === 'blend') return `<li><strong>${g.ingredients.map(esc).join(', ')}</strong> ${g.ingredients.length > 1 ? 'are' : 'is'} inside “${esc(g.blend)}”${g.total ? ` (${esc(g.total)} in total)` : ''}: amount of each not stated.</li>`;
  if (g.type === 'unverified') return `<li><strong>${esc(g.ingredient)}</strong>: not covered — ask your pharmacist.</li>`;
  if (g.type === 'duplicate') return `<li><strong>${esc(g.herbName)}</strong> is in ${g.products.length} products: ${g.products.map(esc).join(', ')}.</li>`;
  if (g.type === 'unknown_medicine') return `<li>We did not recognise the medicine <strong>${esc(g.input)}</strong> — tell your pharmacist.</li>`;
  if (g.type === 'inferred_medicine') return `<li><span class="pill pill-ai">AI</span> understood <strong>${esc(g.input)}</strong> as ${esc(g.label)}. Confirm the exact medicine with your pharmacist.</li>`;
  return '';
}

function briefHTML(r, opts = {meds: true, conditions: true, ingredients: true}, forPrint = false, qr = '') {
  const main = r.findings.filter(f => f.level !== 'note'), notes = r.findings.filter(f => f.level === 'note');
  const ident = r.gaps.filter(g => g.type === 'identity'), other = r.gaps.filter(g => g.type !== 'identity');
  let h = '';
  if (forPrint) {
    // qr is an SVG generated locally from our own base64url link; it contains no user-supplied markup.
    h += `<header class="print-head">${qr ? `<div class="print-qr">${qr}<span>Scan to open this brief with live NIH links</span></div>` : ''}<h1>Pharmacist brief</h1><p>Prepared ${esc(new Date().toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'}))} with FoliaTrace · ${r.counts.discuss} to discuss · ${r.counts.caution} cautions · ${r.gaps.length} label questions · for discussion with a pharmacist or clinician · not medical advice</p></header>`;
    if (opts.meds) h += `<p><strong>Medicines I take:</strong> ${r.medicines.length ? r.medicines.map(m => esc(m.input) + (m.inferred ? ` (AI: ${esc(m.name)}, to confirm)` : m.known && m.corrected ? ` (read as ${esc(m.name)})` : '')).join(', ') : 'none entered'}</p>`;
    if (state.reason) h += `<p><strong>I take the supplements for:</strong> ${esc(state.reason)}</p>`;
    if (opts.conditions && r.conditions.length) h += `<p><strong>About me:</strong> ${r.conditions.map(c => esc(kb.conditions[c])).join('; ')}</p>`;
    h += '<h2>Products</h2>' + state.products.map(p => `<div class="print-product"><strong>${esc(p.name)}</strong>${p.brand ? ' · ' + esc(p.brand) : ''}${p.source === 'dsld' ? ` · NIH DSLD label #${esc(p.dsldId)}` : p.fictional ? ' · fictional example' : p.source === 'ocr' ? ' · text read from photo' : ''}${opts.ingredients ? `<p class="small">${p.ingredients.filter(x => !x.other).map(x => esc(x.text.split(' · ')[0])).join('; ')}</p>` : ''}</div>`).join('');
  }
  const inferred = r.medicines.filter(m => m.inferred);
  if (opts.meds && inferred.length) h += `<section class="brief-sec ai-understanding"><h3><span class="pill pill-ai">AI</span> From your words to a medicine group</h3>${inferred.map(m => `<p><strong>“${esc(m.input)}”</strong> → ${esc(m.name)}</p>`).join('')}<p class="small">A suggested group, not an identified medicine. Confirm the exact name with your pharmacist.</p></section>`;
  h += `<section class="brief-sec"><h3>${main.length ? 'Raise these first' : 'Nothing NIH names for your medicines'}</h3>`;
  h += main.length ? `<div class="findings">${main.map(f => findingHTML(f)).join('')}</div>` : `<p>That doesn’t mean safe — NIH: “${esc(kb.general_quote)}”</p>`;
  h += '</section>';
  if (ident.length || other.length) {
    h += `<section class="brief-sec"><h3>What the label doesn’t settle</h3>${ident.map(gapHTML).join('')}${other.length ? `<ul class="gap-list">${other.map(gapHTML).join('')}</ul>` : ''}</section>`;
  }
  h += forPrint ? researchPrintHTML() : '<section class="brief-sec ai-sec" id="ai-research" aria-live="polite"></section>';
  if (notes.length) h += `<section class="brief-sec"><h3>Label &amp; product quality notes</h3><div class="findings">${notes.map(f => findingHTML(f, true)).join('')}</div></section>`;
  const rows = r.checked.map(c => `<tr><th scope="row">${esc(c.ingredient.split(' · ')[0])}${c.amount ? `<span class="small"> · ${esc(c.amount)}</span>` : ''}<br><span class="small">${esc(c.productName)}</span></th><td><a href="${esc(c.source.url)}" target="_blank" rel="noopener noreferrer">${esc(c.herbName)}</a>${c.basis === 'label_species' ? `<br><span class="pill">label states <i>${esc(c.species)}</i></span>` : ''}${c.basis === 'fuzzy' ? `<br><span class="pill">read from photo as “${esc(c.read)}”</span>` : ''}${c.identity_note ? `<br><span class="small">${esc(c.identity_note)}</span>` : ''}</td><td>${c.flagged ? 'See above' : 'Nothing for you'}${forPrint ? '' : `<br><button type="button" class="link research" data-herb="${esc(c.herbName)}">Research this herb →</button>`}</td></tr>`).join('');
  const others = (r.unmatched || []).map(u => esc(u.ingredient.split(' · ')[0]));
  if (rows || others.length) h += `<section class="brief-sec"><h3>Everything we checked</h3>${rows ? `<div class="table-wrap"><table class="checked"><thead><tr><th scope="col">On the label</th><th scope="col">NIH fact sheet</th><th scope="col">For you</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}${others.length ? `<p class="small unmatched">Not checked: ${others.join('; ')}.</p>` : ''}</section>`;
  h += `<p class="small foot">Quotes from NIH NCCIH fact sheets (public domain), retrieved ${esc(kb.built)}. No statement does not mean safe. Not medical advice.</p>`;
  return h;
}

function summaryHTML(r) {
  const n = (v, label, cls) => `<p class="sum ${cls}"><strong>${v}</strong><span>${label}</span></p>`;
  return n(r.counts.discuss, 'to discuss before combining', 'sum-discuss')
    + n(r.counts.caution, r.counts.caution === 1 ? 'caution for you' : 'cautions for you', 'sum-caution')
    + n(r.gaps.length, r.gaps.length === 1 ? 'label question' : 'label questions', 'sum-gap')
    + n(r.checked.length, (r.checked.length === 1 ? 'herb' : 'herbs') + ' checked', 'sum-checked');
}

// ------------------------------------------------ AI research leads in the brief
let leads = [], leadsToken = 0, checkToken = 0;
function invalidateBrief() {
  ++checkToken; ++leadsToken; leads = []; result = null;
  $('#brief').hidden = true; delete $('#brief').dataset.leads;
  $('#handoff').hidden = true;
  $('#run-check').textContent = 'Build my brief →';
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  $('#download-brief').removeAttribute('href');
}
const LEAD_MIN = 2.0; // raw cross-encoder logit, calibrated on demo development queries; not a probability
const coreName = n => n.replace(/\s*\/.*$/, '').replace(/\s+(oil|extract|root)$/i, '').trim();
function researchPrintHTML() {
  const shown = leads.filter(l => l.rows.length);
  if (!shown.length) return '';
  return `<section class="brief-sec"><h3>Research leads, ranked by on-device AI</h3>${shown.map(l => `<p><strong>${esc(l.herb)}</strong>${l.query ? ` · ${esc(state.reason)}` : ''}</p><ul>${l.rows.map(r => `<li><a href="${esc(r.url)}">${esc(r.title.replace(/<[^>]*>/g, ''))}</a></li>`).join('')}</ul>`).join('')}<p class="small">Reading leads for the pharmacist, not a verdict on benefit or safety.</p></section>`;
}
function leadHTML(row, lead) {
  const bottle = (result?.checked || []).filter(c => c.herb === lead.herbId).map(c => `${c.ingredient}${c.amount ? ' · ' + c.amount : ''} (${c.productName})`).join('; ');
  return `<li><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.title.replace(/<[^>]*>/g, ''))}</a><p class="small">AI matched to: ${esc(row.goal)}</p><details class="lead-context"><summary>Compare source wording with your bottle</summary><p><strong>Your label:</strong> ${esc(bottle)}</p>${(row.context || []).map(c => `<h5>${esc(c.label)}</h5>${c.span ? `<blockquote>${esc(c.span.text)}</blockquote>` : '<p class="small">No excerpt identified; read the abstract.</p>'}`).join('')}<p class="small">Literal abstract excerpts · ${esc(row.licence)}. Text cues only; your pharmacist checks whether the study applies.</p></details></li>`;
}
function renderLeads(status) {
  const box = $('#ai-research'); if (!box) return;
  const rows = leads.map(l => `<article class="lead-group"><h4>${esc(l.herb)}${state.reason ? ` <span class="small">· for ${esc(state.reason)}</span>` : ''}</h4>${
    l.pending ? '<p class="small">AI is ranking…</p>' : l.rows.length ? `<ol>${l.rows.map(r => leadHTML(r, l)).join('')}</ol>`
    : `<p class="small">${l.error ? 'On-device research is unavailable. Retry by rebuilding the brief.' : 'No closely matching study in the on-device library.'}</p>`}</article>`).join('');
  box.innerHTML = `<h3><span class="pill pill-ai">AI</span> Research leads, ranked on your device</h3><p class="small ai-status">${esc(status)}</p><div class="leads">${rows}</div>`;
}
async function runResearch(r) {
  const token = ++leadsToken;
  const reason = state.reason;
  const herbs = [...new Map(r.checked.map(c => [c.herb, c])).values()].slice(0, 6);
  leads = herbs.map(c => ({herbId: c.herb, herb: coreName(c.herbName), rows: [], pending: true, query: !!state.reason}));
  if (!leads.length) { renderLeads(''); return; }
  renderLeads('AI is ranking the on-device research library…');
  const t0 = performance.now();
  for (const l of leads) {
    const h = idx.herbs.get(l.herbId);
    const names = [l.herb, ...h.latin, ...h.aliases.filter(a => a.length >= 6)].map(norm);
    try {
      const found = new Map(); l.all = [];
      for (const {goal, query} of researchQueries(l.herb, reason)) {
        const res = await researchAI({query, method: 'ai', herbNames: names, patientLeads: true}, () => {});
        if (token !== leadsToken) return;
        l.all.push(...res.rows.map(row => ({id: row.id, title: row.title, score: row.score, goal})));
        for (const row of res.rows) if (row.score >= LEAD_MIN && names.some(n => norm(row.title + ' ' + row.abstract).includes(n)) && row.score > (found.get(row.id)?.score ?? -Infinity)) found.set(row.id, {...row, goal});
      }
      l.rows = [...found.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 2);
    } catch { if (token !== leadsToken) return; l.rows = []; l.error = true; }
    l.pending = false;
    renderLeads(`AI is ranking on this device… ${leads.filter(x => !x.pending).length} of ${leads.length} herbs done`);
  }
  renderLeads(`${leads.some(l => l.error) ? 'Research incomplete' : 'Ranked'} on this device in ${((performance.now() - t0) / 1000).toFixed(1)} s. Reading leads for the pharmacist. Study populations and preparations may differ from your bottle.`);
  $('#brief').dataset.leads = leads.reduce((n, l) => n + l.rows.length, 0);
  $('#brief').dataset.research = JSON.stringify(leads.map(l => ({herb: l.herb, all: l.all, shown: l.rows.map(r => ({id: r.id, score: r.score, goal: r.goal}))})));
  updateDownload();
}

async function runCheck(scroll = true) {
  if (!state.products.length) return;
  const token = ++checkToken; ++leadsToken; leads = [];
  $('#run-check').disabled = true; $('#run-check').textContent = 'Understanding your medicines…';
  understandMedicines(); await aiPending;
  if (token !== checkToken || !state.products.length) return;
  result = analyze({products: state.products, medicines: state.medicines, conditions: state.conditions, aiMedicines: state.aiMeds}, idx);
  $('#brief-summary').innerHTML = summaryHTML(result);
  $('#brief-body').innerHTML = briefHTML(result);
  $('#brief-foot').textContent = '';
  $('#brief').hidden = false;
  $('#run-check').disabled = false; $('#run-check').textContent = 'Build my brief →';
  $('#brief').dataset.discuss = result.counts.discuss;
  for (const b of document.querySelectorAll('#brief .research')) b.onclick = () => window.dispatchEvent(new CustomEvent('foliatrace:research', {detail: `${b.dataset.herb} clinical trial`}));
  updateDownload();
  if (scroll) { $('#brief').scrollIntoView({block: 'start'}); $('#brief').focus({preventScroll: true}); }
  runResearch(result);
}

let downloadUrl = null;
function shareOpts() { return {meds: $('#share-meds').checked, conditions: $('#share-conditions').checked, ingredients: $('#share-ingredients').checked}; }
function standalone(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pharmacist brief · FoliaTrace</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}
// The QR (which carries everything) is only added when everything is chosen for sharing.
async function printQr() { const o = shareOpts(); if (!(o.meds && o.conditions && o.ingredients)) return ''; try { return await qrSvg(await shareLink()); } catch { return ''; } }
let downloadSeq = 0;
async function updateDownload() {
  if (!result) return;
  const seq = ++downloadSeq; const opts = shareOpts(); const qr = await printQr();
  if (seq !== downloadSeq) return;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([standalone(briefHTML(result, opts, true, qr))], {type: 'text/html;charset=utf-8'}));
  $('#download-brief').href = downloadUrl;
  $('#handoff').hidden = true;
}
const PRINT_CSS = `.print-qr{float:right;width:132px;text-align:center;font:11px/1.3 system-ui;color:#46574e;margin:0 0 8px 16px}.print-qr svg{width:132px;height:132px;display:block}`
 + `body{font:12.5px/1.42 Georgia,serif;color:#1d2f27;max-width:780px;margin:18px auto;padding:0 18px}h1{font-size:24px;margin:0}h2{font-size:15px;border-bottom:1px solid #999;margin:12px 0 4px}h3{font-size:14.5px;margin:12px 0 4px}h4{font-size:13.5px;margin:2px 0}p{margin:3px 0}.small,.print-head p{font-size:11px;color:#46574e}.finding,.gap{border:1px solid #bbb;border-left:4px solid #888;border-radius:4px;padding:5px 10px;margin:5px 0;break-inside:avoid}.finding.discuss{border-left-color:#a8432f}.finding.caution{border-left-color:#b17d1a}.finding header p{margin:0}.tag{font:700 9.5px/1 system-ui;letter-spacing:.08em;text-transform:uppercase}blockquote{margin:3px 0;padding:1px 8px;border-left:2px solid #ccc;font-style:italic}.nih-item{display:block;font-style:normal;font-size:11px}.nih-source{margin:0}.ask{background:#f3f1e8;padding:3px 8px;border-radius:3px;margin-top:3px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border-top:1px solid #ccc;padding:3px 5px;text-align:left;vertical-align:top}.pill{font-size:10px;border:1px solid #999;border-radius:3px;padding:0 3px}ul{padding-left:18px;margin:4px 0}li{margin:2px 0}.candidates>li{border-top:1px dashed #ccc;padding:3px 0}.if-finding{border-left:2px solid #b17d1a;padding-left:8px}a{color:#24543e}.foot{margin-top:12px;border-top:1px solid #999;padding-top:6px;font-size:10.5px}.print-product p{margin:0 0 4px}button{display:none}`;

// ------------------------------------------------- serverless pharmacist link
// The brief travels inside the URL fragment (#brief=…), which browsers never send to a server.
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
async function encodeBrief() {
  const compact = {v: 1, m: state.medicines, c: state.conditions, r: state.reason || undefined,
    a: Object.fromEntries(Object.entries(state.aiMeds).filter(([k, v]) => v.group && state.medicines.includes(k)).map(([k, v]) => [k, [v.group, v.score]])), p: state.products.map(p => ({n: p.name, s: p.source, b: p.brand || undefined, d: p.dsldId || undefined, f: p.fictional ? 1 : undefined,
    i: p.ingredients.filter(x => !x.other).map(x => [String(x.text).slice(0, 160), x.name || '', x.amount || '', x.genus || '', x.species || '', x.blend || '', x.blendTotal || '', x.category || ''])}))};
  return b64url(await pipe(new TextEncoder().encode(JSON.stringify(compact)), new CompressionStream('deflate-raw')));
}
async function decodeBrief(token) {
  if (token.length > 6000) throw Error('link too long');
  const data = JSON.parse(new TextDecoder().decode(await pipe(unb64url(token), new DecompressionStream('deflate-raw'))));
  if (data.v !== 1 || !Array.isArray(data.p) || data.p.length > 12) throw Error('unsupported brief');
  const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  return {
    medicines: (data.m || []).filter(x => typeof x === 'string').slice(0, 40).map(x => x.slice(0, 80)),
    conditions: (data.c || []).filter(c => kb.conditions[c]),
    reason: str(data.r, 120),
    aiMeds: cleanAi(Object.fromEntries(Object.entries(data.a && typeof data.a === 'object' ? data.a : {}).map(([k, v]) => [k, {group: Array.isArray(v) ? v[0] : null, score: Array.isArray(v) ? v[1] : 0}]))),
    products: data.p.map(p => ({name: str(p.n, 120) || 'Product', source: ['dsld', 'ocr', 'text'].includes(p.s) ? p.s : 'text', brand: str(p.b, 80), dsldId: Number.isInteger(p.d) ? p.d : undefined,
      url: Number.isInteger(p.d) ? `https://dsld.od.nih.gov/label/${p.d}` : undefined, fictional: !!p.f,
      ingredients: (p.i || []).slice(0, 120).map(r => ({text: str(r[0], 160), name: str(r[1], 160) || undefined, amount: str(r[2], 40) || null, genus: str(r[3], 40) || null, species: str(r[4], 40) || null,
        blend: str(r[5], 120) || null, blendTotal: str(r[6], 40) || null, category: str(r[7], 40) || undefined}))}))};
}
function loadQr() { return window.qrcode ? Promise.resolve() : loadScript('vendor/qrcode.js'); }
async function qrSvg(text) { await loadQr(); const q = window.qrcode(0, 'M'); q.addData(text, 'Byte'); q.make(); return q.createSvgTag({cellSize: 4, margin: 2, scalable: true, alt: 'QR code that opens this brief'}); }
async function shareLink() { return `${location.origin}${location.pathname}#brief=${await encodeBrief()}`; }
async function showHandoff() {
  const box = $('#handoff'); box.hidden = false;
  try {
    const link = await shareLink();
    $('#handoff-qr').innerHTML = await qrSvg(link);
    $('#handoff-link').value = link;
    $('#handoff-size').textContent = `${link.length.toLocaleString()} characters · the brief is inside the link itself`;
  } catch (e) { $('#handoff-size').textContent = 'This browser cannot build a link (' + e.message + '). Print or download the brief instead.'; }
  box.scrollIntoView({block: 'nearest'});
}

// ------------------------------------------------------------------- inputs
function setupTabs() {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const select = t => { for (const x of tabs) { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; $('#' + x.getAttribute('aria-controls')).hidden = !on; } };
  for (const [i, t] of tabs.entries()) {
    t.onclick = () => select(t);
    t.onkeydown = e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; select(n); n.focus(); } };
  }
  return select;
}

async function dsldSearch(q) {
  const st = $('#dsld-status'), list = $('#dsld-results');
  list.replaceChildren(); st.textContent = 'Searching NIH…';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(DSLD + 'search-filter?' + new URLSearchParams({q, size: '8', from: '0'}), {signal: ctl.signal}); clearTimeout(t);
    if (r.status === 429) throw Error('NIH is limiting requests right now; try again in a minute');
    if (!r.ok) throw Error('NIH returned ' + r.status);
    const data = await r.json(); const hits = data.hits || [];
    st.textContent = hits.length ? `${(data.stats?.count ?? hits.length).toLocaleString()} NIH labels match. Showing the top ${hits.length}. Pick the one that matches your bottle.` : 'No NIH label matched. Try the brand, or type the label instead.';
    for (const h of hits) {
      const s = h._source; const li = el('li');
      const botan = (s.allIngredients || []).filter(i => i.category === 'botanical').map(i => i.name);
      const info = el('div'); info.append(el('strong', s.fullName || 'Unnamed label'), el('span', [s.brandName, s.offMarket ? 'off market' : 'on market', s.entryDate ? 'entered ' + s.entryDate.slice(0, 4) : ''].filter(Boolean).join(' · '), 'small'));
      if (botan.length) info.append(el('span', botan.slice(0, 5).join(', ') + (botan.length > 5 ? '…' : ''), 'small botan'));
      const add = el('button', 'Add', 'quiet small-btn'); add.type = 'button'; add.setAttribute('aria-label', 'Add ' + (s.fullName || 'label') + ' ' + (s.brandName || ''));
      add.onclick = async () => {
        add.disabled = true; add.textContent = 'Loading…';
        try {
          const lr = await fetch(DSLD + 'label/' + encodeURIComponent(h._id)); if (!lr.ok) throw Error(lr.status === 429 ? 'NIH is limiting requests; try again in a minute' : 'label ' + lr.status);
          const p = fromDsldLabel(await lr.json());
          if (!p.ingredients.length) throw Error('this record lists no ingredients');
          invalidateBrief(); state.products.push(p); state.example = null; save(); renderAll();
          st.textContent = `Added “${p.name}” from NIH label #${p.dsldId}.`; add.textContent = 'Added ✓';
        } catch (e) { add.disabled = false; add.textContent = 'Add'; st.textContent = 'Could not load that label (' + e.message + '). Try another, or type the label.'; }
      };
      li.append(info, add); list.append(li);
    }
  } catch (e) { st.textContent = 'The NIH label service is unavailable right now (' + (e.name === 'AbortError' ? 'timed out' : e.message) + '). You can type or photograph the label instead.'; }
}

function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(Error('could not load ' + src)); document.head.append(s); }); }
async function prepImage(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.35)'; g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function runOcr(file, selectTab) {
  const st = $('#ocr-status');
  if (!file || !/^image\//.test(file.type)) { st.textContent = 'Please choose an image file.'; return; }
  if (file.size > 25e6) { st.textContent = 'That image is over 25 MB. Try a smaller photo.'; return; }
  $('#ocr-review').hidden = false; const prev = $('#ocr-preview'); if (prev.src) URL.revokeObjectURL(prev.src); prev.src = URL.createObjectURL(file);
  try {
    st.textContent = 'Preparing on-device text recognition…';
    if (!window.Tesseract) await loadScript('ocr/tesseract.min.js');
    if (!ocrWorker) ocrWorker = await window.Tesseract.createWorker('eng', 1, {workerPath: new URL('ocr/worker.min.js', location.href).href, corePath: new URL('ocr/', location.href).href, langPath: new URL('ocr/lang', location.href).href, gzip: true, workerBlobURL: false,
      logger: m => { if (m.status) st.textContent = `${m.status[0].toUpperCase() + m.status.slice(1)}… ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`; }});
    const t0 = performance.now();
    const {data} = await ocrWorker.recognize(await prepImage(file));
    const text = data.text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 4) { st.textContent = 'We could not read text in that photo. Try better light, closer to the Supplement Facts panel, or type it.'; return; }
    selectTab($('#tab-text'));
    const f = $('#text-form'); if (!f.elements.name.value) f.elements.name.value = 'Photographed label'; f.elements.text.value = text; ocrPending = true;
    f.elements.text.focus();
    st.textContent = '';
    $('#text-status')?.remove();
    const note = el('p', `Read in ${((performance.now() - t0) / 1000).toFixed(1)} s. Check the text, then add it.`, 'small'); note.id = 'text-status'; note.setAttribute('role', 'status');
    f.prepend(note);
  } catch (e) { st.textContent = 'On-device text recognition is unavailable (' + e.message + '). Please type the label instead.'; }
}

// --------------------------------------------------------------------- boot
async function boot() {
  try {
    const r = await fetch('safety-knowledge.json'); if (!r.ok) throw Error(r.status);
    kb = await r.json(); idx = indexKnowledge(kb);
  } catch (e) { $('#run-hint').textContent = 'The NIH knowledge base could not load. Reload to try again.'; return; }
  load(); renderExamples(); renderAll();
  const quoteCount = kb.herbs.reduce((n, h) => n + h.rules.length + (h.variants || []).length, 0);
  $('#kb-stats').textContent = `${kb.herbs.length} herbs · ${kb.verified_passages || quoteCount} NIH passages · ${kb.medicines.length} medicines.`;
  const dl = $('#med-names'); for (const m of kb.medicines) for (const a of [m.name, ...m.aliases]) { const o = el('option'); o.value = a; dl.append(o); }
  const selectTab = setupTabs();
  $('#dsld-form').onsubmit = e => { e.preventDefault(); const q = e.target.elements.q.value.trim(); if (q.length >= 2) dsldSearch(q); };
  $('#text-form').onsubmit = e => {
    e.preventDefault(); const f = e.target; const text = f.elements.text.value.trim();
    if (text.length < 3) { f.elements.text.focus(); return; }
    const p = parseLabelText(text, f.elements.name.value.trim() || 'My product'); if (ocrPending) p.source = 'ocr';
    if (!p.ingredients.length) return;
    invalidateBrief(); state.products.push(p); state.example = null; ocrPending = false; save(); f.reset(); $('#text-status')?.remove(); renderAll();
  };
  $('#photo-input').onchange = e => runOcr(e.target.files[0], selectTab);
  $('#med-form').onsubmit = e => {
    e.preventDefault(); const v = $('#med-input').value.trim();
    invalidateBrief();
    for (const part of v.split(/,|;| and /i).map(s => s.trim()).filter(s => s.length > 1)) if (!state.medicines.some(m => norm(m) === norm(part)) && state.medicines.length < 40) state.medicines.push(part);
    $('#med-input').value = ''; state.example = null; save(); renderMeds(); renderAll(); understandMedicines();
  };
  $('#reason-input').value = state.reason;
  $('#reason-input').oninput = e => { invalidateBrief(); state.reason = e.target.value.trim().slice(0, 120); state.example = null; save(); renderAll(); };
  $('#run-check').onclick = () => runCheck(true);
  $('#clear-all').onclick = () => { invalidateBrief(); state.products = []; state.medicines = []; state.conditions = []; state.example = null; state.aiMeds = {}; state.reason = ''; $('#reason-input').value = ''; try { localStorage.removeItem(STORE); } catch {} renderAll(); };
  for (const id of ['share-meds', 'share-conditions', 'share-ingredients']) $('#' + id).onchange = updateDownload;
  $('#print-brief').onclick = async () => { $('#print-root').innerHTML = briefHTML(result, shareOpts(), true, await printQr()); window.print(); };
  $('#show-handoff').onclick = showHandoff;
  $('#copy-link').onclick = async () => { try { await navigator.clipboard.writeText($('#handoff-link').value); $('#copy-link').textContent = 'Copied ✓'; } catch { $('#handoff-link').select(); } setTimeout(() => { $('#copy-link').textContent = 'Copy link'; }, 2500); };
  $('#keep-shared').onclick = () => { saveAllowed = true; save(); $('#shared-banner').hidden = true; history.replaceState(null, '', location.pathname); $('#check').scrollIntoView({block: 'start'}); };
  window.addEventListener('afterprint', () => { $('#print-root').innerHTML = ''; });
  $('#copy-questions').onclick = async () => {
    const qs = [...result.findings.filter(f => f.level !== 'note').map(f => f.question), ...result.gaps.filter(g => g.type === 'identity').map(g => `Which species is the “${g.ingredient}” in ${g.productName}?`)];
    try { await navigator.clipboard.writeText(qs.map((q, i) => `${i + 1}. ${q}`).join('\n')); $('#copy-questions').textContent = 'Copied ✓'; } catch { $('#copy-questions').textContent = 'Copy unavailable'; }
    setTimeout(() => { $('#copy-questions').textContent = 'Copy my questions'; }, 2500);
  };
  for (const b of document.querySelectorAll('#dsld-form button,#text-form button,#med-form button')) b.disabled = false;
  if (location.hash.startsWith('#brief=')) {
    try {
      const shared = await decodeBrief(location.hash.slice(7));
      Object.assign(state, shared, {example: null}); $('#reason-input').value = state.reason; renderAll(); await runCheck(true); $('#shared-banner').hidden = false;
    } catch (e) { $('#run-hint').textContent = 'This shared brief link could not be opened (' + e.message + ').'; }
  }
  if (state.products.length && new URLSearchParams(location.search).has('resume')) runCheck(false);
  const ex = new URLSearchParams(location.search).get('example'); if (ex && EXAMPLES.some(e => e.id === ex)) runExample(ex);
  document.documentElement.dataset.ready = 'true';
}
boot();
