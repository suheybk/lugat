"""Biçimi önceden kesin bilinmeyen kaynaklar için ortak okuyucu.

Bu adaptörler (m3ajim, Lisân JSON, Lane, SinaLab, arabicLT) geliştirme ortamında gerçek
dosyalarla denenemedi; sütun adları aday listelerinden seçilir. Eşleşme bulunamazsa
mevcut sütunları listeleyip durur — o zaman `python etl/run.py inspect DOSYA` çıktısına
bakıp aşağıdaki aday listelerine doğru adı eklemek yeterli.
"""
import csv
import json
import sqlite3
from pathlib import Path


class ColumnError(SystemExit):
    pass


def pick(columns, candidates, what, required=True):
    low = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand.lower() in low:
            return low[cand.lower()]
    if required:
        raise ColumnError(
            f"'{what}' sütunu bulunamadı. Adaylar: {candidates}. Dosyadaki sütunlar: {list(columns)}")
    return None


def read_rows(path, table=None):
    """CSV/TSV, Parquet, JSON, JSONL veya SQLite tablosunu dict satırları olarak okur."""
    p = Path(path)
    suf = p.suffix.lower()
    if suf == ".parquet":
        import pyarrow.parquet as pq
        t = pq.read_table(p)
        for batch in t.to_batches(10000):
            yield from batch.to_pylist()
    elif suf in (".csv", ".tsv"):
        with open(p, encoding="utf-8-sig", newline="") as f:
            yield from csv.DictReader(f, delimiter="\t" if suf == ".tsv" else ",")
    elif suf == ".jsonl":
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)
    elif suf == ".json":
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            # {kök: metin} ya da {kök: {...}} biçimi
            for k, v in data.items():
                yield {"__key__": k, **(v if isinstance(v, dict) else {"__value__": v})}
        else:
            yield from data
    elif suf in (".db", ".sqlite", ".sqlite3"):
        con = sqlite3.connect(p)
        con.row_factory = sqlite3.Row
        if table is None:
            raise ColumnError(f"SQLite tablosu belirtilmeli. Tablolar: {sqlite_tables(p)}")
        for r in con.execute(f'SELECT * FROM "{table}"'):
            yield dict(r)
    else:
        raise ColumnError(f"Desteklenmeyen dosya türü: {p}")


def sqlite_tables(path):
    con = sqlite3.connect(path)
    return {n: [c[1] for c in con.execute(f'PRAGMA table_info("{n}")')]
            for (n,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def inspect(path, n=3):
    p = Path(path)
    if p.suffix.lower() in (".db", ".sqlite", ".sqlite3"):
        for t, cols in sqlite_tables(p).items():
            print(f"[tablo] {t}: {cols}")
            for i, r in enumerate(read_rows(p, t)):
                if i >= n:
                    break
                print("   ", {k: str(v)[:80] for k, v in r.items()})
        return
    for i, r in enumerate(read_rows(p)):
        if i == 0:
            print("sütunlar:", list(r.keys()))
        if i >= n:
            break
        print("   ", {k: str(v)[:120] for k, v in r.items()})
