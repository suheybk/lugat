#!/usr/bin/env bash
# Lügat Portalı'nı sozluk.suheybk.com adresine kurar. Tekrar çalıştırmak güvenlidir.
# Kullanım (depo klasöründe):  bash scripts/yayinla.sh
# Gerekenler: Node 18+, Python 3.9+, git. Cloudflare girişi için tarayıcı açılır.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

say "1/7 Paketler kuruluyor"
npm ci --no-audit --no-fund

say "2/7 Cloudflare girişi"
unset CLOUDFLARE_API_TOKEN
npx wrangler whoami 2>/dev/null | grep -qi "logged in" || npx wrangler login
if ! npx wrangler d1 list --json >/dev/null 2>&1; then
  echo "D1'e erişilemedi; Cloudflare girişi yenileniyor..."
  npx wrangler logout >/dev/null || true
  npx wrangler login
  npx wrangler d1 list --json >/dev/null || { echo "Cloudflare D1 izni vermiyor: hesap/rol kontrol edin."; exit 1; }
fi

say "3/7 D1 veritabanı (lugat)"
if grep -q '00000000-0000-0000-0000-000000000000' wrangler.jsonc; then
  npx wrangler d1 list --json | python3 -c 'import json,sys; sys.exit(0 if any(d["name"]=="lugat" for d in json.load(sys.stdin)) else 1)' \
    || npx wrangler d1 create lugat --location eeur --no-update-config
  DB_ID=$(npx wrangler d1 list --json | python3 -c 'import json,sys; print(next(d["uuid"] for d in json.load(sys.stdin) if d["name"]=="lugat"))')
  python3 - "$DB_ID" <<'PY'
import pathlib, sys
p = pathlib.Path("wrangler.jsonc")
p.write_text(p.read_text().replace("00000000-0000-0000-0000-000000000000", sys.argv[1]))
PY
  echo "database_id = $DB_ID"
fi
npx wrangler d1 migrations apply lugat --remote

say "4/7 Worker yayınlanıyor → https://sozluk.suheybk.com"
npx wrangler deploy

say "5/7 Yönetici anahtarı"
if [ ! -s .admin-token ]; then
  python3 -c 'import secrets; print(secrets.token_hex(24))' > .admin-token
  chmod 600 .admin-token
fi
npx wrangler secret put ADMIN_TOKEN < .admin-token

say "6/7 Veri hazırlanıyor (Kur'an morfolojisi + Arramooz)"
DL=etl/out/indirilen
mkdir -p "$DL"
[ -s "$DL/quran-morphology.txt" ] || curl -fL -o "$DL/quran-morphology.txt" \
  https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt
if [ ! -s "$DL/arramooz/arramooz/data/arabicdictionary.sqlite" ]; then
  python3 -m pip download --no-deps --quiet arramooz-pysqlite==0.4.2 -d "$DL"
  python3 -m zipfile -e "$DL"/arramooz_pysqlite-0.4.2-py3-none-any.whl "$DL/arramooz"
fi
rm -f etl/out/lexicon.db
python3 etl/run.py init
python3 etl/run.py import quran "$DL/quran-morphology.txt"
python3 etl/run.py import arramooz "$DL/arramooz/arramooz/data/arabicdictionary.sqlite"
python3 etl/run.py compare
python3 etl/run.py export

say "7/7 Veri D1'e yükleniyor"
if [ "$(npx wrangler d1 execute lugat --remote --json --command 'SELECT count(*) AS n FROM lemmas' \
       | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["results"][0]["n"])')" != "0" ]; then
  echo "Veritabanında zaten veri var; yükleme atlandı (onayları korumak için)."
else
  for f in etl/out/sql/*.sql; do npx wrangler d1 execute lugat --remote --file "$f"; done
fi

cat <<MSG

✅ Bitti.
   Site:          https://sozluk.suheybk.com
   Onay paneli:   https://sozluk.suheybk.com/yonetim
   Yönetici anahtarı (.admin-token dosyasında da var):
   $(cat .admin-token)

Not: Veriler "onay bekliyor" durumunda yüklendi. Panelden onaylayana kadar site boş görünür.
DNS ve SSL sertifikasının oturması birkaç dakika sürebilir.
MSG
