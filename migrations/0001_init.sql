-- Lügat Portalı — D1 şeması
-- Kural: hiçbir içerik satırı otomatik yayınlanmaz. ETL her satırı status='pending'
-- olarak yazar; kaynaklar arası karşılaştırma sonucu agree_count/conflict alanlarına
-- işlenir; yayın yalnızca yönetim panelinden onaylanan (status='approved') satırları gösterir.

CREATE TABLE IF NOT EXISTS import_batches (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL,             -- quran_corpus, arramooz, m3ajim, lisan_json, lane, wordnet, kaikki, sinalab, arabiclt
  source_version TEXT,
  target_table  TEXT NOT NULL,             -- lemmas / entries / relations / translations / quran_occurrences
  row_count     INTEGER NOT NULL DEFAULT 0,
  checks_json   TEXT,                      -- yapısal kontroller (satır sayısı, beklenen değerler)
  compare_json  TEXT,                      -- kaynaklar arası karşılaştırma özeti
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','partial','rejected')),
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  review_note   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dictionaries (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name_ar     TEXT NOT NULL,
  name_tr     TEXT NOT NULL,
  author      TEXT,
  death       TEXT,                        -- "ö. 711/1311" ya da yayın yılı
  century     INTEGER,                     -- hicrî yüzyıl (sıralama için)
  grp         TEXT NOT NULL,               -- klasik / modern / istilah / turkce / ingilizce
  type        TEXT NOT NULL,               -- lugha / mujam / qamus / gharib / istilah / bilingual
  ordering    TEXT,                        -- tertip
  scope       TEXT,
  license     TEXT,
  open_data   TEXT,
  link_url    TEXT,
  in_portal   INTEGER NOT NULL DEFAULT 0,  -- 1: metni portalda; 0: yalnız dış link
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roots (
  id            INTEGER PRIMARY KEY,
  root          TEXT NOT NULL,             -- kaynaktaki yazım (harekesiz)
  root_norm     TEXT NOT NULL UNIQUE,      -- hemze biçimleri tek ء
  letters_count INTEGER
);

-- Her kaynak kendi satırını yazar (bir kaynağın onayı diğerinin verisini yayına sokmasın diye).
-- Aynı kelime lemma_key (karşılaştırma anahtarı) + root_id ile gruplanır.
CREATE TABLE IF NOT EXISTS lemmas (
  id          INTEGER PRIMARY KEY,
  root_id     INTEGER REFERENCES roots(id),
  lemma_voc   TEXT NOT NULL,               -- harekeli
  lemma_norm  TEXT NOT NULL,
  lemma_key   TEXT NOT NULL,               -- karşılaştırma anahtarı (ٰ → ا, صلوٰة → صلاة, ال atılır)
  pos         TEXT,                        -- isim / fiil / harf / özel isim / sıfat
  pattern     TEXT,                        -- vezin
  gender      TEXT,
  plural      TEXT,
  verb_form   TEXT,                        -- fiil babı (I–X) / muzari harekesi
  category    TEXT,                        -- mastar / ism-i fâil / ism-i mef'ûl / sıfat-ı müşebbehe ...
  source      TEXT NOT NULL,               -- quran_corpus / arramooz / wordnet ...
  agree_count INTEGER NOT NULL DEFAULT 1,  -- kaç kaynak aynı (lemma_key, kök) ikilisini veriyor
  conflict    INTEGER NOT NULL DEFAULT 0,  -- başka kaynak aynı kelimeye farklı kök veriyorsa 1
  compare_note TEXT,
  quran_count INTEGER NOT NULL DEFAULT 0,
  batch_id    INTEGER REFERENCES import_batches(id),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  UNIQUE (lemma_voc, root_id, pos, source)
);
CREATE INDEX IF NOT EXISTS idx_lemmas_norm ON lemmas(lemma_norm, status);
CREATE INDEX IF NOT EXISTS idx_lemmas_key ON lemmas(lemma_key, status);
CREATE INDEX IF NOT EXISTS idx_lemmas_root ON lemmas(root_id, status);
CREATE INDEX IF NOT EXISTS idx_lemmas_batch ON lemmas(batch_id, status, conflict);

CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY,
  dictionary_id INTEGER NOT NULL REFERENCES dictionaries(id),
  root_id       INTEGER REFERENCES roots(id),
  headword      TEXT NOT NULL,
  headword_norm TEXT NOT NULL,
  body          TEXT NOT NULL,
  body_norm     TEXT NOT NULL,
  page_ref      TEXT,                      -- cilt/sayfa
  source        TEXT NOT NULL,             -- m3ajim / lisan_json / lane ...
  source_ref    TEXT,
  agree_count   INTEGER NOT NULL DEFAULT 1,
  conflict      INTEGER NOT NULL DEFAULT 0,
  compare_note  TEXT,
  batch_id      INTEGER REFERENCES import_batches(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_entries_root ON entries(root_id, status);
CREATE INDEX IF NOT EXISTS idx_entries_head ON entries(headword_norm, status);
CREATE INDEX IF NOT EXISTS idx_entries_batch ON entries(batch_id, status, conflict);
CREATE INDEX IF NOT EXISTS idx_entries_dict ON entries(dictionary_id, status);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  headword_norm, body_norm, content='entries', content_rowid='id'
);

CREATE TABLE IF NOT EXISTS relations (
  id              INTEGER PRIMARY KEY,
  lemma_key       TEXT NOT NULL,
  related_text    TEXT NOT NULL,           -- harekeli ilgili kelime
  related_key     TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('synonym','antonym','hypernym','hyponym','similar')),
  source          TEXT NOT NULL,
  confidence      REAL,
  agree_count     INTEGER NOT NULL DEFAULT 1,
  conflict        INTEGER NOT NULL DEFAULT 0,
  compare_note    TEXT,
  batch_id        INTEGER REFERENCES import_batches(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_rel_lemma ON relations(lemma_key, status);
CREATE INDEX IF NOT EXISTS idx_rel_batch ON relations(batch_id, status, conflict);

CREATE TABLE IF NOT EXISTS translations (
  id          INTEGER PRIMARY KEY,
  lemma_key   TEXT NOT NULL,
  lang        TEXT NOT NULL CHECK (lang IN ('tr','en','ota')),
  gloss       TEXT NOT NULL,
  source      TEXT NOT NULL,               -- wiktionary / omw / elle
  agree_count INTEGER NOT NULL DEFAULT 1,
  conflict    INTEGER NOT NULL DEFAULT 0,
  compare_note TEXT,
  batch_id    INTEGER REFERENCES import_batches(id),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_tr_lemma ON translations(lemma_key, status);
CREATE INDEX IF NOT EXISTS idx_tr_batch ON translations(batch_id, status, conflict);

CREATE TABLE IF NOT EXISTS quran_verses (
  sura  INTEGER NOT NULL,
  aya   INTEGER NOT NULL,
  text  TEXT NOT NULL,
  PRIMARY KEY (sura, aya)
);

CREATE TABLE IF NOT EXISTS quran_occurrences (
  id          INTEGER PRIMARY KEY,
  lemma_id    INTEGER REFERENCES lemmas(id),
  lemma_key   TEXT,
  root_id     INTEGER REFERENCES roots(id),
  sura        INTEGER NOT NULL,
  aya         INTEGER NOT NULL,
  word_index  INTEGER NOT NULL,
  form        TEXT NOT NULL,               -- kelimenin tamamı (önek/sonekleriyle)
  form_norm   TEXT NOT NULL,
  stem_norm   TEXT NOT NULL,               -- kök segmenti, normalize
  pos         TEXT,
  features    TEXT,
  batch_id    INTEGER REFERENCES import_batches(id),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_qo_lemma ON quran_occurrences(lemma_key, status);
CREATE INDEX IF NOT EXISTS idx_qo_root ON quran_occurrences(root_id, status);
CREATE INDEX IF NOT EXISTS idx_qo_form ON quran_occurrences(form_norm);
CREATE INDEX IF NOT EXISTS idx_qo_stem ON quran_occurrences(stem_norm);
CREATE INDEX IF NOT EXISTS idx_qo_batch ON quran_occurrences(batch_id, status);

CREATE TABLE IF NOT EXISTS external_links (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  url_template TEXT NOT NULL,              -- {w} {r} {r_bw} {w_latin}
  scope        TEXT NOT NULL CHECK (scope IN ('word','root')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  last_checked TEXT,
  last_status  INTEGER
);

-- Kullanıcıların "hata bildir" kayıtları. İçeriği asla doğrudan değiştirmez.
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  target_table TEXT,
  target_id   INTEGER,
  query       TEXT,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Yönetim işlemlerinin izi (kim neyi ne zaman onayladı).
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
