# Yayına alma (alan adı + Cloudflare)

## Tek komut (sozluk.suheybk.com)

Windows (PowerShell):
```powershell
git clone https://github.com/suheybk/lugat; cd lugat; powershell -ExecutionPolicy Bypass -File scripts\yayinla.ps1
```

macOS / Linux:
```bash
git clone https://github.com/suheybk/lugat && cd lugat && bash scripts/yayinla.sh
```

Betik sırayla: paketleri kurar, Cloudflare girişi için tarayıcıyı açar, D1 veritabanını oluşturup
`wrangler.jsonc`'ye yazar, şemayı uygular, siteyi yayınlar (DNS kaydı otomatik açılır), yönetici
anahtarı üretir, Kur'an + Arramooz verisini hazırlayıp yükler. Size yalnızca onay soruları kalır.

## Elle kurulum

Bir kere yapılır; sonra her güncelleme `npm run deploy`.

1. **Giriş:** `npx wrangler login` (DİDA'nın Cloudflare hesabıyla).
2. **Veritabanı:** `npx wrangler d1 create lugat` → çıktıdaki `database_id` değerini
   `wrangler.jsonc` içine yazın.
3. **Şema:** `npm run db:migrate`
4. **Yönetici anahtarı:** `npx wrangler secret put ADMIN_TOKEN` → en az 32 karakterlik rastgele
   bir değer girin (`openssl rand -hex 24`). Bu anahtar yalnızca yönetim panelinde kullanılır;
   kimseyle paylaşmayın.
5. **Alan adı:** alan adınız Cloudflare'de (DNS orada yönetiliyor) olmalı. `wrangler.jsonc`
   içindeki `routes` satırının yorumunu kaldırıp adresi yazın, ör.
   `{ "pattern": "lugat.dida.org.tr", "custom_domain": true }`. DNS kaydını Cloudflare kendisi açar.
6. **Yayın:** `npm run deploy`
7. **Veri:** ETL çıktısını yükleyin:
   `for f in etl/out/sql/*.sql; do npx wrangler d1 execute lugat --remote --file "$f"; done`
8. **Onay:** `https://ALANADI/yonetim` → anahtarla giriş → yükleri inceleyip onaylayın.
   Onaylanana kadar site boş görünür; bu beklenen davranıştır.

## Önerilen ek koruma
- **Cloudflare Access** (Zero Trust, 50 kullanıcıya kadar ücretsiz): `/yonetim*` ve `/api/admin/*`
  yollarını yalnız sizin e-postanızla açın. Böylece anahtar sızsa bile panel kapalı kalır ve
  onaylayan kişinin e-postası işlem kaydına yazılır.
- **Turnstile** (ücretsiz): "Hata bildir" formuna spam gelirse eklenebilir.

## Sonraki veri güncellemeleri
Yeni bir kaynak yüklerken canlıdaki onayları ezmemek için yalnız yeni yükleri dışa aktarın:
`python etl/run.py export --batches 5,6` → aynı `d1 execute --remote` döngüsü.

## Boyut ve maliyet
D1 ücretsiz katmanı 5 GB'a kadar toplam depolama verir; tek veritabanı sınırı ücretsiz planda 500 MB'tır.
Kur'an + Arramooz ≈ 30 MB. m3ajim tam metinleri eklenince 300–400 MB beklenir (tahmin). Aşılırsa
Workers Paid (aylık ~5 $, 10 GB/veritabanı) gerekir. Güncel sınırları Cloudflare'in D1 fiyat sayfasından kontrol edin.
