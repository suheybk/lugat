"""Yerel lexicon.db (SQLite) yardımcıları. Şema migrations/ klasöründen uygulanır,
böylece yerel dosya ile D1 aynı yapıdadır."""
import json
import re
import sqlite3
from pathlib import Path

from normalize import normalize_root

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT_DIR / "etl" / "out"
DB_PATH = OUT_DIR / "lexicon.db"


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_schema(con: sqlite3.Connection) -> None:
    for f in sorted((ROOT_DIR / "migrations").glob("*.sql")):
        con.executescript(f.read_text(encoding="utf-8"))


def seed_reference(con: sqlite3.Connection) -> None:
    """Sözlük listesi ve dış link şablonları (elle hazırlanmış, plan dokümanından)."""
    dicts = json.loads((ROOT_DIR / "data/dictionaries.json").read_text(encoding="utf-8"))
    for i, d in enumerate(dicts):
        con.execute(
            """INSERT INTO dictionaries (code, name_ar, name_tr, author, death, century, grp, type,
                 ordering, scope, license, open_data, link_url, sort_order)
               VALUES (:code, :name_ar, :name_tr, :author, :death, :century, :grp, :type,
                 :ordering, :scope, :license, :open_data, :link_url, :sort_order)
               ON CONFLICT(code) DO UPDATE SET name_ar=excluded.name_ar, name_tr=excluded.name_tr,
                 author=excluded.author, death=excluded.death, century=excluded.century,
                 grp=excluded.grp, type=excluded.type, ordering=excluded.ordering,
                 scope=excluded.scope, license=excluded.license, open_data=excluded.open_data,
                 link_url=excluded.link_url, sort_order=excluded.sort_order""",
            {"link_url": None, **d, "sort_order": i},
        )
    links = json.loads((ROOT_DIR / "data/external_links.json").read_text(encoding="utf-8"))
    for i, l in enumerate(links):
        con.execute(
            """INSERT INTO external_links (code, name, description, url_template, scope, sort_order)
               VALUES (:code, :name, :description, :url_template, :scope, :sort_order)
               ON CONFLICT(code) DO UPDATE SET name=excluded.name, description=excluded.description,
                 url_template=excluded.url_template, scope=excluded.scope, sort_order=excluded.sort_order""",
            {**l, "sort_order": i},
        )
    con.commit()


def new_batch(con, source: str, version: str, table: str, checks: dict) -> int:
    cur = con.execute(
        "INSERT INTO import_batches (source, source_version, target_table, checks_json) VALUES (?,?,?,?)",
        (source, version, table, json.dumps(checks, ensure_ascii=False)),
    )
    return cur.lastrowid


def finish_batch(con, batch_id: int, table: str) -> int:
    n = con.execute(f"SELECT count(*) FROM {table} WHERE batch_id=?", (batch_id,)).fetchone()[0]
    con.execute("UPDATE import_batches SET row_count=? WHERE id=?", (n, batch_id))
    con.commit()
    return n


def drop_previous(con, source: str, table: str) -> None:
    """Aynı kaynağın önceki *onaylanmamış* yüklemesini siler; onaylı satırlara dokunmaz."""
    ids = [r[0] for r in con.execute(
        "SELECT id FROM import_batches WHERE source=? AND target_table=? AND status IN ('pending','rejected')",
        (source, table))]
    for bid in ids:
        if table == "lemmas":
            con.execute("DELETE FROM quran_occurrences WHERE lemma_id IN (SELECT id FROM lemmas WHERE batch_id=?)", (bid,))
        con.execute(f"DELETE FROM {table} WHERE batch_id=?", (bid,))
        con.execute("DELETE FROM import_batches WHERE id=?", (bid,))
    con.commit()


class RootCache:
    def __init__(self, con):
        self.con = con
        self.ids = {r["root_norm"]: r["id"] for r in con.execute("SELECT id, root_norm FROM roots")}

    def get(self, root: str | None) -> int | None:
        if not root:
            return None
        # Arramooz bazen iki kök verir ("علو،علي"); ilki alınır, karşılaştırma notu diğerini gösterir.
        root = re.split(r"[،,/\s]+", root.strip())[0]
        key = normalize_root(root)
        if len(key) < 2:
            return None
        if key not in self.ids:
            cur = self.con.execute(
                "INSERT INTO roots (root, root_norm, letters_count) VALUES (?,?,?)", (root, key, len(key)))
            self.ids[key] = cur.lastrowid
        return self.ids[key]
