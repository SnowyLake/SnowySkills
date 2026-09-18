function deltaValue(item) {
  return item.worstDelta ?? item.totalDeltaCycles ?? Number.NEGATIVE_INFINITY;
}

function itemName(item) {
  return item.displayName ?? item.key;
}

function compareCandidates(left, right) {
  return deltaValue(right) - deltaValue(left)
    || Number(right.spillRegression) - Number(left.spillRegression)
    || String(itemName(left)).localeCompare(String(itemName(right)));
}

export function comparisonKey(comparison) {
  return `${comparison.comparisonType}|${comparison.baselineKeywords.join("\u001f")}|${comparison.candidateKeywords.join("\u001f")}`;
}

export function comparisonName(comparison) {
  return comparison.addedKeywords.join(" | ");
}

export function selectComparisonCandidates(items, options = {}) {
  const deltaLimit = options.deltaLimit ?? 5;
  const spillLimit = options.spillLimit ?? 5;
  const totalLimit = options.totalLimit ?? 10;
  const eligible = items.filter((item) => deltaValue(item) > 0 || item.spillRegression);
  const topDelta = eligible.filter((item) => deltaValue(item) > 0)
    .sort((left, right) => deltaValue(right) - deltaValue(left) || String(itemName(left)).localeCompare(String(itemName(right))))
    .slice(0, deltaLimit);
  const topSpill = eligible.filter((item) => item.spillRegression)
    .sort((left, right) => deltaValue(right) - deltaValue(left) || String(itemName(left)).localeCompare(String(itemName(right))))
    .slice(0, spillLimit);
  const selected = new Map([...topDelta, ...topSpill].map((item) => [item.key, item]));
  return [...selected.values()].sort(compareCandidates).slice(0, totalLimit);
}
