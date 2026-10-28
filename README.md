# Lügat Portalı

Arapça kelime veya kök yazıldığında klasik ve modern sözlükleri, Türkçe karşılıkları, Kur'an'daki
geçişleri, eş ve zıt anlamlıları ve aynı kökten türeyenleri tek sayfada gösteren, ücretsiz ve
ticari olmayan portal. Cloudflare Workers + D1 üzerinde çalışır.

**Temel kural:** hiçbir veri otomatik yayımlanmaz. Her kaynak "onay bekliyor" olarak yüklenir,
diğer kaynaklarla karşılaştırılır, sonra yönetim panelinden (`/yonetim`) insan onayıyla yayına girer.
Ayrıntı: [docs/KONTROL-SURECI.md](docs/KONTROL-SURECI.md).

## Klasörler

| Yol | İçerik |
|---|---|
| `src/` | Worker (Hono): arama, kök tespiti, transkripsiyon, yönetim API'si |
| `public/` | Arayüz: arama/sonuç (9 blok), favoriler, sözlük rehberi, yönetim paneli |
| `migrations/` | D1 şeması |
| `etl/` | Veri hazırlama (Python): içe aktarma → karşılaştırma → D1 SQL dışa aktarma → doğrulama |
| `data/` | Sözlük listesi, dış link şablonları, normalizasyon test vektörleri |
| `public/data/control_words.json` | 50 kontrol kelimesi (kolay / orta / zor / çok zor) |
| `docs/` | Yayın adımları, lisans notları, kontrol süreci, hatırlatmalar |

## Hızlı başlangıç (yerel)

```bash
npm install
pip install pyarrow            # yalnız m3ajim (Parquet) için gerekli

# 1) Veri: Kur'an morfolojisi + Arramooz (ikisi de bu depoda denenmiştir)
curl -LO https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt
pip download --no-deps arramooz-pysqlite -d /tmp/arr && cd /tmp/arr && python -m zipfile -e arramooz_pysqlite-*.whl x && cd -
python etl/run.py init
python etl/run.py import quran quran-morphology.txt
python etl/run.py import arramooz /tmp/arr/x/arramooz/data/arabicdictionary.sqlite
python etl/run.py compare      # → etl/out/karsilastirma_raporu.md
python etl/run.py export       # → etl/out/sql/*.sql

# 2) Yerel D1 ve sunucu
echo "ADMIN_TOKEN=$(openssl rand -hex 24)" > .dev.vars
npm run db:migrate:local
for f in etl/out/sql/*.sql; do npx wrangler d1 execute lugat --local --file "$f"; done
npm run dev                    # http://localhost:8787  ·  panel: http://localhost:8787/yonetim

# 3) Doğrulama (onaydan önce, önizleme verisiyle)
python etl/run.py validate --api http://localhost:8787 --token <ADMIN_TOKEN>   # → etl/out/dogrulama_raporu.md
npm test
```

Diğer kaynaklar (m3ajim, Lisân JSON, Lane, WordNet, Türkçe WordNet, Wiktionary, SinaLab, arabicLT)
için komutlar: `python etl/run.py --help`. Bu adaptörler gerçek dosyalarla henüz denenmedi
(geliştirme ortamından Hugging Face/Zenodo/kaikki erişimi yoktu); sütun adı tutmazsa program
mevcut sütunları listeleyip durur, `python etl/run.py inspect DOSYA` ile bakıp
`etl/sources/entries.py` veya `semantic.py`'deki aday listesine eklemek yeterlidir.

Canlıya alma: [docs/YAYIN.md](docs/YAYIN.md).
