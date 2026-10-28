"""lexicon.db → D1'e yüklenecek parçalı SQL dosyaları.

D1 dosya içinde BEGIN/COMMIT kabul etmez ve tek ifade ~100 KB ile sınırlıdır; bu yüzden
çok satırlı INSERT'ler ~80 KB'ta bölünür, dosyalar ~40 MB'ta kesilir.

  --batches 3,4   yalnızca bu yükleri (ve bağlı kökleri) dışa aktar — canlıdaki onayları korur.
  (boş)           ilk kurulum: referans tablolar + bütün yükler.
"""
from pathlib import Path

TABLES = ["dictionaries", "external_links", "roots", "import_batches", "lemmas", "entries",
          "relations", "translations", "quran_verses", "quran_occurrences"]
REFERENCE = {"dictionaries", "external_links", "roots", "quran_verses"}
STMT_LIMIT = 80_000
FILE_LIMIT = 40_000_000


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def run(con, out_dir: Path, batches=None):
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*.sql"):
        f.unlink()
    files, part, size, buf = [], 0, 0, []

    def flush_file():
        nonlocal part, size, buf
        if buf:
            part += 1
            p = out_dir / f"{part:03d}.sql"
            p.write_text("".join(buf), encoding="utf-8")
            files.append(p)
        size, buf = 0, []

    def emit(s):
        nonlocal size
        buf.append(s)
        size += len(s.encode())
        if size > FILE_LIMIT:
            flush_file()

    for t in TABLES:
        cols = [c[1] for c in con.execute(f"PRAGMA table_info({t})")]
        where = ""
        if batches:
            if t == "import_batches":
                where = f" WHERE id IN ({','.join(map(str, batches))})"
            elif "batch_id" in cols:
                where = f" WHERE batch_id IN ({','.join(map(str, batches))})"
            elif t == "quran_verses" and not con.execute(
                    f"SELECT 1 FROM import_batches WHERE source='quran_corpus' AND id IN ({','.join(map(str, batches))})").fetchone():
                continue
        verb = "INSERT OR REPLACE" if (t in REFERENCE or batches) else "INSERT"
        head = f"{verb} INTO {t} ({','.join(cols)}) VALUES "
        stmt, ssize = [], 0
        for row in con.execute(f"SELECT {','.join(cols)} FROM {t}{where}"):
            v = "(" + ",".join(lit(x) for x in row) + ")"
            if ssize + len(v) > STMT_LIMIT and stmt:
                emit(head + ",".join(stmt) + ";\n")
                stmt, ssize = [], 0
            stmt.append(v)
            ssize += len(v.encode())
        if stmt:
            emit(head + ",".join(stmt) + ";\n")
    emit("INSERT INTO entries_fts(entries_fts) VALUES('rebuild');\n")
    flush_file()
    return files
