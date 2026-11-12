import {encodePair} from './pair-tokenizer.js';
import {sourceContext, excludedFromPatientLeads} from './research-evidence.js';
let runtime, session, tokenizer, library;
const cache = new Map();
const normalized = text => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[‘’]/g, "'").replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = text => normalized(text).match(/[a-z]{2,}/g) || [];
async function loadLibrary() {
  if (library) return library;
  const r = await fetch(new URL('browser-library.json', self.location));
  if (!r.ok) throw Error('The bundled literature library is unavailable.');
  const papers = await r.json(), df = new Map(); let total = 0;
  for (const p of papers) {
    p.searchText = ' ' + normalized(p.title + ' ' + p.abstract) + ' ';
    p.words = tokens(p.title + ' ' + p.abstract); p.counts = new Map(); total += p.words.length;
    for (const w of p.words) p.counts.set(w, (p.counts.get(w) || 0) + 1);
    for (const w of p.counts.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  library = {papers, df, avg: total / papers.length}; return library;
}
function bm25(query, index, herbNames, patientLeads) {
  const words = new Set(tokens(query));
  const names = (herbNames || []).filter(n => typeof n === 'string' && n.length >= 3).map(n => ' ' + normalized(n) + ' ');
  return index.papers.filter(p => (!patientLeads || !excludedFromPatientLeads(p)) && (!names.length || names.some(n => p.searchText.includes(n)))).map(p => {
    let score = 0;
    for (const w of words) {
      const tf = p.counts.get(w) || 0; if (!tf) continue;
      const idf = Math.log(1 + (index.papers.length - (index.df.get(w) || 0) + .5) / ((index.df.get(w) || 0) + .5));
      score += idf * tf * 2.5 / (tf + 1.5 * (.25 + .75 * p.words.length / index.avg));
    }
    return {paper: p, score};
  }).filter(r => r.score > 0).sort((a,b) => b.score-a.score || a.paper.id.localeCompare(b.paper.id)).slice(0,20);
}
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function loadModel(id) {
  if (session) return;
  postMessage({id,type:'progress',text:'Loading the local AI runtime and 23 MB model. Your question stays on this device.'});
  const [ort,tok,manifest,tbytes] = await Promise.all([
    import(new URL('inference/ort.wasm.min.mjs',self.location).href), import(new URL('inference/tokenizers.mjs',self.location).href),
    fetch(new URL('inference/manifest.json',self.location)).then(r=>r.json()), fetch(new URL('inference/tokenizer.json',self.location)).then(r=>r.arrayBuffer())]);
  if (await sha(tbytes) !== manifest.tokenizer_sha256) throw Error('Tokenizer checksum mismatch.');
  const response = await fetch(new URL('inference/model.onnx', self.location));
  if (!response.ok) throw Error('Model download failed.');
  const bytes = await response.arrayBuffer();
  if (await sha(bytes) !== manifest.model_sha256) throw Error('Model checksum mismatch.');
  runtime = ort; runtime.env.wasm.numThreads = 1; runtime.env.wasm.wasmPaths = new URL('inference/',self.location).href;
  tokenizer = new tok.Tokenizer(JSON.parse(new TextDecoder().decode(tbytes)),{});
  session = await runtime.InferenceSession.create(new Uint8Array(bytes),{executionProviders:['wasm']});
}
let queue = Promise.resolve();
self.onmessage = ({data}) => { queue = queue.then(() => search(data)); };
async function search({id,query,method,herbNames,patientLeads}) {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 500 || !['bm25','ai'].includes(method) || (herbNames && (!Array.isArray(herbNames) || herbNames.length > 100))) {
    postMessage({id,type:'error',text:'Enter a research question of 3–500 characters.'}); return;
  }
  try {
    const start = performance.now(), index = await loadLibrary();
    const key = JSON.stringify([query,method,herbNames,!!patientLeads]);
    if (cache.has(key)) { postMessage({...cache.get(key),id,seconds:(performance.now()-start)/1000}); return; }
    let rows = bm25(query,index,herbNames,patientLeads), baseline = rows.map(r=>r.paper.id);
    if (method === 'ai' && rows.length) {
      await loadModel(id);
      for (let i=0; i<rows.length; i++) {
        postMessage({id,type:'progress',text:'Prioritising source '+(i+1)+' of '+rows.length+' on your device…'});
        const encoded = encodePair(tokenizer,query,rows[i].paper.title+' '+rows[i].paper.abstract), feed = {};
        for (const name of session.inputNames) feed[name] = new runtime.Tensor('int64',BigInt64Array.from(encoded[name].map(BigInt)),[1,encoded.input_ids.length]);
        let output;
        try {
          output = await session.run(feed); const value = Number(output[session.outputNames[0]].data[0]);
          if (!Number.isFinite(value)) throw Error('Invalid relevance score.'); rows[i].score = value;
        } finally { Object.values(output || {}).forEach(t=>t.dispose()); Object.values(feed).forEach(t=>t.dispose()); }
      }
      rows.sort((a,b)=>b.score-a.score || a.paper.id.localeCompare(b.paper.id));
    }
    const result = {type:'result',query,method,library_count:index.papers.length,candidate_count:rows.length,seconds:(performance.now()-start)/1000,baseline,
      rows:rows.slice(0,5).map(({paper,score})=>({id:paper.id,title:paper.title,url:paper.url,abstract:paper.abstract,licence:paper.licence,score,context:sourceContext(paper)}))};
    if (cache.size >= 100) cache.delete(cache.keys().next().value); cache.set(key,result);
    postMessage({...result,id});
  } catch(error) { postMessage({id,type:'error',text:'Could not run '+(method==='ai'?'local AI':'keyword')+' search: '+error.message+' Your preparation is unchanged.'}); }
}
