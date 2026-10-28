"""Anlam ilişkileri ve çeviriler.

  wordnet   Arabic WordNet 4.1 (WN-LMF XML, .xml veya .xml.gz) — CC BY 4.0 — zenodo.org/records/18872066
            → relations (synonym/antonym/hypernym/hyponym/similar) + İngilizce karşılık yok (ILI saklanır)
  omw_tr    Türkçe WordNet (WN-LMF, ILI'li; ör. KeNet / OMW) → translations(lang=tr, source=omw)
            Arapça synset ile Türkçe synset aynı ILI'yi paylaşıyorsa Türkçe lemmalar karşılık olur.
  kaikki    kaikki.org Wiktionary JSONL — CC BY-SA → translations (tr, en)
  sinalab   SinaLab Synonyms CSV — CC BY 4.0 → relations(source=sinalab), WordNet'i doğrulamak için
  arabiclt  mdanok/arabicLT CSV (eş/zıt anlam) — MIT, menşe riski notlu → relations(source=arabiclt)

Hiçbiri yayına doğrudan girmez; compare.py aynı ilişkiyi veren kaynakları sayar.
"""
import gzip
import json
import xml.etree.ElementTree as ET
from collections import defaultdict

from db import drop_previous, finish_batch, new_batch
from normalize import lemma_key

from .tabular import pick, read_rows

REL_KIND = {"antonym": "antonym", "hypernym": "hypernym", "hyponym": "hyponym",
            "similar": "similar", "instance_hypernym": "hypernym", "instance_hyponym": "hyponym"}


def _open(path):
    return gzip.open(path, "rb") if str(path).endswith(".gz") else open(path, "rb")


def read_lmf(path):
    """WN-LMF → (synset_id → [lemma], synset_id → ili, ilişki listesi)."""
    members, ili, rels, sense_syn, sense_lemma = defaultdict(list), {}, [], {}, {}
    current = None
    for ev, el in ET.iterparse(_open(path), events=("start", "end")):
        tag = el.tag.split("}")[-1]
        if ev == "start" and tag == "LexicalEntry":
            current = None
        elif ev == "end" and tag == "Lemma":
            current = el.get("writtenForm")
        elif ev == "end" and tag == "Sense":
            syn = el.get("synset")
            members[syn].append(current)
            sense_syn[el.get("id")] = syn
            sense_lemma[el.get("id")] = current
            for sr in el.findall("{*}SenseRelation") + el.findall("SenseRelation"):
                rels.append(("sense", el.get("id"), sr.get("target"), sr.get("relType")))
        elif ev == "end" and tag == "Synset":
            if el.get("ili"):
                ili[el.get("id")] = el.get("ili")
            for sr in el.findall("{*}SynsetRelation") + el.findall("SynsetRelation"):
                rels.append(("synset", el.get("id"), sr.get("target"), sr.get("relType")))
            el.clear()
        elif ev == "end" and tag == "LexicalEntry":
            el.clear()
    return members, ili, rels, sense_lemma


def _rel_insert(con, rows):
    con.executemany(
        """INSERT INTO relations (lemma_key, related_text, related_key, kind, source, confidence, batch_id)
           VALUES (?,?,?,?,?,?,?)""", rows)


def wordnet(con, path, version="Arabic WordNet 4.1"):
    members, ili, rels, sense_lemma = read_lmf(path)
    drop_previous(con, "wordnet", "relations")
    batch = new_batch(con, "wordnet", version, "relations",
                      {"synset": len(members), "ili": len(ili), "iliski": len(rels)})
    seen, rows = set(), []

    def add(a, b, kind):
        if not a or not b or a == b:
            return
        k = (lemma_key(a), lemma_key(b), kind)
        if k[0] == k[1] or k in seen:
            return
        seen.add(k)
        rows.append((k[0], b, k[1], kind, "wordnet", None, batch))

    for syn, lemmas in members.items():
        for a in lemmas:
            for b in lemmas:
                add(a, b, "synonym")
    for level, src, tgt, typ in rels:
        kind = REL_KIND.get(typ)
        if not kind:
            continue
        if level == "sense":
            add(sense_lemma.get(src), sense_lemma.get(tgt), kind)
        else:
            for a in members.get(src, []):
                for b in members.get(tgt, [])[:8]:
                    add(a, b, kind)
    _rel_insert(con, rows)
    # ILI köprüsü için Arapça synset → lemma eşlemesini sakla
    con.execute("CREATE TABLE IF NOT EXISTS etl_ili (ili TEXT, lemma TEXT)")
    con.execute("DELETE FROM etl_ili")
    con.executemany("INSERT INTO etl_ili VALUES (?,?)",
                    [(ili[s], l) for s, ls in members.items() if s in ili for l in ls if l])
    return {"batch": batch, "relations": finish_batch(con, batch, "relations")}


def _tr_insert(con, rows):
    con.executemany(
        "INSERT INTO translations (lemma_key, lang, gloss, source, batch_id) VALUES (?,?,?,?,?)", rows)


def omw_tr(con, path, version="Türkçe WordNet (LMF)"):
    if not con.execute("SELECT name FROM sqlite_master WHERE name='etl_ili'").fetchone():
        raise SystemExit("Önce 'import wordnet' çalıştırılmalı (ILI köprüsü için).")
    members, ili, _, _ = read_lmf(path)
    tr_by_ili = defaultdict(set)
    for s, ls in members.items():
        if s in ili:
            tr_by_ili[ili[s]].update(l for l in ls if l)
    drop_previous(con, "omw_tr", "translations")
    batch = new_batch(con, "omw_tr", version, "translations", {"tr_synset": len(tr_by_ili)})
    seen, rows = set(), []
    for i, ar in con.execute("SELECT ili, lemma FROM etl_ili"):
        for tr in sorted(tr_by_ili.get(i, ()))[:6]:
            k = (lemma_key(ar), tr.lower())
            if k not in seen:
                seen.add(k)
                rows.append((k[0], "tr", tr, "omw", batch))
    _tr_insert(con, rows)
    return {"batch": batch, "translations": finish_batch(con, batch, "translations")}


def kaikki(con, path, version="kaikki.org raw-wiktextract-data"):
    """İki yol: (1) Arapça maddelerin İngilizce tanımları → en;
    (2) İngilizce maddelerin çeviri tablolarında aynı anlam satırında Arapça ve Türkçe
    karşılık birlikte geçiyorsa → tr (köprü)."""
    drop_previous(con, "wiktionary", "translations")
    batch = new_batch(con, "wiktionary", version, "translations", {})
    seen, rows, n_lines = set(), [], 0

    def add(ar, lang, gloss):
        k = (lemma_key(ar), lang, gloss.strip().lower())
        if k[0] and k[2] and k not in seen:
            seen.add(k)
            rows.append((k[0], lang, gloss.strip(), "wiktionary", batch))

    for line in open(path, encoding="utf-8"):
        n_lines += 1
        if '"ar"' not in line:
            continue
        e = json.loads(line)
        if e.get("lang_code") == "ar":
            for s in e.get("senses", [])[:6]:
                for g in s.get("glosses", [])[:1]:
                    add(e["word"], "en", g)
        elif e.get("lang_code") == "en":
            by_sense = defaultdict(lambda: {"ar": [], "tr": []})
            trs = e.get("translations", []) + [t for s in e.get("senses", []) for t in s.get("translations", [])]
            for t in trs:
                if t.get("code") in ("ar", "tr") and t.get("word"):
                    by_sense[t.get("sense", "")][t["code"]].append(t["word"])
            for d in by_sense.values():
                for ar in d["ar"][:4]:
                    for tr in d["tr"][:4]:
                        add(ar, "tr", tr)
        if len(rows) > 20000:
            _tr_insert(con, rows); rows = []
    _tr_insert(con, rows)
    con.execute("UPDATE import_batches SET checks_json=? WHERE id=?",
                (json.dumps({"okunan_satir": n_lines}), batch))
    return {"batch": batch, "translations": finish_batch(con, batch, "translations")}


def sinalab(con, path, threshold=0.5, version="SinaLab Synonyms"):
    drop_previous(con, "sinalab", "relations")
    batch = new_batch(con, "sinalab", version, "relations", {"esik": threshold})
    rows, cols = [], None
    for r in read_rows(path):
        if cols is None:
            cols = (pick(r.keys(), ["synset_lemma", "lemma", "word", "synset", "arabic_lemma"], "lemma"),
                    pick(r.keys(), ["candidate", "candidate_synonym", "synonym", "candidates"], "aday"),
                    pick(r.keys(), ["score", "fuzzy", "fuzzy_value", "avg", "mean", "value"], "skor",
                         required=False))
        a, b = r[cols[0]], r[cols[1]]
        score = float(r[cols[2]]) if cols[2] and r[cols[2]] not in (None, "") else None
        if score is not None and score > 1:
            score /= 100
        if a and b and (score is None or score >= threshold):
            rows.append((lemma_key(a), b, lemma_key(b), "synonym", "sinalab", score, batch))
    _rel_insert(con, rows)
    return {"batch": batch, "relations": finish_batch(con, batch, "relations")}


def arabiclt(con, path, kind, version="mdanok/arabicLT"):
    """kind: synonym | antonym. CSV satırı: kelime, ilişkili kelime(ler) (virgül/، ile ayrılmış)."""
    drop_previous(con, f"arabiclt_{kind}", "relations")
    batch = new_batch(con, f"arabiclt_{kind}", version, "relations",
                      {"not": "Veri Radif uygulamasından çıkarılmış; menşe riski"})
    rows, cols = [], None
    for r in read_rows(path):
        if cols is None:
            keys = list(r.keys())
            cols = (pick(keys, ["word", "kalima", "الكلمة", keys[0]], "kelime"),
                    pick(keys, ["synonyms", "antonyms", "synonym", "antonym", "related",
                                "مرادفات", "أضداد", keys[-1]], "ilişkili"))
        a = r[cols[0]]
        for b in str(r[cols[1]] or "").replace("،", ",").split(","):
            b = b.strip()
            if a and b:
                rows.append((lemma_key(a), b, lemma_key(b), kind, f"arabiclt_{kind}", None, batch))
    _rel_insert(con, rows)
    return {"batch": batch, "relations": finish_batch(con, batch, "relations")}
