// Lügat Portalı — tek sayfa arayüz (bağımlılıksız)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const fmt = new Intl.NumberFormat('tr-TR');

// ---------- Yönetici önizlemesi (yalnız yönetim panelinden açılır) ----------
const adminToken = (() => { try { return sessionStorage.getItem('lugat.admin') || ''; } catch { return ''; } })();
const preview = () => !!adminToken && new URLSearchParams(location.search).get('preview') === '1';

async function api(path) {
  const url = new URL(path, location.origin);
  const headers = {};
  if (preview()) { url.searchParams.set('preview', '1'); headers.Authorization = `Bearer ${adminToken}`; }
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Sunucu hatası (${r.status})`);
  return r.json();
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.role = 'status'; t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- Latin → Arapça (ktb → كتب, kitâb → كتاب, raHma → رحمة) ----------
const DIGRAPH = [['sh', 'ش'], ['th', 'ث'], ['dh', 'ذ'], ['kh', 'خ'], ['gh', 'غ'], ['s̱', 'ث']];
const SINGLE = {
  b: 'ب', t: 'ت', c: 'ج', j: 'ج', H: 'ح', 'ḥ': 'ح', 7: 'ح', x: 'خ', 'ḫ': 'خ', d: 'د', 'ẕ': 'ذ', r: 'ر', z: 'ز',
  s: 'س', 'ş': 'ش', S: 'ص', 'ṣ': 'ص', D: 'ض', 'ḍ': 'ض', 'ż': 'ض', T: 'ط', 'ṭ': 'ط', Z: 'ظ', 'ẓ': 'ظ',
  "'": 'ء', 'ʾ': 'ء', 2: 'ء', '`': 'ع', 'ʿ': 'ع', 3: 'ع', 'ğ': 'غ', g: 'غ', f: 'ف', q: 'ق', 'ḳ': 'ق', k: 'ك',
  l: 'ل', m: 'م', n: 'ن', h: 'ه', w: 'و', v: 'و', y: 'ي', p: 'ب', 'â': 'ا', 'î': 'ي', 'û': 'و', 'ā': 'ا', 'ī': 'ي', 'ū': 'و',
};
function latinToArabic(s) {
  return s.trim().split(/\s+/).map((w) => {
    let out = '';
    for (let i = 0; i < w.length; i++) {
      const two = w.slice(i, i + 2).toLowerCase();
      const dg = DIGRAPH.find(([k]) => k === two);
      if (dg) { out += dg[1]; i++; continue; }
      const c = w[i];
      if (/[aiueoı]/i.test(c) && !SINGLE[c]) { if (i === 0) out += 'ا'; if (/[aA]/.test(c) && w[i + 1] === 't' && i + 2 === w.length) { out += 'ة'; i++; } continue; }
      out += SINGLE[c] ?? SINGLE[c.toLowerCase()] ?? '';
    }
    return out;
  }).join(' ');
}
const hasLatin = (s) => /[a-zA-Zâîûāīūḥḫṣḍṭẓż'ʿʾ`37]/.test(s) && !/[؀-ۿ]/.test(s);

// ---------- Arama kutusu, öneriler, klavye ----------
const form = $('#search');
const input = $('#q');
const sugg = $('#suggest');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  let q = input.value.trim();
  if (!q) return;
  if (hasLatin(q)) { const ar = latinToArabic(q); toast(`${q} → ${ar}`); q = ar; input.value = ar; }
  sugg.hidden = true;
  go(`/w/${encodeURIComponent(q)}`);
});

let suggTimer, suggIdx = -1;
input.addEventListener('input', () => {
  clearTimeout(suggTimer);
  const q = input.value.trim();
  if (q.length < 2 || hasLatin(q)) { sugg.hidden = true; return; }
  suggTimer = setTimeout(async () => {
    try {
      const rows = await api(`/api/suggest?q=${encodeURIComponent(q)}`);
      suggIdx = -1;
      sugg.innerHTML = rows.map((r, i) => `<li role="option" id="sg${i}" data-w="${esc(r.lemma_voc)}"><span class="ar">${esc(r.lemma_voc)}</span>${r.q ? `<small class="muted">Kur'an: ${r.q}</small>` : ''}</li>`).join('');
      sugg.hidden = !rows.length;
    } catch { sugg.hidden = true; }
  }, 180);
});
input.addEventListener('keydown', (e) => {
  const items = $$('li', sugg);
  if (sugg.hidden || !items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggIdx = (suggIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.setAttribute('aria-selected', String(i === suggIdx)));
    input.setAttribute('aria-activedescendant', items[suggIdx].id);
  } else if (e.key === 'Enter' && suggIdx >= 0) {
    e.preventDefault(); input.value = items[suggIdx].dataset.w; form.requestSubmit();
  } else if (e.key === 'Escape') sugg.hidden = true;
});
sugg.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) { input.value = li.dataset.w; form.requestSubmit(); }
});
document.addEventListener('click', (e) => { if (!form.contains(e.target)) sugg.hidden = true; });

const KBD_LETTERS = 'ا أ إ آ ء ؤ ئ ب ت ة ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي ى'.split(' ');
const KBD_MARKS = [['َ', 'üstün'], ['ِ', 'esre'], ['ُ', 'ötre'], ['ْ', 'cezm'], ['ّ', 'şedde'], ['ً', 'iki üstün'], ['ٍ', 'iki esre'], ['ٌ', 'iki ötre']];
const kbd = $('#kbd');
kbd.innerHTML = KBD_LETTERS.map((l) => `<button type="button" data-k="${l}">${l}</button>`).join('')
  + KBD_MARKS.map(([m, n]) => `<button type="button" class="mark" data-k="${m}" title="${n}" aria-label="${n}">ـ${m}</button>`).join('')
  + '<button type="button" class="wide" data-k=" ">boşluk</button><button type="button" class="wide" data-del>sil</button>';
kbd.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const { selectionStart: s = input.value.length, selectionEnd: en = input.value.length } = input;
  if (b.dataset.del !== undefined) {
    const from = s === en ? Math.max(0, s - 1) : s;
    input.value = input.value.slice(0, from) + input.value.slice(en);
    input.setSelectionRange(from, from);
  } else {
    input.value = input.value.slice(0, s) + b.dataset.k + input.value.slice(en);
    input.setSelectionRange(s + 1, s + 1);
  }
  input.focus();
});
$('#kbd-toggle').addEventListener('click', (e) => {
  kbd.hidden = !kbd.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!kbd.hidden));
});

// ---------- Favoriler (tarayıcıda) ----------
const FAV_KEY = 'lugat.favoriler';
function favs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; } }
function saveFavs(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { toast('Tarayıcı depolaması kullanılamıyor; favori kaydedilemedi.'); }
  updateFavCount();
}
function updateFavCount() {
  const n = favs().length;
  const el = $('#fav-count');
  el.hidden = !n; el.textContent = n;
}
const favId = (key, rootId) => `${key}|${rootId ?? ''}`;

// ---------- Yönlendirme ----------
function go(path) { history.pushState({}, '', path + (preview() ? (path.includes('?') ? '&' : '?') + 'preview=1' : '')); route(); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
addEventListener('popstate', route);

async function route() {
  const p = decodeURIComponent(location.pathname);
  $$('.nav a').forEach((a) => a.removeAttribute('aria-current'));
  const mark = (href) => $(`.nav a[href="${href}"]`)?.setAttribute('aria-current', 'page');
  sugg.hidden = true;
  try {
    if (p.startsWith('/w/') || p.startsWith('/k/')) {
      const params = new URLSearchParams(location.search);
      await renderResult(p.slice(3), params.get('key'), params.get('root'));
    } else if (p === '/favoriler') { mark('/favoriler'); renderFavorites(); }
    else if (p === '/rehber') { mark('/rehber'); await renderGuide(); }
    else if (p === '/hakkinda') { mark('/hakkinda'); renderAbout(); }
    else { mark('/'); await renderHome(); }
  } catch (err) {
    main.innerHTML = `<div class="block"><h2>Bir sorun oluştu</h2><p>${esc(err.message)}</p></div>`;
  }
  if (!location.hash) { main.focus({ preventScroll: true }); scrollTo(0, 0); }
}

// ---------- Ana sayfa ----------
const LEVELS = { kolay: 'Kolay', orta: 'Orta', zor: 'Zor', cok_zor: 'Çok zor' };
async function renderHome() {
  document.title = 'Lügat Portalı';
  input.value = '';
  main.innerHTML = '<p class="muted">Yükleniyor…</p>';
  const [stats, words] = await Promise.all([api('/api/stats').catch(() => null), fetch('/data/control_words.json').then((r) => r.json()).catch(() => null)]);
  const stat = (n, l) => `<div class="stat"><b>${fmt.format(n)}</b>${l}</div>`;
  main.innerHTML = `
    <section class="hero">
      <h1>Arapça kelimeyi bütün sözlüklerde tek seferde arayın</h1>
      <p class="muted">Kök ve sarf bilgisi · klasik ve modern sözlükler · Türkçe karşılıklar · Kur'an'daki geçişler · eş ve zıt anlamlılar · aynı kökten türeyenler</p>
      ${stats ? `<div class="stats">${stat(stats.lemmas, 'kelime')}${stat(stats.roots, 'kök')}${stat(stats.entries, 'sözlük maddesi')}${stat(stats.quran, "Kur'an geçişi")}${stat(stats.translations, 'Türkçe/İngilizce karşılık')}</div>` : ''}
      <p class="muted">Yalnızca kaynaklar arasında karşılaştırılıp onaylanmış kayıtlar gösterilir.</p>
    </section>
    ${words ? `<section class="block"><h2>Örnek kelimeler — zorluk seviyesine göre</h2>
      ${Object.entries(LEVELS).map(([k, label]) => `<div class="level"><h3>${label} <span class="muted" style="font-weight:400">— ${esc(words.seviyeler[k])}</span></h3>
        <div class="examples" style="justify-content:flex-start">${words.kelimeler.filter((w) => w.seviye === k).map((w) =>
          `<a class="chip" href="/w/${encodeURIComponent(w.kelime)}" data-link title="${esc(w.amac)}"><span class="ar" lang="ar">${esc(w.kelime)}</span></a>`).join('')}</div></div>`).join('')}
    </section>` : ''}`;
}

// ---------- Sonuç sayfası ----------
const BLOCKS = [
  ['b1', 'Kelime'], ['b2', 'Türkçe karşılıklar'], ['b3', 'Klasik sözlükler'], ['b4', 'Modern sözlükler'],
  ['b5', "Kur'an bağlamı"], ['b6', 'Eş ve zıt anlamlılar'], ['b7', 'Aynı kökten türeyenler'],
  ['b8', 'Hangi sözlüğe bakmalı'], ['b9', 'Dış kaynaklarda aç'],
];
const REL_TR = { synonym: 'Eş anlamlılar', antonym: 'Zıt anlamlılar', hypernym: 'Üst kavram', hyponym: 'Alt kavram', similar: 'Yakın anlamlı' };
const GROUP_TR = { klasik: 'Klasik', modern: 'Modern', istilah: "Istılah ve garîbü'l-Kur'an", turkce: 'Arapça–Türkçe', ingilizce: 'Arapça–İngilizce' };
const SRC_TR = { quran_corpus: "Kur'an korpusu", arramooz: 'Arramooz', m3ajim: 'm3ajim', lisan_json: 'Lisân JSON', lane: 'Lane', wordnet: 'WordNet', omw: 'OMW-TR', wiktionary: 'Wiktionary', sinalab: 'SinaLab', arabiclt_synonym: 'arabicLT', arabiclt_antonym: 'arabicLT', elle: 'elle' };
const src = (s) => `<span class="badge src">${esc(SRC_TR[s] ?? s)}</span>`;
const pendingBadge = (p) => (p ? '<span class="badge warn">onay bekliyor</span>' : '');
const wordLink = (w, cls = 'ar') => `<a href="/w/${encodeURIComponent(w)}" data-link class="${cls}" lang="ar">${esc(w)}</a>`;

let current = null;

async function renderResult(q, key, root) {
  input.value = q;
  document.title = `${q} — Lügat Portalı`;
  main.innerHTML = '<p class="muted">Aranıyor…</p>';
  const qs = new URLSearchParams({ q });
  if (key) qs.set('key', key);
  if (root) qs.set('root', root);
  const r = await api(`/api/search?${qs}`);
  current = r;
  const empty = !r.lemma && !r.root;
  if (empty) {
    main.innerHTML = `<div class="block"><h2>“<span class="ar" lang="ar">${esc(q)}</span>” için onaylanmış kayıt bulunamadı</h2>
      <p>Kelimeyi harekesiz ya da kökünü (ör. <a href="/w/${encodeURIComponent('كتب')}" data-link class="ar">كتب</a>) yazarak deneyin. Aşağıdaki dış kaynaklarda da arayabilirsiniz.</p></div>
      ${blockLinks(r)}`;
    return;
  }
  const has = {
    b1: true, b2: r.translations.length, b3: r.entries.some((g) => g.group === 'klasik'),
    b4: r.entries.some((g) => g.group !== 'klasik'), b5: r.quran.root_count, b6: Object.keys(r.relations).length,
    b7: r.derivatives.length, b8: r.guide.length, b9: r.links.length,
  };
  main.innerHTML = `
    ${r.preview ? '<div class="preview-bar"><b>Yönetici önizlemesi:</b> onay bekleyen kayıtlar da gösteriliyor (sarı zeminli). Ziyaretçiler yalnızca onaylıları görür.</div>' : ''}
    <div class="result">
      <nav class="toc" aria-label="Bölümler"><ol>${BLOCKS.map(([id, t]) => `<li><a href="#${id}" class="${has[id] ? '' : 'empty'}">${t}</a></li>`).join('')}</ol></nav>
      <div>${blockHead(r)}${blockTr(r)}${blockEntries(r, 'b3', 3, 'Klasik sözlükler', (g) => g.group === 'klasik')}
        ${blockEntries(r, 'b4', 4, 'Modern, ıstılah ve iki dilli sözlükler', (g) => g.group !== 'klasik')}
        ${blockQuran(r)}${blockRel(r)}${blockDeriv(r)}${blockGuide(r)}${blockLinks(r)}</div>
    </div>`;
  if (location.hash) $(location.hash)?.scrollIntoView();
}

function blockShell(id, n, title, body, { empty = false, extra = '' } = {}) {
  return `<section class="block" id="${id}" aria-labelledby="${id}-h">
    <h2 id="${id}-h"><span class="n">${n}</span>${title}<span class="spacer"></span>${extra}
      <button class="small no-print" data-report="${id}" title="Bu bölümdeki bir hatayı bildirin">Hata bildir</button></h2>
    ${empty ? `<p class="block-empty">${empty}</p>` : body}</section>`;
}

function blockHead(r) {
  const l = r.lemma;
  const fav = l && favs().some((f) => f.id === favId(l.lemma_key, r.root?.id));
  const rows = [];
  if (r.root) rows.push(['Kök', `${wordLink(r.root.root)} <span class="muted">(${esc(r.root.latin)})</span>`]);
  if (l?.pos) rows.push(['Tür', esc(l.pos) + (l.category && l.category !== l.pos && l.category !== 'fiil' ? ` · ${esc(l.category)}` : '')]);
  if (l?.verb_form && l.pos === 'fiil') rows.push(['Bab', /^[IVX]+$/.test(l.verb_form) ? `${esc(l.verb_form)}. bab` : esc(l.verb_form)]);
  if (l?.pattern && l.pos === 'fiil') { if (l.verb_form === 'I') rows.push(['Muzâri', esc(l.pattern)]); }
  else if (l?.pattern) rows.push(['Vezin', `<span class="ar">${esc(l.pattern)}</span>`]);
  if (l?.plural) rows.push(['Çoğul', `<span class="ar">${esc(l.plural)}</span>`]);
  if (l?.gender) rows.push(['Cinsiyet', esc(l.gender)]);
  if (l?.latin) rows.push(['Transkripsiyon', `${esc(l.latin)} <span class="muted">(otomatik)</span>`]);
  if (l) rows.push(['Kaynaklar', l.sources.map(src).join(' ') + (l.agree_count > 1 ? ' <span class="badge ok">kaynaklar uyumlu</span>' : '') + (l.conflict ? ` <span class="badge bad" title="${esc(l.compare_note)}">kaynaklar arasında fark var</span>` : '') + pendingBadge(l.pending)]);
  const others = r.candidates.filter((c) => !(l && c.lemma_key === l.lemma_key && c.root_id === r.root?.id));
  const body = `<div class="head-card">
      <div>
        <div class="ar-lg head-word" lang="ar">${esc(l?.voc ?? r.root?.root ?? r.query)}</div>
        ${!l && r.root ? '<p class="muted">Kök sayfası: bu kökten türeyen kelimeler aşağıda.</p>' : ''}
        ${r.via && r.via !== 'kelime' ? `<p class="muted">Eşleşme yolu: ${esc(r.via)} (“${esc(r.query)}”)</p>` : ''}
        <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      </div>
      <div class="actions">
        ${l ? `<button id="fav-btn" class="${fav ? 'on' : ''}" aria-pressed="${fav}">${fav ? '★ Favoride' : '☆ Favoriye ekle'}</button>` : ''}
        <button onclick="window.print()">Yazdır / PDF</button>
        <button id="share-btn">Bağlantıyı kopyala</button>
      </div>
    </div>
    ${others.length ? `<div class="candidates"><span class="muted">Diğer eşleşmeler:</span>${others.map((c) =>
      `<a class="chip" data-link href="/w/${encodeURIComponent(r.query)}?key=${encodeURIComponent(c.lemma_key)}&root=${c.root_id ?? ''}"><span class="ar" lang="ar">${esc(c.voc)}</span><small class="muted">${esc(c.root ?? '')} ${esc(c.pos ?? '')}</small></a>`).join('')}</div>` : ''}`;
  return blockShell('b1', 1, 'Kelime', body);
}

function blockTr(r) {
  const by = { tr: [], ota: [], en: [] };
  r.translations.forEach((t) => by[t.lang]?.push(t));
  const list = (arr) => `<ul class="tr-list">${arr.map((t) => `<li class="${t.status !== 'approved' ? 'pending' : ''}">${esc(t.gloss)} ${src(t.source)}${t.agree_count > 1 ? '<span class="badge ok">uyumlu</span>' : ''}</li>`).join('')}</ul>`;
  const body = [by.tr.length && `<div class="group-title">Türkçe</div>${list(by.tr)}`, by.ota.length && `<div class="group-title">Osmanlı Türkçesi</div>${list(by.ota)}`, by.en.length && `<div class="group-title">İngilizce</div>${list(by.en)}`].filter(Boolean).join('');
  return blockShell('b2', 2, 'Türkçe karşılıklar', body, {
    empty: !r.translations.length && 'Bu kelime için henüz onaylanmış Türkçe karşılık yok. Almaany Arapça–Türkçe bağlantısı 9. bölümde.',
  });
}

function blockEntries(r, id, n, title, filter) {
  const groups = r.entries.filter(filter);
  const body = groups.map((g) => `<div class="group-title">${esc(GROUP_TR[g.group] ?? g.group)}</div>` + g.dictionaries.map((d) => `
    <details class="dict" ${g.group === 'klasik' && d === g.dictionaries[0] ? 'open' : ''}>
      <summary><b>${esc(d.name_tr)}</b> <span class="ar" lang="ar">${esc(d.name_ar)}</span><span class="muted">${esc([d.author, d.death].filter(Boolean).join(', '))}</span><span class="muted">· ${d.items.length} madde</span></summary>
      ${d.items.map((e) => `<div class="entry ${e.status !== 'approved' ? 'pending' : ''}">
        <div class="ar" dir="auto" lang="ar" id="entry-${e.id}">${esc(e.body)}${e.truncated ? '…' : ''}</div>
        <div class="meta">${esc(e.headword)} · ${src(e.source)}${e.page_ref ? ` · ${esc(e.page_ref)}` : ''}${e.agree_count > 1 ? ' <span class="badge ok">kaynaklarla uyumlu</span>' : ''}${e.conflict ? ` <span class="badge bad" title="${esc(e.compare_note)}">kaynaklar arasında fark</span>` : ''}${pendingBadge(e.status !== 'approved')}
        ${e.truncated ? ` · <button class="link" data-full="${e.id}">tamamını göster</button>` : ''}</div></div>`).join('')}
    </details>`).join('')).join('');
  return blockShell(id, n, title, body, {
    empty: !groups.length && (id === 'b3'
      ? 'Bu kök için henüz onaylanmış klasik sözlük maddesi yok. Hawramani ve Ejtaal bağlantıları 9. bölümde.'
      : 'Henüz onaylanmış modern sözlük maddesi yok. Almaany ve Hawramani bağlantıları 9. bölümde.'),
  });
}

function highlight(text, idx) {
  const ws = text.split(' ');
  return ws.map((w, i) => (i === idx - 1 ? `<mark>${esc(w)}</mark>` : esc(w))).join(' ');
}

function verseHtml(v) {
  return `<div class="verse"><div class="quran" lang="ar">${highlight(v.text, v.word_index)}</div>
    <div class="ref">${esc(suraName(v.sura))} ${v.sura}:${v.aya} · <a href="https://corpus.quran.com/wordbyword.jsp?chapter=${v.sura}&verse=${v.aya}" target="_blank" rel="noopener">kelime kelime</a></div></div>`;
}

function blockQuran(r) {
  const q = r.quran;
  const head = (q.via_lemma ? `<p class="muted">Kur'an korpusu bu kelimeyi <span class="ar" lang="ar">${esc(q.via_lemma)}</span> lemması altında topluyor.</p>` : '') + (q.lemma_count
    ? `<p>Bu kelime Kur'an'da <b>${fmt.format(q.lemma_count)}</b> yerde geçiyor; <span class="ar" lang="ar">${esc(r.root?.root)}</span> kökünden türeyen kelimeler toplam <b>${fmt.format(q.root_count)}</b> yerde.</p>`
    : q.root_count ? `<p>Bu kelime Kur'an'da bu biçimiyle geçmiyor; <span class="ar" lang="ar">${esc(r.root?.root)}</span> kökünden türeyenler <b>${fmt.format(q.root_count)}</b> yerde geçiyor. Aşağıda kökün geçişleri:</p>` : '');
  const total = q.lemma_count || q.root_count;
  const body = `${head}<div id="verses">${q.verses.map(verseHtml).join('')}</div>
    ${total > q.verses.length ? `<button class="small no-print" id="more-verses" data-offset="${q.verses.length}">Devamını yükle (${fmt.format(total - q.verses.length)} kaldı)</button>` : ''}
    <p class="muted" style="font-size:.82rem">Morfoloji: Quranic Arabic Corpus (corpus.quran.com), GNU GPL.</p>`;
  return blockShell('b5', 5, "Kur'an bağlamı", body, { empty: !q.root_count && "Bu kelime ve kökü Kur'an'da geçmiyor." });
}

function blockRel(r) {
  const kinds = Object.entries(r.relations);
  const body = kinds.map(([k, arr]) => `<div class="rel-group"><div class="group-title">${REL_TR[k] ?? k}</div><div class="word-chips">${arr.map((x) =>
    `<a class="chip ${x.pending ? 'pending' : ''}" data-link href="/w/${encodeURIComponent(x.text)}" title="${esc(x.sources.map((s) => SRC_TR[s] ?? s).join(', '))}"><span class="ar" lang="ar">${esc(x.text)}</span>${x.agree > 1 ? '<span class="badge ok">✓</span>' : ''}</a>`).join('')}</div></div>`).join('');
  return blockShell('b6', 6, 'Eş ve zıt anlamlılar', body, { empty: !kinds.length && 'Henüz onaylanmış eş/zıt anlam ilişkisi yok.' });
}

function blockDeriv(r) {
  const body = r.derivatives.map((g) => `<div class="group-title">${esc(g.group)} (${g.items.length})</div><div class="deriv">${g.items.map((d) =>
    `<a data-link href="/w/${encodeURIComponent(d.voc)}" class="${d.pending ? 'pending' : ''}"><span class="ar" lang="ar">${esc(d.voc)}</span><small>${[d.pattern && `<span lang="ar">${esc(d.pattern)}</span>`, d.quran ? `Kur'an: ${d.quran}` : ''].filter(Boolean).join(' · ')}</small></a>`).join('')}</div>`).join('');
  return blockShell('b7', 7, `Aynı kökten türeyenler${r.root ? ` <span class="ar" lang="ar">(${esc(r.root.root)})</span>` : ''}`, body, { empty: !r.derivatives.length && 'Kök bilgisi bulunamadı.' });
}

function blockGuide(r) {
  const body = r.guide.map((g) => `<div class="guide-item"><b>${esc(g.type_name)}</b> — ${esc(g.why)}<br><span class="muted">${esc(g.type_def)}</span>
    ${g.dictionaries.length ? `<div class="muted">Öneri: ${g.dictionaries.map((c) => `<a href="/rehber#d-${c}" data-link>${esc(DICT_NAMES[c] ?? c)}</a>`).join(', ')}</div>` : ''}</div>`).join('');
  return blockShell('b8', 8, 'Hangi sözlük türüne bakmalı', body);
}

function blockLinks(r) {
  const body = `<div class="links">${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)} ↗<small>${esc(l.description)}${l.scope === 'root' ? ' · kök ile' : ''}</small></a>`).join('')}</div>
    <p class="muted" style="font-size:.82rem">Bu siteler yeni sekmede açılır; içerikleri ilgili sitelerin sorumluluğundadır.</p>`;
  return blockShell('b9', 9, 'Dış kaynaklarda aç', body);
}

// Sonuç sayfası etkileşimleri
main.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.id === 'fav-btn' && current?.lemma) {
    const l = current.lemma;
    const id = favId(l.lemma_key, current.root?.id);
    let list = favs();
    if (list.some((f) => f.id === id)) { list = list.filter((f) => f.id !== id); toast('Favorilerden çıkarıldı'); }
    else { list.unshift({ id, voc: l.voc, key: l.lemma_key, root: current.root?.root ?? '', root_id: current.root?.id ?? null, q: current.query, note: '', added: new Date().toISOString() }); toast('Favorilere eklendi'); }
    saveFavs(list);
    const on = list.some((f) => f.id === id);
    t.classList.toggle('on', on); t.setAttribute('aria-pressed', String(on)); t.textContent = on ? '★ Favoride' : '☆ Favoriye ekle';
  } else if (t.id === 'share-btn') {
    navigator.clipboard?.writeText(location.href.replace(/[?&]preview=1/, '')).then(() => toast('Bağlantı kopyalandı'));
  } else if (t.dataset.full) {
    const e2 = await api(`/api/entry/${t.dataset.full}`);
    $(`#entry-${t.dataset.full}`).textContent = e2.body;
    t.remove();
  } else if (t.id === 'more-verses') {
    const q = current.quran;
    const qs = new URLSearchParams({ root: current.root.id, mode: q.mode, offset: t.dataset.offset });
    if (q.key) qs.set('key', q.key);
    const rows = await api(`/api/quran?${qs}`);
    $('#verses').insertAdjacentHTML('beforeend', rows.map(verseHtml).join(''));
    const off = Number(t.dataset.offset) + rows.length;
    const total = q.lemma_count || q.root_count;
    if (!rows.length || off >= total) t.remove(); else { t.dataset.offset = off; t.textContent = `Devamını yükle (${fmt.format(total - off)} kaldı)`; }
  } else if (t.dataset.report) {
    openReport(t.dataset.report);
  }
});

// ---------- Hata bildirimi ----------
const dlg = $('#report-dlg');
let reportCtx = null;
function openReport(block) {
  reportCtx = { block, query: current?.query };
  $('#report-target').textContent = `“${current?.query ?? ''}” · ${BLOCKS.find(([id]) => id === block)?.[1] ?? ''}`;
  $('#report-msg').value = '';
  dlg.showModal();
}
dlg.addEventListener('close', async () => {
  if (dlg.returnValue !== 'send' || !reportCtx) return;
  const msg = $('#report-msg').value.trim();
  if (msg.length < 5) return;
  const r = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: reportCtx.query, message: `[${reportCtx.block}] ${msg}` }) });
  toast(r.ok ? 'Teşekkürler; bildiriminiz incelenecek.' : 'Gönderilemedi, lütfen tekrar deneyin.');
});

// ---------- Favoriler ekranı ----------
function renderFavorites() {
  document.title = 'Favoriler — Lügat Portalı';
  const list = favs();
  const roots = [...new Set(list.map((f) => f.root).filter(Boolean))].sort();
  main.innerHTML = `<section class="block"><h2>Favoriler <span class="n">${list.length}</span></h2>
    ${list.length ? `
    <p class="muted">Favoriler yalnızca bu tarayıcıda saklanır; başka cihaza taşımak için CSV/Markdown olarak dışa aktarabilirsiniz.</p>
    <div class="filters">
      <label>Kök <select id="f-root"><option value="">hepsi</option>${roots.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label>Ara <input id="f-text" placeholder="kelime veya not"></label>
      <span class="spacer" style="flex:1"></span>
      <button id="sel-all" class="small">Tümünü seç</button>
      <button id="print-sel" class="small primary">Seçilenleri yazdır / PDF</button>
      <button id="csv" class="small">CSV</button>
      <button id="md" class="small">Markdown</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th><span class="sr-only">Seç</span></th><th>Kelime</th><th>Kök</th><th>Not</th><th>Eklenme</th><th></th></tr></thead>
    <tbody>${list.map((f) => `<tr data-id="${esc(f.id)}" data-root="${esc(f.root)}">
      <td><input type="checkbox" class="sel" aria-label="${esc(f.voc)} seç"></td>
      <td>${wordLink(f.voc)}</td><td class="ar" lang="ar">${esc(f.root)}</td>
      <td><input class="note-input" value="${esc(f.note)}" placeholder="not ekleyin" aria-label="${esc(f.voc)} notu"></td>
      <td class="muted">${new Date(f.added).toLocaleDateString('tr-TR')}</td>
      <td><button class="small del">Sil</button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="block-empty">Henüz favori yok. Bir kelime sayfasında “☆ Favoriye ekle” düğmesini kullanın.</p>'}</section>`;
  if (!list.length) return;
  const filter = () => {
    const r = $('#f-root').value, t = $('#f-text').value.trim();
    $$('tbody tr', main).forEach((tr) => {
      const f = favs().find((x) => x.id === tr.dataset.id);
      tr.hidden = (r && tr.dataset.root !== r) || (t && !(`${f.voc} ${f.note}`.includes(t)));
    });
  };
  $('#f-root').onchange = filter; $('#f-text').oninput = filter;
  $$('.del', main).forEach((b) => (b.onclick = () => { const id = b.closest('tr').dataset.id; saveFavs(favs().filter((f) => f.id !== id)); renderFavorites(); }));
  $('#sel-all').onclick = () => { const boxes = $$('tbody tr:not([hidden]) .sel', main); const all = boxes.every((b) => b.checked); boxes.forEach((b) => (b.checked = !all)); };
  const selected = () => { const ids = $$('.sel', main).filter((b) => b.checked).map((b) => b.closest('tr').dataset.id); const l = favs(); return (ids.length ? l.filter((f) => ids.includes(f.id)) : l.filter((f) => !$(`tr[data-id="${CSS.escape(f.id)}"]`)?.hidden)); };
  $('#csv').onclick = () => download('favoriler.csv', 'kelime,kok,not,eklenme,adres\n' + selected().map((f) => [f.voc, f.root, f.note, f.added, `${location.origin}/w/${encodeURIComponent(f.voc)}`].map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  $('#md').onclick = () => download('favoriler.md', '# Favoriler\n\n| Kelime | Kök | Not |\n|---|---|---|\n' + selected().map((f) => `| [${f.voc}](${location.origin}/w/${encodeURIComponent(f.voc)}) | ${f.root} | ${(f.note || '').replace(/\|/g, '\\|')} |`).join('\n') + '\n', 'text/markdown');
  $('#print-sel').onclick = () => printFavorites(selected());
}

main.addEventListener('change', (e) => {
  if (!e.target.classList.contains('note-input')) return;
  const id = e.target.closest('tr').dataset.id;
  saveFavs(favs().map((f) => (f.id === id ? { ...f, note: e.target.value } : f)));
  toast('Not kaydedildi');
});

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: `${type};charset=utf-8` }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function printFavorites(list) {
  if (!list.length) return toast('Yazdırılacak kelime yok');
  toast(`${list.length} kelime hazırlanıyor…`);
  const area = $('#print-area');
  const parts = [];
  for (const f of list) {
    try {
      const qs = new URLSearchParams({ q: f.voc, key: f.key });
      if (f.root_id) qs.set('root', f.root_id);
      const r = await api(`/api/search?${qs}`);
      const dictCites = r.entries.flatMap((g) => g.dictionaries.map((d) => `${d.name_tr}${d.author ? ` (${d.author})` : ''}`));
      parts.push(`<article class="print-word">${blockHead(r)}${f.note ? `<p><b>Not:</b> ${esc(f.note)}</p>` : ''}${blockTr(r)}
        ${blockEntries(r, 'b3', 3, 'Klasik sözlükler', (g) => g.group === 'klasik')}${blockEntries(r, 'b4', 4, 'Modern sözlükler', (g) => g.group !== 'klasik')}
        ${blockQuran(r)}${blockRel(r)}${blockDeriv(r)}
        <p class="cite">Kaynak: Lügat Portalı, ${location.origin}/w/${encodeURIComponent(f.voc)} (${new Date().toLocaleDateString('tr-TR')})${dictCites.length ? ' · Sözlükler: ' + esc(dictCites.join('; ')) : ''} · Kur'an morfolojisi: Quranic Arabic Corpus.</p></article>`);
    } catch (err) { parts.push(`<article class="print-word"><p>${esc(f.voc)}: ${esc(err.message)}</p></article>`); }
  }
  area.innerHTML = parts.join('');
  $$('details', area).forEach((d) => (d.open = true));
  document.body.classList.add('printing-favs');
  addEventListener('afterprint', () => { document.body.classList.remove('printing-favs'); area.innerHTML = ''; }, { once: true });
  print();
}

// ---------- Sözlük Rehberi ----------
const DICT_NAMES = {};
const TYPE_TR = { lugha: 'Lügat', qamus: 'Kâmûs', mujam: "Mu'cem", gharib: 'Garîb', istilah: 'Istılah', bilingual: 'İki dilli' };
const ORDERINGS = [
  ['Mahreç (ses) tertibi', "Harfler boğazdan dudağa çıkış yerlerine göre dizilir (ع ح ه خ غ ق ك ...). Kitâbü'l-Ayn, Tehzîb ve Muhkem bu düzendedir. Aramak için kökün harflerini mahreç sırasına göre düşünmek gerekir."],
  ['Taklîbât', 'Bir kökün harflerinin bütün dizilişleri (كتب، كبت، تكب، تبك، بكت، بتك) tek maddede ele alınır; kullanılanlar (müsta\'mel) ve kullanılmayanlar (mühmel) ayrılır. Halîl b. Ahmed\'in yöntemi.'],
  ['Kafiye (bab–fasıl) tertibi', "Kökün SON harfi bab, İLK harfi fasıl olur. كتب kökü “bâbü'l-bâ, faslü'l-kâf” altındadır. Sıhâh, Lisânü'l-Arab, Kâmûs ve Tâcü'l-Arûs bu düzendedir; Vankulu ve Kâmûs Tercümesi de öyle."],
  ['Alfabetik kök (ilk harf) tertibi', "Kök, ilk harfinden başlayarak alfabe sırasıyla aranır. Mekâyîs, Esâsü'l-Belâga, Misbâh, Vasît ve Müncid. Kökü bilmek gerekir."],
  ['Alfabetik kelime tertibi', 'Kelime zâid harfleriyle, yazıldığı gibi sıralanır (ör. استغفار “elif” altında). er-Râid ve bazı modern sözlükler; kök bilmeyen için kolaydır.'],
];

async function renderGuide() {
  document.title = 'Sözlük Rehberi — Lügat Portalı';
  main.innerHTML = '<p class="muted">Yükleniyor…</p>';
  const dicts = await api('/api/dictionaries');
  const grp = (g) => dicts.filter((d) => d.grp === g);
  const table = (rows) => `<div class="table-wrap"><table><thead><tr><th>Sözlük</th><th>Müellif / tarih</th><th>Tertip</th><th>Kapsam</th><th>Tür</th><th>Telif</th><th>Veri durumu</th></tr></thead><tbody>
    ${rows.map((d) => `<tr id="d-${esc(d.code)}"><td><b>${esc(d.name_tr)}</b><br><span class="ar" lang="ar">${esc(d.name_ar)}</span></td>
      <td>${esc(d.author)}<br><span class="muted">${esc(d.death)}</span></td><td>${esc(d.ordering)}</td><td>${esc(d.scope)}</td>
      <td>${esc(TYPE_TR[d.type] ?? d.type)}</td><td>${esc(d.license)}</td>
      <td>${d.approved_entries ? `<span class="badge ok">Portalda: ${fmt.format(d.approved_entries)} madde</span>` : `<span class="muted">${esc(d.open_data)}</span>`}
      ${d.link ? `<br><a href="${esc(d.link)}" target="_blank" rel="noopener">dış bağlantı ↗</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  main.innerHTML = `
    <section class="block"><h2>Sözlük Rehberi</h2>
      <p>Hangi sözlükte nasıl arama yapılacağını ve portalda hangi sözlüklerin metninin bulunduğunu gösterir. “Portalda” etiketi yalnızca karşılaştırılıp onaylanmış maddeler için görünür.</p></section>
    <section class="block"><h2>Tertip yöntemleri</h2>${ORDERINGS.map(([t, d]) => `<div class="guide-item"><b>${t}</b><br>${esc(d)}</div>`).join('')}</section>
    <section class="block"><h2>Arapça–Arapça (klasik)</h2>${table(grp('klasik'))}</section>
    <section class="block"><h2>Arapça–Arapça (modern)</h2>${table(grp('modern'))}</section>
    <section class="block"><h2>Istılah ve garîbü'l-Kur'an</h2>${table(grp('istilah'))}</section>
    <section class="block"><h2>Arapça–Türkçe</h2>${table(grp('turkce'))}</section>
    <section class="block"><h2>Arapça–İngilizce</h2>${table(grp('ingilizce'))}</section>`;
  if (location.hash) $(location.hash)?.scrollIntoView();
}

// ---------- Kaynaklar ve lisanslar ----------
function renderAbout() {
  document.title = 'Kaynaklar — Lügat Portalı';
  main.innerHTML = `<section class="block prose">
    <h2>Kaynaklar ve lisanslar</h2>
    <p>Portal ücretsizdir ve ticari amaç taşımaz. Aşağıdaki açık kaynakların lisans koşullarına uyar; telifli sözlüklerin metnini barındırmaz, yalnızca ilgili sitelere bağlantı verir.</p>
    <ul>
      <li><b>Quranic Arabic Corpus</b> (Kais Dukes ve ekibi, Leeds Üniversitesi) — kök, lemma ve morfoloji. GNU GPL. <a href="https://corpus.quran.com" rel="noopener">corpus.quran.com</a>. Arapça harfli sürüm: mustafa0x/quran-morphology.</li>
      <li><b>Arramooz Alwaseet</b> (Taha Zerrouki) — isim ve fiil sözlüğü, vezin, çoğul. GPL.</li>
      <li><b>m3ajim</b> — 40 Arapça sözlüğün derlemesi. CC BY-NC 4.0 (yalnız ticari olmayan kullanım).</li>
      <li><b>Lisânü'l-Arab</b> tam metin JSON (Hugging Face: enver/lisan_al_alab) — metin kamu malı.</li>
      <li><b>Lane, Arabic-English Lexicon</b> — kamu malı; dijital sürüm GibreelAbdullah/LaneLexicon.</li>
      <li><b>Arabic WordNet 4.1</b> — CC BY 4.0. <b>SinaLab Synonyms</b> (Birzeit Üniversitesi) — CC BY 4.0.</li>
      <li><b>Wiktionary / kaikki.org</b> — CC BY-SA 3.0; bu kaynaktan gelen karşılıklar aynı lisansla paylaşılır.</li>
    </ul>
    <h2>Kontrol süreci</h2>
    <p>Hiçbir kayıt otomatik yayımlanmaz. Her kaynak önce “onay bekliyor” durumunda yüklenir; aynı bilgi başka kaynaklarla karşılaştırılır (ör. bir kelimenin kökü Kur'an korpusu ile Arramooz'da aynı mı, Lisânü'l-Arab'ın iki ayrı dijital nüshası aynı metni veriyor mu). Kaynakların ayrıştığı kayıtlar tek tek incelenir; diğerleri örneklem kontrolünden sonra toplu onaylanır. Kim neyi ne zaman onayladıysa kayıt altındadır.</p>
    <p>Kayıtlarda “kaynaklar uyumlu” etiketi birden fazla bağımsız kaynağın aynı bilgiyi verdiğini, “kaynaklar arasında fark var” etiketi ise incelenip yine de yayımlanmaya değer bulunduğunu gösterir.</p>
    <h2>Gizlilik</h2>
    <p>Portal çerez kullanmaz ve kullanıcı hesabı istemez. Favoriler ve notlar yalnızca sizin tarayıcınızda saklanır. “Hata bildir” formuyla gönderdiğiniz metin, aradığınız kelimeyle birlikte kaydedilir; kimlik bilgisi alınmaz.</p>
    <h2>Sorumluluk</h2>
    <p>Sözlük metinleri dijitalleştirme (OCR, ayrıştırma) hataları içerebilir. Akademik atıflarda basılı nüshanın cilt ve sayfasına başvurunuz.</p>
  </section>`;
}

// ---------- Sûre adları ----------
const SURA = "Fâtiha,Bakara,Âl-i İmrân,Nisâ,Mâide,En'âm,A'râf,Enfâl,Tevbe,Yûnus,Hûd,Yûsuf,Ra'd,İbrâhîm,Hicr,Nahl,İsrâ,Kehf,Meryem,Tâhâ,Enbiyâ,Hac,Mü'minûn,Nûr,Furkân,Şuarâ,Neml,Kasas,Ankebût,Rûm,Lokmân,Secde,Ahzâb,Sebe',Fâtır,Yâsîn,Sâffât,Sâd,Zümer,Mü'min,Fussılet,Şûrâ,Zuhruf,Duhân,Câsiye,Ahkâf,Muhammed,Fetih,Hucurât,Kâf,Zâriyât,Tûr,Necm,Kamer,Rahmân,Vâkıa,Hadîd,Mücâdele,Haşr,Mümtehine,Saf,Cuma,Münâfikûn,Tegâbün,Talâk,Tahrîm,Mülk,Kalem,Hâkka,Meâric,Nûh,Cin,Müzzemmil,Müddessir,Kıyâmet,İnsân,Mürselât,Nebe',Nâziât,Abese,Tekvîr,İnfitâr,Mutaffifîn,İnşikâk,Bürûc,Târık,A'lâ,Gâşiye,Fecr,Beled,Şems,Leyl,Duhâ,İnşirâh,Tîn,Alak,Kadr,Beyyine,Zilzâl,Âdiyât,Kâria,Tekâsür,Asr,Hümeze,Fîl,Kureyş,Mâûn,Kevser,Kâfirûn,Nasr,Tebbet,İhlâs,Felak,Nâs".split(',');
const suraName = (n) => SURA[n - 1] ?? '';

// Sözlük kodları → ad (rehber bağlantıları için); arka planda bir kez yüklenir
api('/api/dictionaries').then((ds) => ds.forEach((d) => (DICT_NAMES[d.code] = d.name_tr))).catch(() => {});

updateFavCount();
route();
