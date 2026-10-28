"""50 kontrol kelimesini çalışan bir portala (yerel veya canlı) sorar ve 4 zorluk
seviyesine göre rapor üretir. Yönetici anahtarıyla preview=1 kullanılır, böylece
henüz onaylanmamış (pending) veri de görülür ve onaydan ÖNCE değerlendirilebilir.

  python etl/run.py validate --api http://localhost:8787 --token $ADMIN_TOKEN
"""
import json
import urllib.parse
import urllib.request

from db import OUT_DIR, ROOT_DIR
from normalize import normalize_root

LEVEL_TR = {"kolay": "Kolay", "orta": "Orta", "zor": "Zor", "cok_zor": "Çok zor"}
BLOCKS = [("baslik", "Başlık"), ("turkce", "TR"), ("klasik", "Klasik"), ("modern", "Modern"),
          ("kuran", "Kur'an"), ("iliskiler", "Eş/zıt"), ("turevler", "Türev")]


def fetch(api, token, word):
    url = f"{api.rstrip('/')}/api/search?q={urllib.parse.quote(word)}&preview=1"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"} if token else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def check(word, res):
    lem = res.get("lemma") or {}
    root = (res.get("root") or {}).get("root")
    ok_root = bool(root) and normalize_root(root) == normalize_root(word["kok"])
    q = res.get("quran") or {}
    blocks = {
        "baslik": bool(lem),
        "turkce": bool(res.get("translations")),
        "klasik": any(g["group"] == "klasik" for g in res.get("entries", [])),
        "modern": any(g["group"] in ("modern", "ingilizce") for g in res.get("entries", [])),
        "kuran": (q.get("lemma_count") or 0) > 0,
        "iliskiler": bool(res.get("relations")),
        "turevler": bool(res.get("derivatives")),
    }
    problems = []
    if not ok_root:
        problems.append(f"kök beklenen {word['kok']}, bulunan {root or '—'}")
    if word["kuran"] != blocks["kuran"]:
        problems.append("Kur'an'da geçmesi bekleniyordu" if word["kuran"] else
                        f"Kur'an'da beklenmiyordu ama {q.get('lemma_count')} geçiş bulundu")
    return ok_root, blocks, problems


def run(api, token):
    words = json.loads((ROOT_DIR / "public/data/control_words.json").read_text(encoding="utf-8"))
    out = ["# Doğrulama raporu — 50 kontrol kelimesi", "",
           f"API: {api} (preview=1: onay bekleyen veri dahil)", "",
           "✓ blok dolu · · blok boş · Sorun sütunu insan incelemesi gerektirir.", ""]
    total_ok = 0
    for level in ("kolay", "orta", "zor", "cok_zor"):
        ws = [w for w in words["kelimeler"] if w["seviye"] == level]
        out += [f"## {LEVEL_TR[level]} — {words['seviyeler'][level]}", "",
                "| Kelime | Kök | " + " | ".join(b for _, b in BLOCKS) + " | Sorun |",
                "|---|---|" + "---|" * len(BLOCKS) + "---|"]
        lvl_ok = 0
        for w in ws:
            try:
                ok_root, blocks, problems = check(w, fetch(api, token, w["kelime"]))
            except Exception as e:  # ağ / sunucu hatası
                ok_root, blocks, problems = False, {}, [f"istek hatası: {e}"]
            good = ok_root and not problems
            lvl_ok += good
            out.append(f"| {w['kelime']} | {w['kok']} | " +
                       " | ".join("✓" if blocks.get(k) else "·" for k, _ in BLOCKS) +
                       f" | {'; '.join(problems) or '—'} |")
        total_ok += lvl_ok
        out += ["", f"**{lvl_ok}/{len(ws)} sorunsuz**", ""]
    out.insert(4, f"**Toplam: {total_ok}/{len(words['kelimeler'])} kelime sorunsuz.**\n")
    path = OUT_DIR / "dogrulama_raporu.md"
    path.write_text("\n".join(out), encoding="utf-8")
    return path, total_ok
