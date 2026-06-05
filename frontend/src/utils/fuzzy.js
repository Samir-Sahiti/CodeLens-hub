function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function bigrams(value) {
  if (value.length < 2) return new Set(value ? [value] : []);
  return new Set([...Array(value.length - 1)].map((_, i) => value.slice(i, i + 2)));
}

export function fuzzyMatch(needle, haystack) {
  const n = normalize(needle);
  const h = normalize(haystack);

  if (!n) return 1;
  if (!h) return 0;
  if (h.includes(n)) return 1;

  const needleBigrams = bigrams(n);
  const haystackBigrams = bigrams(h);
  if (!needleBigrams.size || !haystackBigrams.size) return 0;

  const hits = [...needleBigrams].filter(bg => haystackBigrams.has(bg)).length;
  return (2 * hits) / (needleBigrams.size + haystackBigrams.size);
}
