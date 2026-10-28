// Onay paneli: karşılaştırılmış verinin insan onayıyla yayına alınması.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const fmt = new Intl.NumberFormat('tr-TR');
let token = '';
try { token = sessionStorage.getItem('lugat.admin') || ''; } catch { /* özel pencere */ }

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Yetkisiz'); }
  if (!r.ok) throw new Error(data.error || `Hata ${r.status}`);
  return data;
}

function logout() { try { sessionStorage.removeItem('lugat.admin'); } catch {} token = ''; login(); }
$('#logout').onclick = (e) => { e.preventDefault(); logout(); };

function login(msg = '') {
  app.innerHTML = `<section class="block" style="max-width:460px;margin:40px auto">
    <h2>Yönetici girişi</h2>
    <form id="lf"><label for="tok">Yönetici anahtarı (ADMIN_TOKEN)</label>
      <input id="tok" type="password" class="note-input" autocomplete="current-password" required>
      ${msg ? `<p class="badge bad">${esc(msg)}</p>` : ''}
      <div class="row-end"><button class="primary">Giriş</button></div></form>
    <p class="muted">Anahtar yalnızca bu sekmede (sessionStorage) tutulur.</p></section>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    token = $('#tok').value.trim();
    try { await api('/api/admin/summary'); sessionStorage.setItem('lugat.admin', token); summary(); }
    catch { login('Anahtar geçersiz.'); }
  };
}

const TABLE_TR = { lemmas: 'Kelimeler (lemma)', entries: 'Sözlük maddeleri', relations: 'Eş/zıt anlam', translations: 'Karşılıklar' };
const STATUS = { pending: ['warn', 'onay bekliyor'], partial: ['warn', 'kısmen onaylı'], approved: ['ok', 'onaylı'], rejected: ['bad', 'reddedildi'] };

async function summary() {
  app.innerHTML = '<p class="muted">Yükleniyor…</p>';
  const s = await api('/api/admin/summary');
  app.innerHTML = `
    <section class="block"><h2>Onay süreci</h2>
      <ol>
        <li>ETL her kaynağı <b>onay bekliyor</b> olarak yükler ve kaynakları karşılaştırır (<code>python etl/run.py compare</code>).</li>
        <li><b>Çelişkiler</b> (kaynakların ayrıştığı satırlar) burada tek tek onaylanır veya reddedilir; toplu onaya asla girmez.</li>
        <li>Diğerleri için önce <b>rastgele örneklem</b> açılıp kontrol edilir; sonra not yazılarak toplu onay verilir.</li>
        <li><a href="/?preview=1" target="_blank">Önizleme</a> ile onay bekleyen veriyi sitede görebilirsiniz (yalnız siz).</li>
      </ol>
      <p>Açık hata bildirimi: <b>${s.open_reports}</b> · <a href="#" id="go-reports">bildirimleri gör</a> · <a href="#" id="go-audit">işlem kaydı</a> · <a href="#" id="go-links">dış link durumu</a></p>
    </section>
    <section class="block"><h2>Yükler</h2><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Kaynak</th><th>Tablo</th><th>Durum</th><th>Sayılar (bekleyen)</th><th>Yapısal kontrol / karşılaştırma</th><th></th></tr></thead>
      <tbody>${s.batches.map((b) => {
        const c = b.counts || {};
        const [cls, label] = STATUS[b.status] ?? ['src', b.status];
        const checks = JSON.parse(b.checks_json || '{}');
        return `<tr><td>${b.id}</td><td><b>${esc(b.source)}</b><br><small class="muted">${esc(b.source_version)}</small></td>
          <td>${esc(TABLE_TR[b.target_table] ?? b.target_table)}</td>
          <td><span class="badge ${cls}">${label}</span>${b.reviewed_at ? `<br><small class="muted">${esc(b.reviewed_by)} · ${esc(b.reviewed_at)}</small>` : ''}</td>
          <td><div class="counts"><span>toplam ${fmt.format(c.n ?? 0)}</span><span>onaylı ${fmt.format(c.approved ?? 0)}</span>
            <span>çok kaynaklı ${fmt.format(c.multi_pending ?? 0)}</span><span>tek kaynak ${fmt.format(c.single_pending ?? 0)}</span>
            <span style="color:var(--bad)">çelişki ${fmt.format(c.conflict_pending ?? 0)}</span><span>reddedilen ${fmt.format(c.rejected ?? 0)}</span></div></td>
          <td><small>${checks.yapisal_kontrol ? `<span class="badge ${checks.yapisal_kontrol === 'GEÇTİ' ? 'ok' : 'bad'}">${esc(checks.yapisal_kontrol)}</span> ` : ''}${esc(Object.entries(checks).filter(([k]) => k !== 'yapisal_kontrol').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`).join(' · '))}</small></td>
          <td><button class="small primary" data-batch="${b.id}" data-table="${b.target_table}">İncele</button></td></tr>`;
      }).join('')}</tbody></table></div></section>`;
  $('#go-reports').onclick = (e) => { e.preventDefault(); reports(); };
  $('#go-audit').onclick = (e) => { e.preventDefault(); audit(); };
  $('#go-links').onclick = (e) => { e.preventDefault(); links(); };
  app.querySelectorAll('[data-batch]').forEach((b) => (b.onclick = () => batch(Number(b.dataset.batch), b.dataset.table)));
}

const FILTERS = [['conflict', 'Çelişkiler'], ['multi', 'Çok kaynaklı uyumlu'], ['single', 'Tek kaynak'], ['approved', 'Onaylı'], ['rejected', 'Reddedilen']];

async function batch(id, table, filter = 'conflict', random = false, offset = 0) {
  app.innerHTML = '<p class="muted">Yükleniyor…</p>';
  const rows = await api(`/api/admin/items?table=${table}&batch=${id}&filter=${filter}&limit=50&offset=${offset}${random ? '&random=1' : ''}`);
  const cols = rows[0] ? Object.keys(rows[0]).filter((k) => !['id', 'agree_count', 'conflict', 'status'].includes(k)) : [];
  app.innerHTML = `
    <p><a href="#" id="back">← Yükler</a></p>
    <section class="block"><h2>Yük #${id} · ${esc(TABLE_TR[table] ?? table)}</h2>
      <div class="tabs">${FILTERS.map(([f, l]) => `<button class="small ${f === filter && !random ? 'primary' : ''}" data-f="${f}">${l}</button>`).join('')}
        <button class="small ${random ? 'primary' : ''}" data-random>Rastgele 50 örnek (bekleyen, çelişkisiz)</button></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>#</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th>Uyum</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr data-id="${r.id}"><td>${r.id}</td>${cols.map((c) => `<td><div class="${c === 'body' ? 'body-preview' : ''} ${/label|lemma|root|body|related|gloss/.test(c) ? 'ar' : ''}" dir="auto">${esc(r[c])}</div></td>`).join('')}
          <td>${r.agree_count}${r.conflict ? ' <span class="badge bad">çelişki</span>' : ''}</td>
          <td class="item-actions">${r.status === 'pending' ? `<button class="small" data-s="approved">Onayla</button><button class="small" data-s="rejected">Reddet</button>` : `<span class="badge ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span> <button class="small" data-s="pending">Geri al</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p>${offset ? '<button class="small" id="prev">← Önceki 50</button>' : ''} ${rows.length === 50 && !random ? '<button class="small" id="next">Sonraki 50 →</button>' : ''}</p>`
      : '<p class="block-empty">Bu filtrede satır yok.</p>'}
    </section>
    <section class="block"><h2>Toplu karar</h2>
      <p>Toplu onay <b>çelişkili satırları hiçbir zaman kapsamaz</b>. Önce “Rastgele 50 örnek” ile kontrol yapın, ne bulduğunuzu not edin.</p>
      <label for="note">Örneklem incelemesi notu (zorunlu)</label>
      <textarea id="note" rows="3" placeholder="Ör. 50 rastgele satırdan 49'u doğru; 1 hatalı kök (#1234) tek tek reddedildi."></textarea>
      <div class="row-end">
        <button data-bulk="reject">Bekleyenlerin tümünü reddet</button>
        <button data-bulk="approve" data-scope="multi">Yalnız çok kaynaklı uyumluları onayla</button>
        <button data-bulk="approve" data-scope="nonconflict" class="primary">Çelişkisiz bekleyenlerin tümünü onayla</button>
      </div>
    </section>`;
  $('#back').onclick = (e) => { e.preventDefault(); summary(); };
  app.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => batch(id, table, b.dataset.f)));
  $('[data-random]').onclick = () => batch(id, table, 'single', true);
  $('#next') && ($('#next').onclick = () => batch(id, table, filter, false, offset + 50));
  $('#prev') && ($('#prev').onclick = () => batch(id, table, filter, false, Math.max(0, offset - 50)));
  app.querySelectorAll('[data-s]').forEach((b) => (b.onclick = async () => {
    const tr = b.closest('tr');
    await api('/api/admin/item', { table, id: Number(tr.dataset.id), status: b.dataset.s });
    tr.classList.add('done');
    tr.querySelector('.item-actions').innerHTML = `<span class="badge ${STATUS[b.dataset.s]?.[0] ?? 'warn'}">${STATUS[b.dataset.s]?.[1] ?? 'onay bekliyor'}</span>`;
  }));
  app.querySelectorAll('[data-bulk]').forEach((b) => (b.onclick = async () => {
    const note = $('#note').value.trim();
    if (note.length < 10) { alert('Lütfen örneklem incelemesi notunu yazın (en az 10 karakter).'); return; }
    const what = b.dataset.bulk === 'reject' ? 'bekleyen bütün satırlar REDDEDİLECEK' : b.dataset.scope === 'multi' ? 'çok kaynaklı uyumlu satırlar onaylanacak' : 'çelişkisiz bekleyen bütün satırlar onaylanacak';
    if (!confirm(`Yük #${id}: ${what}. Emin misiniz?`)) return;
    const r = await api(`/api/admin/batch/${id}/${b.dataset.bulk}`, { scope: b.dataset.scope, note });
    alert(`${fmt.format(r.changed)} satır güncellendi. Yük durumu: ${STATUS[r.batch_status]?.[1] ?? r.batch_status}`);
    summary();
  }));
}

async function reports() {
  const rows = await api('/api/admin/reports');
  app.innerHTML = `<p><a href="#" id="back">← Yükler</a></p><section class="block"><h2>Hata bildirimleri</h2>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Tarih</th><th>Arama</th><th>Mesaj</th><th>Durum</th></tr></thead><tbody>
    ${rows.map((r) => `<tr data-id="${r.id}"><td>${r.id}</td><td>${esc(r.created_at)}</td><td><a class="ar" href="/w/${encodeURIComponent(r.query || '')}?preview=1" target="_blank">${esc(r.query)}</a></td>
      <td>${esc(r.message)}</td><td><select data-r>${['open', 'done', 'dismissed'].map((s) => `<option ${s === r.status ? 'selected' : ''} value="${s}">${{ open: 'açık', done: 'düzeltildi', dismissed: 'geçersiz' }[s]}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="block-empty">Bildirim yok.</p>'}</section>`;
  $('#back').onclick = (e) => { e.preventDefault(); summary(); };
  app.querySelectorAll('[data-r]').forEach((s) => (s.onchange = () => api(`/api/admin/report/${s.closest('tr').dataset.id}`, { status: s.value })));
}

async function audit() {
  const rows = await api('/api/admin/audit');
  app.innerHTML = `<p><a href="#" id="back">← Yükler</a></p><section class="block"><h2>İşlem kaydı</h2><div class="table-wrap"><table>
    <thead><tr><th>Tarih</th><th>Kim</th><th>İşlem</th><th>Hedef</th><th>Ayrıntı</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.created_at)}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td><td>${esc(r.target)}</td><td><small>${esc(r.detail)}</small></td></tr>`).join('')}
    </tbody></table></div></section>`;
  $('#back').onclick = (e) => { e.preventDefault(); summary(); };
}

async function links() {
  const rows = await api('/api/admin/links');
  app.innerHTML = `<p><a href="#" id="back">← Yükler</a></p><section class="block"><h2>Dış linkler</h2>
    <p class="muted">Her ayın 1'inde otomatik kontrol edilir (wrangler.jsonc → triggers.crons).</p><div class="table-wrap"><table>
    <thead><tr><th>Ad</th><th>Şablon</th><th>Son kontrol</th><th>HTTP</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td><small>${esc(r.url_template)}</small></td><td>${esc(r.last_checked ?? '—')}</td>
      <td>${r.last_status ? `<span class="badge ${r.last_status < 400 ? 'ok' : 'bad'}">${r.last_status}</span>` : '—'}</td></tr>`).join('')}
    </tbody></table></div></section>`;
  $('#back').onclick = (e) => { e.preventDefault(); summary(); };
}

token ? summary().catch(() => login()) : login();
