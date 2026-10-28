// Arapça normalizasyon. etl/normalize.py ile birebir aynı kuralları uygular;
// ikisi de data/normalize_cases.json'a karşı test edilir.

// Hareke, Kur'an işaretleri, üstün elif (U+0670) ve tatvil.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const NON_ARABIC_LETTER = /[^ء-يٱ]/g;

export function stripDiacritics(s: string): string {
  return s.replace(DIACRITICS, '');
}

/** Arama ve *_norm sütunları için: hemze → taşıyıcı, ة → ه, ى → ي. */
export function normalize(s: string): string {
  return stripDiacritics(s)
    .replace(/[ی]/g, 'ي') // Farsça ye
    .replace(/[ک]/g, 'ك') // Farsça kef
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kök anahtarı: bütün hemze biçimleri ve elif tek ء olur; harf dışı her şey atılır. */
export function normalizeRoot(s: string): string {
  return stripDiacritics(s)
    .replace(/[أإآٱءؤئا]/g, 'ء')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(NON_ARABIC_LETTER, '');
}

export function isArabic(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

export function hasDiacritics(s: string): boolean {
  return /[ً-ْٰ]/.test(s);
}

const PREFIXES = ['وبال', 'وال', 'فال', 'بال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل', 'س'];
const SUFFIXES = ['هما', 'كما', 'ات', 'ون', 'ين', 'ان', 'ها', 'هم', 'هن', 'كم', 'كن', 'نا', 'ني', 'ه', 'ك', 'ي'];

/** Ön/son ek soyma ile aday gövdeler (normalize edilmiş girdi için). En az 2 harf kalır. */
export function stemCandidates(norm: string): string[] {
  const out = new Set<string>();
  const pre = [norm];
  for (const p of PREFIXES) if (norm.startsWith(p) && norm.length - p.length >= 2) pre.push(norm.slice(p.length));
  for (const w of pre) {
    out.add(w);
    for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 2) out.add(w.slice(0, -s.length));
  }
  out.delete(norm);
  return [...out];
}

/**
 * Kaynaklar arası karşılaştırma anahtarı: Resm-i Osmânî farklarını (üstün elif ٰ,
 * صلوٰة/زكوٰة) imlâî yazıma çeker, harf-i tarifi atar. "الله" ve kısa kelimeler korunur.
 */
/** Resm-i Osmânî biçimini imlâî karşılaştırmaya hazırlar (üstün elif → ا). */
export function formKey(s: string): string {
  return normalize(s.replace(/و[\u064B-\u0652]*\u0670/g, 'ا').replace(/\u0670/g, 'ا')).replace(/\s+/g, '');
}

export function lemmaKey(s: string): string {
  let k = formKey(s);
  if (k.startsWith('ال') && k.length > 4 && k !== 'الله') k = k.slice(2);
  return k;
}
