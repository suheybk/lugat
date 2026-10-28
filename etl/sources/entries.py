"""Sözlük madde metinleri → entries tablosu.

  m3ajim     huggingface.co/datasets/mysamai/m3ajim  (CC BY-NC 4.0) — Parquet, klasör verilir
  lisan_json huggingface.co/datasets/enver/lisan_al_alab — JSON
  lane       github.com/GibreelAbdullah/LaneLexicon — SQLite (WORD, DEFINITION, IS_ROOT, PARENT_ID)

Hepsi status='pending' girer. Aynı sözlüğün aynı kökü birden fazla kaynaktan gelirse
(ör. Lisân: m3ajim + enver JSON) compare.py metinleri karşılaştırır.
"""
from pathlib import Path

from db import RootCache, drop_previous, finish_batch, new_batch
from normalize import normalize

from .tabular import ColumnError, pick, read_rows, sqlite_tables

# m3ajim'deki sözlük adlarını bizim kodlarımıza eşleme (Arapça ad içinde geçen ifade → kod).
# Eşleşmeyen sözlükler "m3ajim_<ad>" koduyla, türü 'istilah' ve rehberde "türü elle
# belirlenmeli" notuyla eklenir; karşılaştırma raporunda listelenir.
M3AJIM_NAMES = [
    ("لسان العرب", "lisan"), ("القاموس المحيط", "qamus"), ("الصحاح", "sihah"),
    ("مقاييس", "maqayis"), ("جمهرة", "jamhara"), ("المصباح", "misbah"), ("العباب", "ubab"),
    ("الوسيط", "wasit"), ("الرائد", "raid"), ("المعاصرة", "muasira"), ("العين", "ayn"),
    ("تاج العروس", "taj"), ("المحكم", "muhkam"), ("تهذيب", "tahdhib"), ("أساس البلاغة", "asas"),
    ("مفردات", "mufradat"), ("التعريفات", "tarifat"),
]

DICT_COL = ["dictionary", "dictionary_name", "dict", "dict_name", "mu3jam", "mujam", "source", "book", "name"]
ROOT_COL = ["root", "jidr", "jithr", "aljidr", "word_root", "madda", "headword", "__key__"]
HEAD_COL = ["word", "headword", "entry", "lemma", "title", "root", "__key__"]
BODY_COL = ["text", "content", "definition", "body", "meaning", "explanation", "sharh", "__value__"]
PAGE_COL = ["page", "page_ref", "volume_page", "ref"]


def dict_id(con, code, name_ar=None):
    r = con.execute("SELECT id FROM dictionaries WHERE code=?", (code,)).fetchone()
    if r:
        return r[0]
    cur = con.execute(
        """INSERT INTO dictionaries (code, name_ar, name_tr, grp, type, scope, license, open_data, sort_order)
           VALUES (?,?,?,'istilah','istilah','Türü elle belirlenmeli','m3ajim: CC BY-NC 4.0','m3ajim', 900)""",
        (code, name_ar or code, name_ar or code))
    return cur.lastrowid


def _insert(con, rows):
    con.executemany(
        """INSERT INTO entries (dictionary_id, root_id, headword, headword_norm, body, body_norm,
             page_ref, source, source_ref, batch_id) VALUES (?,?,?,?,?,?,?,?,?,?)""", rows)


def m3ajim(con, folder, version="mysamai/m3ajim"):
    folder = Path(folder)
    files = sorted(folder.glob("*.parquet"))
    if not files:
        raise ColumnError(f"{folder} içinde .parquet yok")
    # Madde metni taşıyan dosya: 'roots' (kök → madde) — 'words' yalnızca Lisân kelime indeksi.
    main = next((f for f in files if "root" in f.stem.lower()), files[0])
    dict_names = {}
    dfile = next((f for f in files if "dict" in f.stem.lower()), None)
    if dfile:
        for r in read_rows(dfile):
            idc = pick(r.keys(), ["id", "dictionary_id", "dict_id"], "sözlük id", required=False)
            nc = pick(r.keys(), ["name", "name_ar", "title", "dictionary"], "sözlük adı")
            dict_names[str(r[idc]) if idc else r[nc]] = r[nc]

    drop_previous(con, "m3ajim", "entries")
    batch = new_batch(con, "m3ajim", version, "entries", {"dosya": main.name})
    roots = RootCache(con)
    cols = None
    unmapped, buf, total = set(), [], 0
    code_cache = {}
    for r in read_rows(main):
        if cols is None:
            cols = dict(dict=pick(r.keys(), DICT_COL + ["dictionary_id", "dict_id"], "sözlük"),
                        root=pick(r.keys(), ROOT_COL, "kök"),
                        head=pick(r.keys(), HEAD_COL, "madde başı", required=False),
                        body=pick(r.keys(), BODY_COL, "metin"),
                        page=pick(r.keys(), PAGE_COL, "sayfa", required=False))
        raw_name = dict_names.get(str(r[cols["dict"]]), str(r[cols["dict"]]))
        if raw_name not in code_cache:
            code = next((c for k, c in M3AJIM_NAMES if k in raw_name), None)
            if code is None:
                code = "m3ajim_" + normalize(raw_name).replace(" ", "_")[:40]
                unmapped.add(raw_name)
            code_cache[raw_name] = dict_id(con, code, raw_name)
        body = (r[cols["body"]] or "").strip()
        if not body:
            continue
        root = r[cols["root"]]
        head = r[cols["head"]] if cols["head"] else root
        buf.append((code_cache[raw_name], roots.get(root), head, normalize(head), body, normalize(body),
                    r[cols["page"]] if cols["page"] else None, "m3ajim", None, batch))
        if len(buf) >= 5000:
            _insert(con, buf); total += len(buf); buf = []
    _insert(con, buf)
    con.execute("UPDATE import_batches SET checks_json=json_set(checks_json, '$.eslesmeyen_sozlukler', json(?)) WHERE id=?",
                (__import__("json").dumps(sorted(unmapped), ensure_ascii=False), batch))
    n = finish_batch(con, batch, "entries")
    return {"batch": batch, "entries": n, "eslesmeyen_sozlukler": sorted(unmapped)}


def lisan_json(con, path, version="enver/lisan_al_alab"):
    drop_previous(con, "lisan_json", "entries")
    batch = new_batch(con, "lisan_json", version, "entries", {})
    roots = RootCache(con)
    did = dict_id(con, "lisan")
    cols, buf = None, []
    for r in read_rows(path):
        if cols is None:
            cols = (pick(r.keys(), ROOT_COL, "kök"), pick(r.keys(), BODY_COL, "metin"))
        root, body = r[cols[0]], r[cols[1]]
        if isinstance(body, list):
            body = "\n".join(map(str, body))
        if not root or not body:
            continue
        buf.append((did, roots.get(root), root, normalize(root), body, normalize(body), None,
                    "lisan_json", None, batch))
    _insert(con, buf)
    return {"batch": batch, "entries": finish_batch(con, batch, "entries")}


def lane(con, path, version="GibreelAbdullah/LaneLexicon"):
    tables = sqlite_tables(path)
    table = next((t for t, c in tables.items() if {"WORD", "DEFINITION"} <= {x.upper() for x in c}), None)
    if not table:
        raise ColumnError(f"WORD/DEFINITION sütunlu tablo yok: {tables}")
    rows = list(read_rows(path, table))
    k = {c.upper(): c for c in rows[0]}
    by_id = {r[k["ID"]]: r for r in rows}

    drop_previous(con, "lane", "entries")
    batch = new_batch(con, "lane", version, "entries", {"tablo": table, "satir": len(rows)})
    roots = RootCache(con)
    did = dict_id(con, "lane")
    buf = []
    for r in rows:
        is_root = str(r[k["IS_ROOT"]]) in ("1", "True", "true")
        root_word = r[k["WORD"]] if is_root else by_id.get(r[k["PARENT_ID"]], {}).get(k["WORD"])
        body = r[k["DEFINITION"]] or ""
        if not body.strip():
            continue
        buf.append((did, roots.get(root_word), r[k["WORD"]], normalize(r[k["WORD"]]), body,
                    normalize(body), None, "lane", str(r[k["ID"]]), batch))
    _insert(con, buf)
    return {"batch": batch, "entries": finish_batch(con, batch, "entries")}
