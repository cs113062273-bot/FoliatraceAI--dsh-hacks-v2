// On-device language understanding: embeds what a person typed (e.g. "my blood pressure pill") with
// all-MiniLM-L6-v2 and compares it with medicine-group descriptions. Nothing leaves the device.
import {medicineExclusion} from './medicine-language.js';
let runtime, session, tokenizer, groupVecs = null, groupKey = '';
const here = p => new URL(p, self.location).href;
const sha = async buf => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');

async function load() {
  if (session) return;
  const [ort, tok, manifest] = await Promise.all([import(here('inference/ort.wasm.min.mjs')), import(here('inference/tokenizers.mjs')), fetch(here('inference/embed-manifest.json')).then(r => r.json())]);
  const tbytes = await (await fetch(here('inference/embed-tokenizer.json'))).arrayBuffer();
  if (await sha(tbytes) !== manifest.tokenizer_sha256) throw Error('tokenizer checksum mismatch');
  const mbytes = await (await fetch(here('inference/embed-model.onnx'))).arrayBuffer();
  if (await sha(mbytes) !== manifest.model_sha256) throw Error('model checksum mismatch');
  runtime = ort; runtime.env.wasm.numThreads = 1; runtime.env.wasm.wasmPaths = here('inference/');
  tokenizer = new tok.Tokenizer(JSON.parse(new TextDecoder().decode(tbytes)), {});
  session = await runtime.InferenceSession.create(new Uint8Array(mbytes), {executionProviders: ['wasm']});
}

async function embed(text) {
  const ids = [101, ...tokenizer.encode(String(text).slice(0, 400), {add_special_tokens: false}).ids.slice(0, 254), 102];
  // Match Python's pinned tokenizer padding. Dynamic int8 quantisation is sensitive
  // to sequence shape, even when padding is masked from attention and pooling.
  const real = ids.length; while (ids.length < 128) ids.push(0);
  const n = ids.length;
  const feed = {input_ids: new runtime.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]),
    attention_mask: new runtime.Tensor('int64', BigInt64Array.from(ids.map((_, i) => i < real ? 1n : 0n)), [1, n]),
    token_type_ids: new runtime.Tensor('int64', new BigInt64Array(n), [1, n])};
  const out = await session.run(Object.fromEntries(session.inputNames.map(k => [k, feed[k]])));
  const h = out[session.outputNames[0]].data, d = h.length / n, v = new Float32Array(d);
  for (let t = 0; t < real; t++) for (let j = 0; j < d; j++) v[j] += h[t * d + j] / real;
  let norm = 0; for (const x of v) norm += x * x; norm = Math.sqrt(norm); for (let j = 0; j < d; j++) v[j] /= norm;
  Object.values(out).forEach(t => t.dispose?.()); Object.values(feed).forEach(t => t.dispose?.());
  return v;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

let queue = Promise.resolve();
self.onmessage = ({data}) => { queue = queue.then(() => handle(data)); };
async function handle(data) {
  const {id, type} = data;
  try {
    await load();
    if (type === 'classify') {
      const key = JSON.stringify(data.groups);
      if (groupKey !== key) { groupVecs = []; for (const g of data.groups) for (const p of [g.description, ...(g.prototypes || [])]) groupVecs.push([g.id, await embed(p)]); groupKey = key; }
      const results = [];
      for (const text of data.texts) {
        const v = await embed(text), scores = new Map();
        for (const [gid, gv] of groupVecs) scores.set(gid, Math.max(scores.get(gid) ?? -1, dot(v, gv)));
        const ranked = [...scores].sort((a, b) => b[1] - a[1]);
        const [best, score] = ranked[0], margin = score - (ranked[1]?.[1] ?? -1);
        const excluded = medicineExclusion(text);
        results.push({text, group: !excluded && score >= data.threshold && margin >= (data.margin || 0) ? best : null, best, score: Math.round(score * 1000) / 1000, margin: Math.round(margin * 1000) / 1000, excluded});
      }
      postMessage({id, type: 'classified', results});
    }
  } catch (e) { postMessage({id, type: 'error', text: e.message}); }
}
