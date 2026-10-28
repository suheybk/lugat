// Blok 8: "Hangi sözlük türüne bakmalı" — kelimenin verisine göre kural tabanlı öneri.

export const DICTIONARY_TYPES: Record<string, { name: string; def: string }> = {
  lugha: { name: 'Lügat', def: 'Klasik Arapça–Arapça sözlük: kelimenin Araplar arasındaki asıl (vaz\') anlamını şiir, Kur\'an ve hadis şâhitleriyle verir.' },
  qamus: { name: 'Kâmûs', def: 'Fîrûzâbâdî geleneğindeki özlü, kelime sonuna göre (bab/fasıl) dizilmiş sözlük ve şerhleri (Tâcü\'l-Arûs).' },
  mujam: { name: 'Mu\'cem', def: 'Modern Arapça sözlük: alfabetik kök veya kelime düzeni, çağdaş kullanım ve akademi kararları.' },
  gharib: { name: 'Garîbü\'l-Kur\'an / Hadis', def: 'Kur\'an ve hadiste geçen az bilinen veya özel anlam kazanmış kelimeleri açıklayan eserler (ör. Râgıb\'ın Müfredât\'ı).' },
  istilah: { name: 'Istılah sözlüğü', def: 'Bir ilmin (fıkıh, usûl, kelâm, tasavvuf, tıp...) terimlerini tanımlayan sözlük (ör. Cürcânî, et-Ta\'rîfât).' },
  mufahras: { name: 'Mu\'cem müfehres', def: 'Konkordans: bir kelimenin Kur\'an\'da (veya hadis külliyatında) geçtiği bütün yerleri gösteren fihrist.' },
  bilingual: { name: 'İki dilli sözlük', def: 'Arapça–Türkçe / Arapça–İngilizce sözlük (Vankulu, Kâmûs Tercümesi, Lane, Mutçalı...).' },
};

export interface GuideInput {
  quranCount: number;
  pos?: string | null;
  category?: string | null;
  verbForm?: string | null;
  hasIstilahEntry: boolean;
  hasRoot: boolean;
}

export interface Suggestion { type: string; why: string; dictionaries: string[] }

export function suggest(g: GuideInput): Suggestion[] {
  const out: Suggestion[] = [];
  if (g.hasRoot) {
    out.push({ type: 'lugha', why: 'Kökün asıl anlamı ve anlamların birbirinden nasıl türediği için.', dictionaries: ['maqayis', 'lisan', 'taj'] });
  }
  if (g.quranCount > 0) {
    out.push({ type: 'gharib', why: `Kelime Kur'an'da ${g.quranCount} yerde geçiyor; Kur'an'daki özel anlamı için.`, dictionaries: ['mufradat'] });
    out.push({ type: 'mufahras', why: 'Bütün geçişleri bağlamıyla görmek için (bu sayfadaki Kur\'an bloğu da bir müfehrestir).', dictionaries: [] });
  }
  if (g.hasIstilahEntry || (g.category === 'mastar' && g.quranCount === 0)) {
    out.push({ type: 'istilah', why: g.hasIstilahEntry ? 'Istılah sözlüklerinde maddesi var; terim anlamı lügat anlamından ayrılabilir.' : 'Kur\'an\'da geçmeyen mastar: ilimlerde terim olarak kullanılmış olabilir.', dictionaries: ['tarifat', 'istilah_m3ajim'] });
  }
  if (g.pos === 'fiil' && g.verbForm && g.verbForm !== 'I') {
    out.push({ type: 'qamus', why: `Mezîd fiil (${g.verbForm}. bab): babların anlam farkları Kâmûs ve Tâc şerhinde ayrıntılıdır.`, dictionaries: ['qamus', 'taj'] });
  }
  if (g.quranCount === 0) {
    out.push({ type: 'mujam', why: 'Kur\'an\'da geçmiyor; muasır kullanım için modern sözlüklere bakın.', dictionaries: ['wasit', 'muasira', 'almaany'] });
  }
  out.push({ type: 'bilingual', why: 'Osmanlı Türkçesindeki karşılığı ve Türkçeye geçmiş kullanımı için.', dictionaries: ['kamus_terc', 'vankulu', 'kubbealti'] });
  return out;
}
