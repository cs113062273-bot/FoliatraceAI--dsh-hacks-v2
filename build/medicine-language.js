// Conservative exclusions before dictionary or semantic inference. A historical,
// negated or supplement-only mention is not evidence of a current medicine.
export function medicineExclusion(text) {
  const s = String(text).toLowerCase().replace(/[’]/g, "'");
  if (/\b(not taking|no longer|stopped|used to|don't take|do not take|never take|without medication|not on|none)\b/.test(s)) return 'not_current';
  if (/\b(herbal|tea|fish oil|vitamin|multivitamin|supplement|probiotic)\b/.test(s)) return 'not_medicine';
  if (/^(the pill|a pill|pill|medicine|medication|tablets?|a small white pill|i cannot remember)$/i.test(s.trim())) return 'too_vague';
  return null;
}
