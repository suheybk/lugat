// Yönetim API'si: karşılaştırılmış verinin insan onayıyla yayına alınması.
// Kimlik: `wrangler secret put ADMIN_TOKEN` ile verilen anahtar (Authorization: Bearer ...).
// İsteğe bağlı ikinci katman: /yonetim ve /api/admin/* yollarını Cloudflare Access ile korumak;
// o durumda onaylayanın e-postası audit_log'a yazılır.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from './index';

type C = Context<{ Bindings: Env }>;

const TABLES = {
  lemmas: { label: 'lemma_voc', extra: 'lemma_key, pos, source, quran_count, (SELECT root FROM roots r WHERE r.id = root_id) AS root' },
  entries: { label: 'headword', extra: "substr(body,1,400) AS body, source, (SELECT name_tr FROM dictionaries d WHERE d.id = dictionary_id) AS dictionary, (SELECT root FROM roots r WHERE r.id = root_id) AS root" },
  relations: { label: 'related_text', extra: 'lemma_key, kind, source, confidence' },
  translations: { label: 'gloss', extra: 'lemma_key, lang, source' },
} as const;
type Table = keyof typeof TABLES;

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function isAdmin(c: C): boolean {
  const token = c.env.ADMIN_TOKEN;
  if (!token || token.length < 16) return false;
  const h = c.req.header('Authorization') ?? '';
  return h.startsWith('Bearer ') && timingSafeEqual(h.slice(7), token);
}

const actor = (c: C) => c.req.header('Cf-Access-Authenticated-User-Email') ?? 'yonetici';

async function audit(c: C, action: string, target: string, detail: unknown) {
  await c.env.DB.prepare('INSERT INTO audit_log (actor, action, target, detail) VALUES (?,?,?,?)')
    .bind(actor(c), action, target, JSON.stringify(detail)).run();
}

/** Kur'an yükünde geçişlerin durumu bağlı oldukları lemmayı izler. */
async function syncQuran(c: C, batchId: number) {
  await c.env.DB.prepare(
    `UPDATE quran_occurrences SET status = (SELECT l.status FROM lemmas l WHERE l.id = quran_occurrences.lemma_id)
     WHERE batch_id = ?`,
  ).bind(batchId).run();
}

async function refreshBatch(c: C, id: number, table: Table, note?: string) {
  const s = await c.env.DB.prepare(
    `SELECT sum(status='pending') p, sum(status='approved') a, count(*) n FROM ${table} WHERE batch_id = ?`,
  ).bind(id).first<{ p: number; a: number; n: number }>();
  const status = !s || s.n === 0 ? 'pending' : s.p === 0 ? (s.a > 0 ? 'approved' : 'rejected') : s.a > 0 ? 'partial' : 'pending';
  await c.env.DB.prepare(
    "UPDATE import_batches SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = coalesce(?, review_note) WHERE id = ?",
  ).bind(status, actor(c), note ?? null, id).run();
  return status;
}

export const admin = new Hono<{ Bindings: Env }>();

admin.use('*', async (c, next) => {
  if (!isAdmin(c)) return c.json({ error: 'Yetkisiz. ADMIN_TOKEN gerekli.' }, 401);
  await next();
});

admin.get('/summary', async (c) => {
  const batches = await c.env.DB.prepare('SELECT * FROM import_batches ORDER BY id').all<Record<string, unknown>>();
  const out = [];
  for (const b of batches.results) {
    const t = b.target_table as Table;
    const s = await c.env.DB.prepare(
      `SELECT count(*) n, sum(status='pending') pending, sum(status='approved') approved, sum(status='rejected') rejected,
              sum(conflict=1 AND status='pending') conflict_pending, sum(agree_count>=2 AND conflict=0 AND status='pending') multi_pending,
              sum(agree_count=1 AND conflict=0 AND status='pending') single_pending
       FROM ${t} WHERE batch_id = ?`,
    ).bind(b.id).first();
    out.push({ ...b, counts: s });
  }
  const reports = await c.env.DB.prepare("SELECT count(*) n FROM reports WHERE status='open'").first<{ n: number }>();
  return c.json({ batches: out, open_reports: reports?.n ?? 0 });
});

admin.get('/items', async (c) => {
  const table = c.req.query('table') as Table;
  if (!(table in TABLES)) return c.json({ error: 'Geçersiz tablo' }, 400);
  const batch = Number(c.req.query('batch'));
  const filter = c.req.query('filter') ?? 'conflict';
  const where = {
    conflict: "conflict = 1 AND status = 'pending'",
    multi: "agree_count >= 2 AND conflict = 0 AND status = 'pending'",
    single: "agree_count = 1 AND conflict = 0 AND status = 'pending'",
    approved: "status = 'approved'",
    rejected: "status = 'rejected'",
  }[filter] ?? "status = 'pending'";
  // Örneklem: 'random=1' ile rastgele satırlar (toplu onaydan önce elle kontrol için)
  const order = c.req.query('random') === '1' ? 'random()' : 'id';
  const limit = Math.min(200, Number(c.req.query('limit') ?? 50));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0));
  const t = TABLES[table];
  const r = await c.env.DB.prepare(
    `SELECT id, ${t.label} AS label, ${t.extra}, agree_count, conflict, compare_note, status
     FROM ${table} WHERE batch_id = ? AND ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
  ).bind(batch).all();
  return c.json(r.results);
});

admin.post('/batch/:id/:action', async (c) => {
  const id = Number(c.req.param('id'));
  const action = c.req.param('action');
  const body = await c.req.json<{ scope?: string; note?: string }>().catch(() => ({} as { scope?: string; note?: string }));
  const note = (body.note ?? '').trim();
  if (note.length < 10) return c.json({ error: 'Örneklem incelemesi notu zorunlu (en az 10 karakter): kaç satıra bakıldı, ne bulundu?' }, 400);
  const b = await c.env.DB.prepare('SELECT * FROM import_batches WHERE id = ?').bind(id).first<{ target_table: Table; source: string }>();
  if (!b) return c.json({ error: 'Yük bulunamadı' }, 404);
  const table = b.target_table;

  let sql: string;
  if (action === 'approve') {
    // Çelişkili satırlar toplu onaya asla girmez; tek tek incelenir.
    const scope = body.scope === 'multi' ? 'agree_count >= 2 AND conflict = 0' : 'conflict = 0';
    sql = `UPDATE ${table} SET status = 'approved' WHERE batch_id = ? AND status = 'pending' AND ${scope}`;
  } else if (action === 'reject') {
    sql = `UPDATE ${table} SET status = 'rejected' WHERE batch_id = ? AND status = 'pending'`;
  } else return c.json({ error: 'Geçersiz işlem' }, 400);

  const res = await c.env.DB.prepare(sql).bind(id).run();
  if (b.source === 'quran_corpus') await syncQuran(c, id);
  const status = await refreshBatch(c, id, table, note);
  await audit(c, `batch_${action}`, `import_batches:${id}`, { scope: body.scope, note, changed: res.meta.changes });
  return c.json({ ok: true, changed: res.meta.changes, batch_status: status });
});

admin.post('/item', async (c) => {
  const b = await c.req.json<{ table: Table; id: number; status: string; note?: string }>();
  if (!(b.table in TABLES) || !['approved', 'rejected', 'pending'].includes(b.status)) return c.json({ error: 'Geçersiz istek' }, 400);
  const row = await c.env.DB.prepare(`SELECT batch_id FROM ${b.table} WHERE id = ?`).bind(b.id).first<{ batch_id: number }>();
  if (!row) return c.json({ error: 'Satır yok' }, 404);
  await c.env.DB.prepare(`UPDATE ${b.table} SET status = ? WHERE id = ?`).bind(b.status, b.id).run();
  if (b.table === 'lemmas') {
    await c.env.DB.prepare('UPDATE quran_occurrences SET status = ? WHERE lemma_id = ?').bind(b.status, b.id).run();
  }
  const batchStatus = await refreshBatch(c, row.batch_id, b.table);
  await c.env.DB.prepare("UPDATE import_batches SET reviewed_at = datetime('now') WHERE id = ?").bind(row.batch_id).run();
  await audit(c, `item_${b.status}`, `${b.table}:${b.id}`, { note: b.note });
  return c.json({ ok: true, batch_status: batchStatus });
});

admin.get('/reports', async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM reports ORDER BY status = 'open' DESC, id DESC LIMIT 200").all();
  return c.json(r.results);
});

admin.post('/report/:id', async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  if (!['open', 'done', 'dismissed'].includes(status)) return c.json({ error: 'Geçersiz durum' }, 400);
  await c.env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind(status, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

admin.get('/audit', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
  return c.json(r.results);
});

admin.get('/links', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM external_links ORDER BY sort_order').all();
  return c.json(r.results);
});
