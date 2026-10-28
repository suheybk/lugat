import { Hono } from 'hono';
import type { Context } from 'hono';
import { admin, isAdmin } from './admin';
import { normalize } from './normalize';
import { buildResult, quranVerses, visible } from './search';
import { fillTemplate } from './search';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
  SITE_NAME?: string;
}

const app = new Hono<{ Bindings: Env }>();

const CACHE_SECONDS = 3600;

/** Herkese açık GET cevaplarını Cloudflare önbelleğinde tutar (yönetici önizlemesi hariç). */
async function cached(c: Context<{ Bindings: Env }>, build: () => Promise<unknown>) {
  const preview = c.req.query('preview') === '1' && isAdmin(c);
  if (preview) return c.json(await build(), 200, { 'Cache-Control': 'no-store' });
  const cache = (caches as unknown as { default: Cache }).default;
  // Önbellek anahtarı son onay zamanını içerir: her onay/ret, eski cevapları kendiliğinden geçersiz kılar.
  const v = await c.env.DB.prepare('SELECT ifnull(max(reviewed_at), 0) v FROM import_batches').first<{ v: string }>();
  const u = new URL(c.req.url);
  u.searchParams.delete('preview');
  u.searchParams.set('_v', String(v?.v ?? 0));
  const key = new Request(u.toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = c.json(await build(), 200, { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
  c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return res;
}

const previewOf = (c: Context<{ Bindings: Env }>) => c.req.query('preview') === '1' && isAdmin(c);

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 64);
  if (!q) return c.json({ error: 'Arama kutusu boş.' }, 400);
  const root = c.req.query('root');
  return cached(c, () => buildResult(c.env.DB, q, previewOf(c), { key: c.req.query('key'), root: root ? Number(root) : null }));
});

app.get('/api/suggest', async (c) => {
  const n = normalize(c.req.query('q') ?? '').replace(/\s+/g, '');
  if (n.length < 2) return c.json([]);
  return cached(c, async () => {
    const r = await c.env.DB.prepare(
      `SELECT lemma_voc, lemma_norm, max(quran_count) q FROM lemmas
       WHERE ${visible(previewOf(c))} AND lemma_norm >= ?1 AND lemma_norm < ?1 || '￿'
       GROUP BY lemma_key ORDER BY q DESC, length(lemma_norm) LIMIT 10`,
    ).bind(n).all();
    return r.results;
  });
});

app.get('/api/entry/:id', async (c) => {
  const e = await c.env.DB.prepare(
    `SELECT e.id, e.headword, e.body, e.page_ref, e.source, d.name_tr, d.name_ar FROM entries e
     JOIN dictionaries d ON d.id = e.dictionary_id WHERE e.id = ? AND e.${visible(previewOf(c))}`,
  ).bind(Number(c.req.param('id'))).first();
  return e ? c.json(e) : c.json({ error: 'Bulunamadı' }, 404);
});

app.get('/api/quran', async (c) => {
  const root = Number(c.req.query('root'));
  if (!root) return c.json({ error: 'root gerekli' }, 400);
  const mode = c.req.query('mode') === 'lemma' ? 'lemma' : 'root';
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0));
  return cached(c, () => quranVerses(c.env.DB, visible(previewOf(c)), c.req.query('key') ?? null, root, offset, mode));
});

app.get('/api/dictionaries', (c) =>
  cached(c, async () => {
    const r = await c.env.DB.prepare(
      `SELECT d.*, (SELECT count(*) FROM entries e WHERE e.dictionary_id = d.id AND e.status = 'approved') AS approved_entries
       FROM dictionaries d ORDER BY d.sort_order`,
    ).all<Record<string, unknown>>();
    return r.results.map((d) => ({ ...d, link: d.link_url ? fillTemplate(d.link_url as string, 'كتب', 'كتب') : null }));
  }),
);

app.get('/api/stats', (c) =>
  cached(c, async () => {
    const one = (sql: string) => c.env.DB.prepare(sql).first<{ n: number }>().then((r) => r?.n ?? 0);
    const [lemmas, entries, relations, translations, quran, roots] = await Promise.all([
      one("SELECT count(DISTINCT lemma_key) n FROM lemmas WHERE status='approved'"),
      one("SELECT count(*) n FROM entries WHERE status='approved'"),
      one("SELECT count(*) n FROM relations WHERE status='approved'"),
      one("SELECT count(*) n FROM translations WHERE status='approved'"),
      one("SELECT count(*) n FROM quran_occurrences WHERE status='approved'"),
      one("SELECT count(DISTINCT root_id) n FROM lemmas WHERE status='approved'"),
    ]);
    return { lemmas, entries, relations, translations, quran, roots };
  }),
);

app.post('/api/report', async (c) => {
  const b = await c.req.json<{ target_table?: string; target_id?: number; query?: string; message?: string }>().catch(() => null);
  const msg = (b?.message ?? '').trim();
  if (!b || msg.length < 5 || msg.length > 2000) return c.json({ error: 'Mesaj 5–2000 karakter olmalı.' }, 400);
  const tables = ['lemmas', 'entries', 'relations', 'translations', 'quran_occurrences'];
  await c.env.DB.prepare('INSERT INTO reports (target_table, target_id, query, message) VALUES (?,?,?,?)')
    .bind(tables.includes(b.target_table ?? '') ? b.target_table : null, b.target_id ?? null, (b.query ?? '').slice(0, 100), msg)
    .run();
  return c.json({ ok: true });
});

app.route('/api/admin', admin);

app.all('/api/*', (c) => c.json({ error: 'Bulunamadı' }, 404));

// /k/كتب, /w/كتاب gibi paylaşılabilir adresler tek sayfa uygulamaya düşer.
app.get('*', (c) => c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), c.req.raw)));

export default {
  fetch: app.fetch,
  // Ayda bir dış link kontrolü (wrangler.jsonc → triggers.crons)
  async scheduled(_e: ScheduledController, env: Env) {
    const links = await env.DB.prepare('SELECT id, url_template FROM external_links WHERE active = 1').all<{ id: number; url_template: string }>();
    for (const l of links.results) {
      let status = 0;
      try {
        status = (await fetch(fillTemplate(l.url_template, 'كتاب', 'كتب'), { method: 'GET', redirect: 'follow' })).status;
      } catch { status = 0; }
      await env.DB.prepare("UPDATE external_links SET last_checked = datetime('now'), last_status = ? WHERE id = ?").bind(status, l.id).run();
    }
  },
} satisfies ExportedHandler<Env>;
