import { suggest, DICTIONARY_TYPES } from './guide';
import { formKey, hasDiacritics, lemmaKey, normalize, normalizeRoot, stemCandidates, stripDiacritics } from './normalize';
import { toBuckwalter, toLatin, toPlainLatin } from './translit';

/** Yayında yalnız onaylı; yönetici önizlemesinde onay bekleyenler de (reddedilenler hariç). */
export const visible = (preview: boolean) => (preview ? "status != 'rejected'" : "status = 'approved'");

interface LemmaRow {
  id: number; root_id: number | null; lemma_voc: string; lemma_norm: string; lemma_key: string;
  pos: string | null; pattern: string | null; gender: string | null; plural: string | null;
  verb_form: string | null; category: string | null; source: string; agree_count: number;
  conflict: number; compare_note: string | null; quran_count: number; status: string;
}

interface Candidate {
  lemma_key: string; root_id: number | null; voc: string; pos: string | null; quran: number;
  score: number; root?: string;
}

const PREVIEW_LIMIT = 1200;

export async function findCandidates(db: D1Database, q: string, preview: boolean) {
  const S = visible(preview);
  const norm = normalize(q).replace(/\s+/g, '');
  const key = lemmaKey(q);
  const bare = stripDiacritics(q).trim();

  const fkey = formKey(q);
  const [direct, occ] = await Promise.all([
    db.prepare(`SELECT * FROM lemmas WHERE ${S} AND (lemma_norm = ?1 OR lemma_key = ?2) LIMIT 200`)
      .bind(norm, key).all<LemmaRow>(),
    // Kur'an'daki biçim (ör. يؤمنون → آمَنَ, إيلاف → إِلاف): korpus lemması sözlüklerden farklı olabilir
    db.prepare(`SELECT DISTINCT lemma_key, root_id FROM quran_occurrences WHERE ${S} AND (form_norm IN (?1, ?2) OR stem_norm IN (?1, ?2)) LIMIT 10`)
      .bind(norm, fkey).all<{ lemma_key: string; root_id: number }>(),
  ]);
  let rows = direct.results;
  let via = 'kelime';
  const known = new Set(rows.map((r) => `${r.lemma_key}|${r.root_id}`));
  const extra = occ.results.filter((o) => !known.has(`${o.lemma_key}|${o.root_id}`));
  if (extra.length) {
    rows = rows.concat(await lemmasFor(db, S, extra));
    if (!direct.results.length) via = 'Kur\'an\'daki biçim';
  }
  if (!rows.length) {
    const stems = stemCandidates(norm);
    if (stems.length) {
      const ph = stems.map((_, i) => `?${i + 1}`).join(',');
      rows = (await db.prepare(`SELECT * FROM lemmas WHERE ${S} AND (lemma_norm IN (${ph}) OR lemma_key IN (${ph})) LIMIT 200`)
        .bind(...stems).all<LemmaRow>()).results;
      via = 'ek soyma';
    }
  }

  // Kök eşleşmesi (2–5 harf): kelime de olsa kök bilgisi ayrıca döner.
  const rkey = normalizeRoot(q);
  let rootHit: { id: number; root: string } | null = null;
  if (rkey.length >= 2 && rkey.length <= 5) {
    rootHit = await db.prepare(
      `SELECT r.id, r.root FROM roots r WHERE r.root_norm = ? AND EXISTS (SELECT 1 FROM lemmas l WHERE l.root_id = r.id AND l.${S})`,
    ).bind(rkey).first<{ id: number; root: string }>();
  }

  // Aynı kelimeyi (lemma_key + kök) gruplayıp sırala. Puan: harekeli yazım aynı (3) >
  // hemze yeri dahil harf iskeleti aynı (2) > doğrudan sözlük eşleşmesi (1) > yalnız Kur'an biçimi (0).
  // Böylece إِيمَان araması, harekesiz yazımı aynı olan أَيْمَان'a (yeminler) düşmez.
  const directIds = new Set(direct.results.map((r) => r.id));
  const qCore = hasDiacritics(q) ? vocCore(q.trim()) : null;
  const groups = new Map<string, Candidate>();
  for (const r of rows) {
    const k = `${r.lemma_key}|${r.root_id ?? ''}`;
    const score = qCore && vocCore(r.lemma_voc) === qCore ? 3
      : stripDiacritics(r.lemma_voc).replace(/ٱ/g, 'ا') === bare ? 2
      : directIds.has(r.id) ? 1 : 0;
    const g = groups.get(k);
    if (!g) groups.set(k, { lemma_key: r.lemma_key, root_id: r.root_id, voc: r.lemma_voc, pos: r.pos, quran: r.quran_count, score });
    else {
      g.quran = Math.max(g.quran, r.quran_count);
      g.score = Math.max(g.score, score);
      if (r.source === 'quran_corpus') g.voc = r.lemma_voc;
    }
  }
  const candidates = [...groups.values()].sort(
    (a, b) => b.score - a.score || b.quran - a.quran || Number(b.root_id === rootHit?.id) - Number(a.root_id === rootHit?.id),
  );
  if (candidates.length) {
    const ids = [...new Set(candidates.map((c) => c.root_id).filter((x): x is number => x != null))];
    if (ids.length) {
      const rs = await db.prepare(`SELECT id, root FROM roots WHERE id IN (${ids.join(',')})`).all<{ id: number; root: string }>();
      const m = new Map(rs.results.map((r) => [r.id, r.root]));
      for (const c of candidates) c.root = c.root_id != null ? m.get(c.root_id) : undefined;
    }
  }
  return { norm, bare, via, candidates: candidates.slice(0, 30), rootHit };
}

async function lemmasFor(db: D1Database, S: string, pairs: { lemma_key: string; root_id: number }[]) {
  const out: LemmaRow[] = [];
  for (const p of pairs) {
    const r = await db.prepare(`SELECT * FROM lemmas WHERE ${S} AND lemma_key = ? AND root_id IS ?`).bind(p.lemma_key, p.root_id).all<LemmaRow>();
    out.push(...r.results);
  }
  return out;
}

export async function buildResult(
  db: D1Database, q: string, preview: boolean,
  pick?: { key?: string | null; root?: number | null },
) {
  const S = visible(preview);
  const found = await findCandidates(db, q, preview);
  let chosen = found.candidates[0] ?? null;
  if (pick?.key) chosen = found.candidates.find((c) => c.lemma_key === pick.key && (pick.root == null || c.root_id === pick.root)) ?? chosen;

  // Girdi bir kök ise ve kelime adayı yoksa: kök sayfası
  const rootId = chosen?.root_id ?? found.rootHit?.id ?? null;
  const lemmaKeyV = chosen?.lemma_key ?? null;
  // Sözlük lemması Kur'an'da yoksa ama girilen biçim Kur'an'da başka lemma yazımıyla geçiyorsa
  // (إيلاف ↔ korpusta إِلاف), Kur'an bloğu o lemmayı gösterir.
  const quranAlt = chosen && chosen.quran === 0
    ? found.candidates.find((c) => c !== chosen && c.root_id === rootId && c.quran > 0 && c.score === 0) ?? null
    : null;
  const quranKey = quranAlt?.lemma_key ?? lemmaKeyV;

  const [lemmaRows, root, translations, entries, relations, derivatives, qLemma, qRoot, istilah, links] = await Promise.all([
    lemmaKeyV
      ? db.prepare(`SELECT * FROM lemmas WHERE ${S} AND lemma_key = ? AND root_id IS ?`).bind(lemmaKeyV, rootId).all<LemmaRow>()
      : Promise.resolve({ results: [] as LemmaRow[] }),
    rootId ? db.prepare('SELECT id, root, root_norm, letters_count FROM roots WHERE id = ?').bind(rootId).first() : null,
    lemmaKeyV
      ? db.prepare(`SELECT id, lang, gloss, source, agree_count, status FROM translations WHERE ${S} AND lemma_key = ? ORDER BY agree_count DESC, id LIMIT 40`).bind(lemmaKeyV).all()
      : Promise.resolve({ results: [] }),
    entriesFor(db, S, rootId, found.norm),
    lemmaKeyV
      ? db.prepare(`SELECT id, related_text, related_key, kind, source, confidence, agree_count, conflict, status FROM relations WHERE ${S} AND lemma_key = ? ORDER BY agree_count DESC, id LIMIT 120`).bind(lemmaKeyV).all()
      : Promise.resolve({ results: [] }),
    rootId
      ? db.prepare(`SELECT lemma_key, lemma_voc, pos, pattern, verb_form, category, source, quran_count, status FROM lemmas WHERE ${S} AND root_id = ? ORDER BY quran_count DESC, lemma_key LIMIT 400`).bind(rootId).all<LemmaRow>()
      : Promise.resolve({ results: [] as LemmaRow[] }),
    quranKey
      ? db.prepare(`SELECT count(*) n FROM quran_occurrences WHERE ${S} AND lemma_key = ? AND root_id IS ?`).bind(quranKey, rootId).first<{ n: number }>()
      : null,
    rootId ? db.prepare(`SELECT count(*) n FROM quran_occurrences WHERE ${S} AND root_id = ?`).bind(rootId).first<{ n: number }>() : null,
    rootId
      ? db.prepare(`SELECT 1 FROM entries e JOIN dictionaries d ON d.id = e.dictionary_id WHERE e.${S} AND e.root_id = ? AND d.type = 'istilah' LIMIT 1`).bind(rootId).first()
      : null,
    db.prepare('SELECT code, name, description, url_template, scope FROM external_links WHERE active = 1 ORDER BY sort_order').all<{ code: string; name: string; description: string; url_template: string; scope: string }>(),
  ]);

  const lemma = mergeLemma(lemmaRows.results);
  const word = lemma?.voc ?? q.trim();
  const rootStr = (root as { root?: string } | null)?.root ?? null;
  const quranLemma = qLemma?.n ?? 0;

  const verses = rootId
    ? await quranVerses(db, S, quranKey, rootId, 0, quranLemma ? 'lemma' : 'root')
    : [];

  const guideInput = {
    quranCount: quranLemma, pos: lemma?.pos, category: lemma?.category, verbForm: lemma?.verb_form,
    hasIstilahEntry: !!istilah, hasRoot: !!rootId,
  };

  return {
    query: q,
    norm: found.norm,
    via: chosen ? found.via : found.rootHit ? 'kök' : null,
    preview,
    candidates: found.candidates,
    lemma: lemma && { ...lemma, latin: toLatin(lemma.voc) },
    root: root && { ...(root as object), latin: rootStr ? [...rootStr].join('-') : null },
    translations: translations.results,
    entries,
    quran: {
      lemma_count: quranLemma, root_count: qRoot?.n ?? 0, mode: quranLemma ? 'lemma' : 'root', verses,
      key: quranKey, via_lemma: quranAlt && quranLemma ? quranAlt.voc : null,
    },
    relations: groupRelations(relations.results as RelRow[]),
    derivatives: groupDerivatives(derivatives.results),
    guide: suggest(guideInput).map((s) => ({ ...s, type_name: DICTIONARY_TYPES[s.type].name, type_def: DICTIONARY_TYPES[s.type].def })),
    links: links.results.map((l) => ({
      code: l.code, name: l.name, description: l.description, scope: l.scope,
      url: fillTemplate(l.url_template, word, rootStr),
    })),
  };
}

/** Harekeli yazımın karşılaştırma çekirdeği: tenvin ve son hareke atılır, uzun ā tek biçime iner
 *  (رَحْمَة = رَحْمَةٌ, رَحْمٰن = رَحْمَانٌ; ama رَحَمَة ≠ رَحْمَة). */
export function vocCore(s: string) {
  return s.replace(/[\u064B-\u064D]/g, '').replace(/\u0627\u064E/g, '\u0627').replace(/[\u064E-\u0650\u0652]$/, '').replace(/ت$/, 'ة')
    .replace(/ٱ/g, 'ا').replace(/(.)\u064E?[\u0670\u0627]/g, '$1ā');
}

function mergeLemma(rows: LemmaRow[]) {
  if (!rows.length) return null;
  const q = rows.find((r) => r.source === 'quran_corpus');
  const arr = rows.filter((r) => r.source === 'arramooz');
  const a = (q && arr.find((r) => vocCore(r.lemma_voc) === vocCore(q.lemma_voc))) ?? (q ? undefined : arr[0]);
  const base = q ?? a ?? rows[0];
  return {
    // Korpusun Mushaf imlâlı lemması (عِبادَت) yerine sözlük yazımı gösterilir, varsa.
    voc: q && a && /ت$/.test(q.lemma_voc) ? a.lemma_voc : base.lemma_voc,
    lemma_key: base.lemma_key,
    pos: base.pos,
    pattern: a?.pattern ?? base.pattern,
    gender: a?.gender ?? base.gender,
    plural: a?.plural ?? base.plural,
    verb_form: q?.verb_form ?? a?.verb_form ?? null,
    category: a?.category ?? base.category,
    sources: [...new Set(rows.map((r) => r.source))],
    agree_count: Math.max(...rows.map((r) => r.agree_count)),
    conflict: rows.some((r) => r.conflict === 1),
    compare_note: [...new Set(rows.map((r) => r.compare_note).filter(Boolean))].join(' · ') || null,
    pending: rows.some((r) => r.status !== 'approved'),
  };
}

async function entriesFor(db: D1Database, S: string, rootId: number | null, norm: string) {
  const r = await db.prepare(
    `SELECT e.id, e.headword, substr(e.body, 1, ${PREVIEW_LIMIT}) AS body, length(e.body) AS body_len, e.page_ref,
            e.source, e.agree_count, e.conflict, e.compare_note, e.status,
            d.code, d.name_ar, d.name_tr, d.author, d.death, d.grp, d.type, d.century, d.sort_order
     FROM entries e JOIN dictionaries d ON d.id = e.dictionary_id
     WHERE e.${S} AND (e.root_id = ?1 OR (?1 IS NULL AND e.headword_norm = ?2))
     ORDER BY d.sort_order, e.id LIMIT 200`,
  ).bind(rootId, norm).all<Record<string, unknown>>();
  const groups = new Map<string, { group: string; dictionaries: Map<string, Record<string, unknown>> }>();
  for (const e of r.results) {
    const grp = e.grp as string;
    if (!groups.has(grp)) groups.set(grp, { group: grp, dictionaries: new Map() });
    const g = groups.get(grp)!;
    if (!g.dictionaries.has(e.code as string)) {
      g.dictionaries.set(e.code as string, {
        code: e.code, name_ar: e.name_ar, name_tr: e.name_tr, author: e.author, death: e.death, type: e.type, items: [],
      });
    }
    (g.dictionaries.get(e.code as string)!.items as unknown[]).push({
      id: e.id, headword: e.headword, body: e.body, truncated: (e.body_len as number) > PREVIEW_LIMIT,
      page_ref: e.page_ref, source: e.source, agree_count: e.agree_count, conflict: e.conflict,
      compare_note: e.compare_note, status: e.status,
    });
  }
  const order = ['klasik', 'modern', 'istilah', 'turkce', 'ingilizce'];
  return [...groups.values()]
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
    .map((g) => ({ group: g.group, dictionaries: [...g.dictionaries.values()] }));
}

export async function quranVerses(
  db: D1Database, S: string, lemmaKeyV: string | null, rootId: number, offset: number, mode: 'lemma' | 'root', limit = 30,
) {
  const where = mode === 'lemma' ? 'o.lemma_key = ?1 AND o.root_id IS ?2' : 'o.root_id = ?2';
  const r = await db.prepare(
    `SELECT o.sura, o.aya, o.word_index, o.form, o.pos, v.text
     FROM quran_occurrences o JOIN quran_verses v ON v.sura = o.sura AND v.aya = o.aya
     WHERE o.${S} AND ${where} ORDER BY o.sura, o.aya, o.word_index LIMIT ${limit} OFFSET ${offset}`,
  ).bind(lemmaKeyV, rootId).all();
  return r.results;
}

interface RelRow { related_text: string; related_key: string; kind: string; source: string; agree_count: number; conflict: number; status: string }

function groupRelations(rows: RelRow[]) {
  const by: Record<string, Map<string, { text: string; sources: string[]; agree: number; conflict: boolean; pending: boolean }>> = {};
  for (const r of rows) {
    by[r.kind] ??= new Map();
    const m = by[r.kind];
    const x = m.get(r.related_key);
    if (x) { if (!x.sources.includes(r.source)) x.sources.push(r.source); x.agree = Math.max(x.agree, r.agree_count); }
    else m.set(r.related_key, { text: r.related_text, sources: [r.source], agree: r.agree_count, conflict: !!r.conflict, pending: r.status !== 'approved' });
  }
  return Object.fromEntries(Object.entries(by).map(([k, m]) => [k, [...m.values()].sort((a, b) => b.agree - a.agree)]));
}

function groupDerivatives(rows: LemmaRow[]) {
  const seen = new Map<string, { voc: string; pos: string | null; pattern: string | null; verb_form: string | null; category: string | null; quran: number; sources: string[]; pending: boolean }>();
  for (const r of rows) {
    const k = `${r.lemma_key}|${vocCore(r.lemma_voc)}`;
    const x = seen.get(k);
    if (x) {
      x.quran = Math.max(x.quran, r.quran_count);
      if (!x.sources.includes(r.source)) x.sources.push(r.source);
      x.pattern ??= r.pattern; x.category ??= r.category; x.verb_form ??= r.verb_form;
      if (r.source === 'quran_corpus') x.voc = r.lemma_voc;
    } else {
      seen.set(k, { voc: r.lemma_voc, pos: r.pos, pattern: r.pattern, verb_form: r.verb_form, category: r.category, quran: r.quran_count, sources: [r.source], pending: r.status !== 'approved' });
    }
  }
  const groups: Record<string, unknown[]> = {};
  for (const d of seen.values()) {
    const g = d.pos === 'fiil'
      ? `Fiil${d.verb_form && /^[IVX]+$/.test(d.verb_form) ? ` — ${d.verb_form}. bab` : ''}`
      : d.category && d.category !== 'fiil' ? capitalize(d.category) : d.pos === 'harf' ? 'Harf' : 'İsim';
    (groups[g] ??= []).push(d);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => (a.startsWith('Fiil') ? 0 : 1) - (b.startsWith('Fiil') ? 0 : 1) || a.localeCompare(b, 'tr'))
    .map(([group, items]) => ({ group, items }));
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

export function fillTemplate(t: string, word: string, root: string | null) {
  const w = stripDiacritics(word).trim();
  const r = root ?? w;
  return t
    .replace('{w}', encodeURIComponent(w))
    .replace('{r_bw}', encodeURIComponent(toBuckwalter(r.replace(/[أإآءؤئ]/g, 'ا'))))
    .replace('{r}', encodeURIComponent(r))
    .replace('{w_latin}', encodeURIComponent(toPlainLatin(word)));
}
