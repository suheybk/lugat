"""Kaynaklar arası karşılaştırma. Hiçbir satırı onaylamaz; yalnızca her satıra
agree_count / conflict / compare_note yazar ve bir rapor üretir. Onay, yönetim
panelinde (/yonetim) bir insan tarafından verilir.

Kurallar
  lemmas        aynı (lemma_key, kök) kaç kaynakta var → agree_count.
                Aynı lemma_key başka kaynakta yalnızca FARKLI kökle geçiyorsa → conflict.
  entries       aynı sözlük + aynı kök birden çok kaynaktan geldiyse metin benzerliği:
                ≥ %85 uyum, < %50 çelişki (ör. m3ajim Lisân ↔ enver Lisân JSON).
                Kökü hiçbir lemma kaynağında olmayan madde → not düşülür (çelişki değil).
  relations     aynı (kelime, ilgili kelime, tür) kaç kaynakta var. Aynı ikili hem eş hem
                zıt anlamlı işaretlenmişse → conflict.
  translations  aynı (kelime, dil, karşılık) kaç kaynakta var.
"""
import json
from collections import defaultdict
from difflib import SequenceMatcher

from db import OUT_DIR


def _sources(con, table, key_sql, src_col="source"):
    m = defaultdict(set)
    for r in con.execute(f"SELECT {key_sql} AS k, {src_col} AS s FROM {table} WHERE status != 'rejected'"):
        m[r["k"]].add(r["s"])
    return m


def compare_lemmas(con):
    by_pair = _sources(con, "lemmas", "lemma_key || '|' || ifnull(root_id,'')")
    roots_by_key = defaultdict(lambda: defaultdict(set))
    for r in con.execute("SELECT lemma_key, root_id, source FROM lemmas WHERE status != 'rejected'"):
        roots_by_key[r["lemma_key"]][r["root_id"]].add(r["source"])
    root_names = {r["id"]: r["root"] for r in con.execute("SELECT id, root FROM roots")}
    updates = []
    for r in con.execute("SELECT id, lemma_key, root_id, source FROM lemmas"):
        srcs = by_pair[f"{r['lemma_key']}|{r['root_id'] or ''}"]
        others = {rid: s - {r["source"]} for rid, s in roots_by_key[r["lemma_key"]].items()}
        other_roots = {rid for rid, s in others.items() if s and rid != r["root_id"] and rid is not None}
        conflict = int(len(srcs) == 1 and bool(other_roots) and r["root_id"] is not None)
        note = None
        if r["root_id"] is None and other_roots:
            note = "Bu kaynakta kök yok (harf/câmid); diğer kaynak kök veriyor: " + ", ".join(
                root_names.get(x, "?") for x in other_roots)
        elif conflict:
            note = "Diğer kaynak(lar) farklı kök veriyor: " + ", ".join(
                f"{root_names.get(x, '?')} ({'/'.join(sorted(others[x]))})" for x in other_roots)
        elif len(srcs) > 1:
            note = "Uyumlu: " + ", ".join(sorted(srcs))
        updates.append((len(srcs), conflict, note, r["id"]))
    con.executemany("UPDATE lemmas SET agree_count=?, conflict=?, compare_note=? WHERE id=?", updates)
    return _summary(con, "lemmas")


def compare_entries(con):
    groups = defaultdict(list)
    for r in con.execute("""SELECT id, dictionary_id, root_id, source, substr(body_norm,1,3000) b
                            FROM entries WHERE status != 'rejected' AND root_id IS NOT NULL"""):
        groups[(r["dictionary_id"], r["root_id"])].append(r)
    lemma_roots = {r[0] for r in con.execute("SELECT DISTINCT root_id FROM lemmas WHERE root_id IS NOT NULL")}
    updates = []
    for (did, rid), rows in groups.items():
        by_src = defaultdict(list)
        for x in rows:
            by_src[x["source"]].append(x)
        for x in rows:
            best, other_src = None, None
            for s, ys in by_src.items():
                if s == x["source"]:
                    continue
                for y in ys:
                    sm = SequenceMatcher(None, x["b"], y["b"], autojunk=False)
                    ratio = sm.quick_ratio() if len(x["b"]) + len(y["b"]) > 4000 else sm.ratio()
                    if best is None or ratio > best:
                        best, other_src = ratio, s
            if best is None:
                note = None if rid in lemma_roots else "Kök, lemma kaynaklarında (Kur'an, Arramooz) bulunamadı"
                updates.append((1, 0, note, x["id"]))
            elif best >= 0.85:
                updates.append((2, 0, f"{other_src} ile metin uyumu %{best*100:.0f}", x["id"]))
            elif best < 0.5:
                updates.append((1, 1, f"{other_src} ile metin uyumu yalnızca %{best*100:.0f} — elle bakılmalı", x["id"]))
            else:
                updates.append((1, 0, f"{other_src} ile kısmi uyum %{best*100:.0f}", x["id"]))
    con.executemany("UPDATE entries SET agree_count=?, conflict=?, compare_note=? WHERE id=?", updates)
    return _summary(con, "entries")


def compare_relations(con):
    by = _sources(con, "relations", "lemma_key || '|' || related_key || '|' || kind")
    kinds = defaultdict(set)
    for r in con.execute("SELECT lemma_key, related_key, kind FROM relations WHERE status != 'rejected'"):
        kinds[(r["lemma_key"], r["related_key"])].add(r["kind"])
        kinds[(r["related_key"], r["lemma_key"])].add(r["kind"])
    updates = []
    for r in con.execute("SELECT id, lemma_key, related_key, kind FROM relations"):
        srcs = by[f"{r['lemma_key']}|{r['related_key']}|{r['kind']}"]
        ks = kinds[(r["lemma_key"], r["related_key"])]
        conflict = int({"synonym", "antonym"} <= ks)
        note = "Aynı ikili hem eş hem zıt anlamlı işaretlenmiş" if conflict else (
            "Uyumlu: " + ", ".join(sorted(srcs)) if len(srcs) > 1 else None)
        updates.append((len(srcs), conflict, note, r["id"]))
    con.executemany("UPDATE relations SET agree_count=?, conflict=?, compare_note=? WHERE id=?", updates)
    return _summary(con, "relations")


def compare_translations(con):
    by = _sources(con, "translations", "lemma_key || '|' || lang || '|' || lower(gloss)")
    updates = []
    for r in con.execute("SELECT id, lemma_key, lang, gloss FROM translations"):
        srcs = by[f"{r['lemma_key']}|{r['lang']}|{r['gloss'].lower()}"]
        updates.append((len(srcs), "Uyumlu: " + ", ".join(sorted(srcs)) if len(srcs) > 1 else None, r["id"]))
    con.executemany("UPDATE translations SET agree_count=?, compare_note=? WHERE id=?", updates)
    return _summary(con, "translations")


def compare_quran(con):
    """Kur'an korpusu tek kaynak; ek kontrol: lemmaların kökü Arramooz'da da var mı."""
    row = con.execute("""
        SELECT count(DISTINCT l.root_id) AS toplam,
               count(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM lemmas a WHERE a.source='arramooz'
                    AND a.root_id = l.root_id) THEN l.root_id END) AS arramoozda
        FROM lemmas l WHERE l.source='quran_corpus' AND l.root_id IS NOT NULL""").fetchone()
    return {"kur'an_kok": row["toplam"], "arramooz'da_da_olan": row["arramoozda"]}


def _summary(con, table):
    out = {}
    for r in con.execute(f"""SELECT batch_id, count(*) n,
              sum(agree_count >= 2) coklu, sum(agree_count = 1 AND conflict = 0) tekil,
              sum(conflict) celiski, sum(status='approved') onayli
            FROM {table} GROUP BY batch_id"""):
        out[r["batch_id"]] = {k: r[k] for k in ("n", "coklu", "tekil", "celiski", "onayli")}
    return out


def run(con):
    results = {
        "lemmas": compare_lemmas(con),
        "entries": compare_entries(con),
        "relations": compare_relations(con),
        "translations": compare_translations(con),
    }
    quran = compare_quran(con)
    for table, per_batch in results.items():
        for bid, s in per_batch.items():
            extra = quran if con.execute("SELECT source FROM import_batches WHERE id=?", (bid,)).fetchone()[0] == "quran_corpus" else {}
            con.execute("UPDATE import_batches SET compare_json=? WHERE id=?",
                        (json.dumps({**s, **extra}, ensure_ascii=False), bid))
    con.commit()
    write_report(con)
    return results


def write_report(con):
    lines = ["# Karşılaştırma raporu", "",
             "Bu rapor hiçbir şeyi onaylamaz. Onay yönetim panelinden verilir.", "",
             "| Yük | Kaynak | Tablo | Satır | Çok kaynaklı uyum | Tek kaynak | Çelişki | Onaylı | Yapısal kontrol |",
             "|---|---|---|---|---|---|---|---|---|"]
    for b in con.execute("SELECT * FROM import_batches ORDER BY id"):
        c = json.loads(b["compare_json"] or "{}")
        ch = json.loads(b["checks_json"] or "{}")
        lines.append(f"| {b['id']} | {b['source']} | {b['target_table']} | {b['row_count']} | {c.get('coklu', '-')} | "
                     f"{c.get('tekil', '-')} | {c.get('celiski', '-')} | {c.get('onayli', '-')} | {ch.get('yapisal_kontrol', '')} |")
    lines += ["", "## Çelişki örnekleri (her tablodan en fazla 25)", ""]
    for table, label in (("lemmas", "lemma_voc"), ("entries", "headword"), ("relations", "related_text"), ("translations", "gloss")):
        rows = con.execute(f"SELECT id, {label} AS t, compare_note FROM {table} WHERE conflict=1 LIMIT 25").fetchall()
        if rows:
            lines.append(f"### {table}")
            lines += [f"- #{r['id']} {r['t']} — {r['compare_note']}" for r in rows]
            lines.append("")
    (OUT_DIR / "karsilastirma_raporu.md").write_text("\n".join(lines), encoding="utf-8")
