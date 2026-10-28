// Arapça → Latin (İSAM/DİA tarzına yakın, otomatik) ve Arapça → Buckwalter.
// Otomatik transkripsiyon yaklaşıktır; arayüzde "otomatik" etiketiyle gösterilir.

const CONS: Record<string, string> = {
  'ء': 'ʾ', 'أ': 'ʾ', 'إ': 'ʾ', 'ؤ': 'ʾ', 'ئ': 'ʾ', 'آ': 'ʾâ',
  'ب': 'b', 'ت': 't', 'ث': 's̱', 'ج': 'c', 'ح': 'ḥ', 'خ': 'ḫ', 'د': 'd', 'ذ': 'ẕ',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'ş', 'ص': 'ṣ', 'ض': 'ż', 'ط': 'ṭ', 'ظ': 'ẓ',
  'ع': 'ʿ', 'غ': 'ğ', 'ف': 'f', 'ق': 'ḳ', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'v', 'ي': 'y', 'ى': 'â', 'ة': 'e',
};
const SUN = new Set('تثدذرزسشصضطظلن');
const FATHA = 'َ', DAMMA = 'ُ', KASRA = 'ِ', SUKUN = 'ْ', SHADDA = 'ّ';
const TANWIN = /[ً-ٍ]/;
const MARKS = /[ؐ-ؚۖ-ۭـ]/g;

export function toLatin(input: string): string {
  return input.trim().split(/\s+/).map(wordToLatin).join(' ');
}

function wordToLatin(w: string): string {
  w = w.replace(MARKS, '');
  let out = '';
  let i = 0;
  const ch = (k: number) => w[k] ?? '';
  // Harf-i tarif
  if (/^[اٱ]ل/.test(w)) {
    const marks = w.slice(2).match(/^[ً-ْ]*/)![0].length;
    const p = 2 + marks;
    const next = w[p];
    if (next && SUN.has(next)) {
      // Şemsî harf: لام yazılmaz, harf iki kez okunur (er-raḥmân); harfin kendi şeddesi düşer.
      out = 'e' + CONS[next] + '-';
      w = w.slice(0, p + 1) + w.slice(p + 1).replace(/^([ً-ِْ]?)ّ/, '$1');
      i = p;
    }
    else { out = 'el-'; i = 2; if (ch(i) === SUKUN) i++; }
  }
  for (; i < w.length; i++) {
    const c = w[i];
    const n = ch(i + 1);
    if (c === FATHA) {
      if (n === 'ا' || n === 'ى') { out += 'â'; i++; }
      else if (n === 'ٰ') { out += 'â'; i++; }
      else out += 'a';
    } else if (c === KASRA) {
      if (n === 'ي' && !/[َ-ّ]/.test(ch(i + 2))) { out += 'î'; i++; } else out += 'i';
    } else if (c === DAMMA) {
      if (n === 'و' && !/[َ-ّ]/.test(ch(i + 2))) { out += 'û'; i++; } else out += 'u';
    } else if (c === 'ٰ') out += 'â';
    else if (c === SUKUN || c === SHADDA || TANWIN.test(c)) continue;
    else if (c === 'ا' || c === 'ٱ') { if (i === 0) continue; out += /[aiuâîû]$/.test(out) ? '' : 'â'; }
    else if (c === 'ة') { out = out.replace(/a$/, '') + 'e'; }
    else if (CONS[c] !== undefined) {
      if (i === 0 && 'أإآ'.includes(c)) { out += c === 'آ' ? 'â' : ''; continue; }
      let s = CONS[c];
      let j = i + 1;
      while (/[ً-ْ]/.test(ch(j))) { if (ch(j) === SHADDA) s = s + s; j++; }
      out += s;
    }
  }
  return out;
}

/** Kubbealtı / TDV araması için sade Latin (özel işaretler atılır). */
export function toPlainLatin(input: string): string {
  const plain: Record<string, string> = {
    'ḥ': 'h', 'ḫ': 'h', 'ṣ': 's', 'ż': 'z', 'ẓ': 'z', 'ẕ': 'z', 'ṭ': 't', 'ḳ': 'k', 'â': 'a', 'î': 'i', 'û': 'u',
  };
  return toLatin(input)
    .replace(/s̱/g, 's')
    .replace(/[ʾʿ-]/g, '')
    .replace(/[ḥḫṣżẓẕṭḳâîû]/g, (c) => plain[c]);
}

const BW: Record<string, string> = {
  'ء': "'", 'آ': '|', 'أ': '>', 'ؤ': '&', 'إ': '<', 'ئ': '}', 'ا': 'A', 'ب': 'b', 'ة': 'p', 'ت': 't',
  'ث': 'v', 'ج': 'j', 'ح': 'H', 'خ': 'x', 'د': 'd', 'ذ': '*', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': '$',
  'ص': 'S', 'ض': 'D', 'ط': 'T', 'ظ': 'Z', 'ع': 'E', 'غ': 'g', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l',
  'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ى': 'Y', 'ي': 'y', 'ٱ': '{',
};

export function toBuckwalter(s: string): string {
  return [...s].map((c) => BW[c] ?? '').join('');
}
