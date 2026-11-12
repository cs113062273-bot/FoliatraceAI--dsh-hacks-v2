// Literal abstract excerpts with stable character offsets. These are text cues,
// not an eligibility decision or a clinical interpretation.
export function researchQueries(herb, reason) {
  const goals = String(reason || '').split(/\s+and\s+|\s*&\s*|[,;|]/i).map(s => s.trim()).filter(Boolean).slice(0, 3);
  return (goals.length ? goals : ['reported health outcomes']).map(goal => ({goal, query: `Clinical studies of ${herb} for ${goal} in people`}));
}
export function excludedFromPatientLeads(paper) {
  // Explicit title cues only. Passing this filter does not prove a human study.
  return /\b(rats?|mice|murine|canine|dogs?|cats?|quails?|rainbow trout|broiler|in vitro|in silico|hepg2|cell lines?|foliar|irrigation|drought|cultivation|seedlings?|nanoemulsion|nanoparticles?|metal content|phytochemical profiling|protocol)\b/i.test(paper.title);
}
export function sourceContext(paper) {
  const abstract = String(paper.abstract || '');
  const sentences = [...abstract.matchAll(/[^.!?]+(?:[.!?]+|$)/g)].map(m => {
    const start = m.index + m[0].search(/\S/); const text = m[0].trim();
    return {text, start, end: start + text.length};
  }).filter(s => s.text.length >= 20);
  const patterns = [
    ['Population', /\b(patients?|participants?|subjects?|individuals?|adults?|children|adolescents?|elderly|women|men|volunteers?|rats?|mice|quails?|dogs?|cats?|cells?)\b/i],
    ['Preparation / amount', /\b(extract|capsules?|tablets?|\d+\s*(?:mg|g\/day|ml)|standardized|standardised|oral|topical)\b/i],
    ['Study design / comparator', /\b(randomi[sz]ed|placebo|double.blind|systematic review|meta.analysis|cohort|comparator)\b/i],
  ];
  return patterns.map(([label, pattern]) => ({label, span: sentences.find(s => pattern.test(s.text)) || null}));
}
