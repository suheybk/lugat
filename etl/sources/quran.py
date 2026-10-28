"""Quranic Arabic Corpus morfolojisi (mustafa0x/quran-morphology çatalı, Arapça harfli).

Satır biçimi:  sure:âyet:kelime:segment <TAB> form <TAB> N|V|P <TAB> özellikler (| ile)
  ör.  1:1:2:1	ٱللَّهِ	N	PN|ROOT:أله|LEM:اللَّه|GEN

İndirme: https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt
Lisans: GNU GPL — corpus.quran.com'a atıf zorunlu, metin değiştirilemez.
"""
from collections import defaultdict

from db import RootCache, finish_batch, new_batch, drop_previous
from normalize import CATEGORY_QAC, form_key, lemma_key, normalize

EXPECTED = {"verses": 6236, "words": 77429, "suras": 114}

POS = {"N": "isim", "V": "fiil", "P": "harf"}
VF = {str(i): r for i, r in enumerate(
    ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"])}


def parse(path):
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        loc, form, tag, feats = line.split("\t")
        s, a, w, seg = map(int, loc.split(":"))
        f = feats.split("|")
        d = {k: v for k, _, v in (x.partition(":") for x in f if ":" in x)}
        yield dict(sura=s, aya=a, word=w, seg=seg, form=form, tag=tag, feats=f, kv=d)


def run(con, path, version="mustafa0x/quran-morphology@master"):
    rows = list(parse(path))
    words = defaultdict(list)
    for r in rows:
        words[(r["sura"], r["aya"], r["word"])].append(r)
    verses = defaultdict(list)
    for (s, a, w), segs in sorted(words.items()):
        verses[(s, a)].append("".join(x["form"] for x in segs))

    checks = {
        "segment_satiri": len(rows),
        "kelime": len(words), "kelime_beklenen": EXPECTED["words"],
        "ayet": len(verses), "ayet_beklenen": EXPECTED["verses"],
        "sure": len({s for s, _ in verses}), "sure_beklenen": EXPECTED["suras"],
    }
    checks["yapisal_kontrol"] = "GEÇTİ" if (
        checks["kelime"] == EXPECTED["words"] and checks["ayet"] == EXPECTED["verses"]
        and checks["sure"] == EXPECTED["suras"]) else "KALDI"

    drop_previous(con, "quran_corpus", "lemmas")
    batch = new_batch(con, "quran_corpus", version, "lemmas", checks)
    roots = RootCache(con)

    con.execute("DELETE FROM quran_verses")
    con.executemany("INSERT INTO quran_verses (sura, aya, text) VALUES (?,?,?)",
                    [(s, a, " ".join(ws)) for (s, a), ws in verses.items()])

    lemma_ids, lemma_keys = {}, {}
    occ = []
    for (s, a, w), segs in words.items():
        full = "".join(x["form"] for x in segs)
        for x in segs:
            lem = x["kv"].get("LEM")
            if not lem or "PREF" in x["feats"] or "SUFF" in x["feats"]:
                continue
            root = x["kv"].get("ROOT")
            root_id = roots.get(root)
            pos = POS[x["tag"]]
            if "PN" in x["feats"]:
                pos = "özel isim"
            elif "ADJ" in x["feats"]:
                pos = "sıfat"
            vf = VF.get(x["kv"].get("VF", ""), "") or None
            cat = "fiil" if x["tag"] == "V" else next((CATEGORY_QAC[f] for f in x["feats"] if f in CATEGORY_QAC), None)
            # Korpus, Mushaf'ta açık te ile yazılan dişil isimleri öyle lemmalar (عِبادَت، وَلايَت);
            # karşılaştırma anahtarında ة'ye çevrilir, harekeli asıl korunur.
            lkey = lemma_key(lem)
            if x["tag"] == "N" and lkey.endswith("ت") and any(f in x["feats"] for f in ("F", "FS", "FP")):
                lkey = lkey[:-1] + "ه"
            key = (lem, root_id, pos)
            if key not in lemma_ids:
                cur = con.execute(
                    """INSERT INTO lemmas (root_id, lemma_voc, lemma_norm, lemma_key, pos, verb_form,
                         category, source, batch_id) VALUES (?,?,?,?,?,?,?, 'quran_corpus', ?)""",
                    (root_id, lem, normalize(lem), lkey, pos, vf, cat, batch))
                lemma_ids[key] = cur.lastrowid
                lemma_keys[cur.lastrowid] = lkey
            feats = "|".join(v for v in x["feats"] if not v.startswith(("ROOT:", "LEM:")))
            occ.append((lemma_ids[key], lemma_keys[lemma_ids[key]], root_id, s, a, w, full, form_key(full),
                        form_key(x["form"]), pos, feats, batch))

    con.executemany(
        """INSERT INTO quran_occurrences (lemma_id, lemma_key, root_id, sura, aya, word_index, form,
             form_norm, stem_norm, pos, features, batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", occ)
    con.execute("""UPDATE lemmas SET quran_count = (SELECT count(*) FROM quran_occurrences q
                   WHERE q.lemma_id = lemmas.id) WHERE batch_id = ?""", (batch,))
    n = finish_batch(con, batch, "lemmas")
    return {"batch": batch, "lemmas": n, "occurrences": len(occ), **checks}
