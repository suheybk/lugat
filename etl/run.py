"""Lügat Portalı ETL komut satırı.

  python etl/run.py init                         şema + sözlük listesi + dış linkler
  python etl/run.py inspect DOSYA                bilinmeyen dosyanın sütunlarını göster
  python etl/run.py import quran DOSYA           Kur'an morfolojisi (txt)
  python etl/run.py import arramooz DOSYA        arabicdictionary.sqlite
  python etl/run.py import m3ajim KLASÖR         Parquet dosyaları
  python etl/run.py import lisan-json DOSYA
  python etl/run.py import lane DOSYA            Lane SQLite
  python etl/run.py import wordnet DOSYA         Arabic WordNet LMF XML(.gz)
  python etl/run.py import omw-tr DOSYA          Türkçe WordNet LMF (wordnet'ten sonra)
  python etl/run.py import kaikki DOSYA          Wiktionary JSONL
  python etl/run.py import sinalab DOSYA
  python etl/run.py import arabiclt-syn DOSYA | arabiclt-ant DOSYA
  python etl/run.py compare                      kaynakları karşılaştır + rapor
  python etl/run.py status                       yük listesi
  python etl/run.py export [--batches 3,4]       D1 için SQL parçaları (etl/out/sql)
  python etl/run.py validate --api URL --token T 50 kontrol kelimesi raporu

Her içe aktarma 'pending' (onay bekliyor) durumunda girer. Yayına alma yalnızca
yönetim panelinden yapılır.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import compare  # noqa: E402
import export_sql  # noqa: E402
import validate  # noqa: E402
from db import OUT_DIR, connect, init_schema, seed_reference  # noqa: E402
from sources import arramooz, entries, quran, semantic  # noqa: E402
from sources.tabular import inspect  # noqa: E402

IMPORTERS = {
    "quran": quran.run,
    "arramooz": arramooz.run,
    "m3ajim": entries.m3ajim,
    "lisan-json": entries.lisan_json,
    "lane": entries.lane,
    "wordnet": semantic.wordnet,
    "omw-tr": semantic.omw_tr,
    "kaikki": semantic.kaikki,
    "sinalab": semantic.sinalab,
    "arabiclt-syn": lambda con, p: semantic.arabiclt(con, p, "synonym"),
    "arabiclt-ant": lambda con, p: semantic.arabiclt(con, p, "antonym"),
}


def main():
    ap = argparse.ArgumentParser(description="Lügat Portalı ETL")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    p = sub.add_parser("inspect"); p.add_argument("path")
    p = sub.add_parser("import"); p.add_argument("source", choices=IMPORTERS); p.add_argument("path")
    sub.add_parser("compare")
    sub.add_parser("status")
    p = sub.add_parser("export"); p.add_argument("--batches")
    p = sub.add_parser("validate"); p.add_argument("--api", default="http://localhost:8787"); p.add_argument("--token", default="")
    a = ap.parse_args()

    if a.cmd == "inspect":
        return inspect(a.path)
    if a.cmd == "validate":
        path, ok = validate.run(a.api, a.token)
        print(f"{ok}/50 sorunsuz → {path}")
        return
    con = connect()
    if a.cmd == "init":
        init_schema(con); seed_reference(con)
        print("Şema ve referans veriler hazır:", OUT_DIR / "lexicon.db")
    elif a.cmd == "import":
        init_schema(con)
        res = IMPORTERS[a.source](con, a.path)
        con.commit()
        print(json.dumps(res, ensure_ascii=False, indent=1))
        print("Durum: onay bekliyor. Sıradaki adım: python etl/run.py compare")
    elif a.cmd == "compare":
        compare.run(con)
        print("Rapor:", OUT_DIR / "karsilastirma_raporu.md")
    elif a.cmd == "status":
        for b in con.execute("SELECT id, source, target_table, row_count, status, compare_json FROM import_batches"):
            print(f"#{b['id']:<3} {b['source']:<14} {b['target_table']:<17} {b['row_count']:>8}  {b['status']:<9} {b['compare_json'] or ''}")
    elif a.cmd == "export":
        batches = [int(x) for x in a.batches.split(",")] if a.batches else None
        files = export_sql.run(con, OUT_DIR / "sql", batches)
        print(f"{len(files)} dosya →", OUT_DIR / "sql")


if __name__ == "__main__":
    main()
