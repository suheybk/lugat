"""Arramooz Alwaseet — isim ve fiil sözlüğü (kök, vezin, çoğul, cinsiyet).

Dosya: arramooz-pysqlite paketinin içindeki arramooz/data/arabicdictionary.sqlite
  pip download --no-deps arramooz-pysqlite  →  .whl dosyasını zip olarak aç
Lisans: GPL. Tablolar: nouns (vocalized, root, wazn, wordtype, gender, broken_plural, ...),
verbs (vocalized, root, future_type, triliteral, ...).

Not: nouns.definition sütunundaki tanımlar başka bir sözlükten (el-Ganî) gelmektedir;
lisansı netleşene kadar içe aktarılmaz.
"""
import sqlite3

from db import RootCache, drop_previous, finish_batch, new_batch
from normalize import category_from_arramooz, lemma_key, normalize

FUTURE = {"فتحة": "yef'alu", "ضمة": "yef'ulu", "كسرة": "yef'ilu"}


SHADDA = "\u0651"


def verb_form(voc: str, root: str):
    """Sülâsî kökten fiilin babını (I–X) harf iskeletinden çıkarır; emin olunamazsa None."""
    from normalize import normalize_root, strip_diacritics
    r = normalize_root(root or "")
    w = strip_diacritics(voc).replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    if len(r) != 3 or not w:
        return None
    n = len(w)
    if n == 3:
        return "II" if SHADDA in voc[2:6] and voc.count(SHADDA) == 1 and voc.index(SHADDA) < len(voc) - 2 else "I"
    if n == 4:
        if w[0] == "ا" and voc.rstrip("\u064E").endswith(SHADDA):
            return "IX"
        if w[0] == "ت" and SHADDA in voc:
            return "V"
        if w[0] == "ا":
            return "IV"
        if w[1] == "ا":
            return "III"
    if n == 5:
        if w.startswith("ان"):
            return "VII"
        if w[0] == "ت" and w[2] == "ا":
            return "VI"
        if w[0] == "ت":
            return "V"
        if w[0] == "ا" and w[2] in "تطد":
            return "VIII"
        if w[0] == "ا" and voc.rstrip("\u064E").endswith(SHADDA):
            return "IX"
    if n == 6 and w.startswith("است"):
        return "X"
    return None


def noun_pos(wordtype: str) -> str:
    t = wordtype or ""
    if "صفة" in t or "صفة مشبهة" in t:
        return "sıfat"
    return "isim"


def run(con, path, version="arramooz-pysqlite 0.4.2"):
    src = sqlite3.connect(path)
    src.row_factory = sqlite3.Row
    nouns = src.execute("SELECT * FROM nouns").fetchall()
    verbs = src.execute("SELECT * FROM verbs").fetchall()
    checks = {"isim": len(nouns), "fiil": len(verbs),
              "koksuz_isim": sum(1 for r in nouns if not r["root"]),
              "koksuz_fiil": sum(1 for r in verbs if not r["root"])}

    drop_previous(con, "arramooz", "lemmas")
    batch = new_batch(con, "arramooz", version, "lemmas", checks)
    roots = RootCache(con)

    rows = []
    for r in nouns:
        voc = (r["vocalized"] or "").strip()
        if not voc:
            continue
        rows.append((roots.get(r["root"]), voc, normalize(voc), lemma_key(voc), noun_pos(r["wordtype"]),
                     r["wazn"] or None, r["gender"] or None, r["broken_plural"] or None, None,
                     category_from_arramooz(r["wordtype"]), batch))
    for r in verbs:
        voc = (r["vocalized"] or "").strip()
        if not voc:
            continue
        rows.append((roots.get(r["root"]), voc, normalize(voc), lemma_key(voc), "fiil",
                     FUTURE.get(r["future_type"] or ""), None, None, verb_form(voc, r["root"]), "fiil", batch))
    con.executemany(
        """INSERT OR IGNORE INTO lemmas (root_id, lemma_voc, lemma_norm, lemma_key, pos, pattern, gender,
             plural, verb_form, category, source, batch_id) VALUES (?,?,?,?,?,?,?,?,?,?, 'arramooz', ?)""", rows)
    n = finish_batch(con, batch, "lemmas")
    return {"batch": batch, "lemmas": n, **checks}
