# Lügat Portalı'nı sozluk.suheybk.com adresine kurar (Windows PowerShell). Tekrar çalıştırmak güvenlidir.
# Kullanım (depo klasöründe):  powershell -ExecutionPolicy Bypass -File scripts\yayinla.ps1
# Gerekenler: Node 18+, Python 3.9+, git. Cloudflare girişi için tarayıcı açılır.
# 'Continue': PowerShell 5 stderr'e yazan her aracı hata sayıp durdurmasın; hatalar çıkış koduyla denetlenir.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
# Önceki yarım denemede wrangler ayar dosyasını değiştirdiyse depodaki hâline döndür.
if ((git status --porcelain wrangler.jsonc) -and ((Get-Content wrangler.jsonc -Raw) -match '00000000-0000-0000-0000-000000000000|"binding": "lugat"')) {
  git checkout -- wrangler.jsonc
}
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

function Say($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
function Run {
  # Harici komutu çalıştırır; hata koduyla biterse betiği durdurur.
  $exe = $args[0]; $rest = @($args | Select-Object -Skip 1)
  & $exe @rest
  if ($LASTEXITCODE -ne 0) { Write-Host "Komut başarısız ($LASTEXITCODE): $exe $rest" -ForegroundColor Red; exit 1 }
}

# Python: önce 'py' başlatıcısı (Microsoft Store kısayoluna takılmamak için), sonra 'python'.
$Py = $null; $PyArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) { $Py = 'py'; $PyArgs = @('-3') }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $Py = 'python' }
if (-not $Py) { Write-Host -ForegroundColor Red "Python bulunamadı. https://www.python.org/downloads/ adresinden kurun ('Add to PATH' işaretli)."; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host -ForegroundColor Red "Node.js bulunamadı. https://nodejs.org adresinden LTS sürümünü kurun."; exit 1 }
function PyRun { Run $Py @PyArgs @args }

Say "1/7 Paketler kuruluyor"
Run npm.cmd ci --no-audit --no-fund

Say "2/7 Cloudflare girişi"
# Eski/kısıtlı bir API anahtarı ortam değişkeninde duruyorsa OAuth girişini bozar; bu oturum için kaldır.
if ($env:CLOUDFLARE_API_TOKEN) {
  Write-Host "CLOUDFLARE_API_TOKEN ortam değişkeni bu oturum için yok sayılıyor (tarayıcı girişi kullanılacak)."
  Remove-Item Env:CLOUDFLARE_API_TOKEN
}
$who = (& npx.cmd wrangler whoami 2>&1 | Out-String)
if ($who -notmatch 'logged in') { Run npx.cmd wrangler login }

# D1 yetkisini sına. "Authentication error [code: 10000]" çoğunlukla süresi dolmuş/eksik izinli
# girişten olur: bir kez çıkış yapıp yeniden giriş denenir.
function D1List { (& npx.cmd wrangler d1 list --json 2>$null | Out-String) }
$listJson = D1List
if ($LASTEXITCODE -ne 0) {
  Write-Host "D1'e erişilemedi; Cloudflare girişi yenileniyor (tarayıcıda tekrar 'Allow' deyin)..." -ForegroundColor Yellow
  & npx.cmd wrangler logout | Out-Null
  Run npx.cmd wrangler login
  $listJson = D1List
  if ($LASTEXITCODE -ne 0) {
    Write-Host @"
Cloudflare hâlâ D1 izni vermiyor. Kontrol edin:
  1) Tarayıcıda giriş yaptığınız hesap, suheybk.com'un bulunduğu hesap mı? (npx wrangler whoami)
  2) Bu hesapta rolünüz Super Administrator / Administrator mı?
  3) dash.cloudflare.com > Storage & Databases > D1 sayfası açılıyor mu (ilk kullanımda bir kez açmak gerekebilir)?
Sonra betiği yeniden çalıştırın.
"@ -ForegroundColor Red
    exit 1
  }
}

Say "3/7 D1 veritabanı (lugat)"
$placeholder = '00000000-0000-0000-0000-000000000000'
if ((Get-Content wrangler.jsonc -Raw) -match $placeholder) {
  $list = $listJson | ConvertFrom-Json
  if (-not ($list | Where-Object { $_.name -eq 'lugat' })) {
    # Ayarı betik kendisi yazar; wrangler'ın ikinci bir bağlama eklemesini istemiyoruz.
    Run npx.cmd wrangler d1 create lugat --location eeur --no-update-config
    $list = (D1List) | ConvertFrom-Json
  }
  $dbId = ($list | Where-Object { $_.name -eq 'lugat' } | Select-Object -First 1).uuid
  if (-not $dbId) { Write-Host -ForegroundColor Red "D1 veritabanı kimliği alınamadı."; exit 1 }
  # Dosyayı BOM'suz UTF-8 olarak yazmak için Python kullanılıyor.
  PyRun -c "import pathlib,sys; p=pathlib.Path('wrangler.jsonc'); p.write_text(p.read_text(encoding='utf-8').replace('$placeholder', sys.argv[1]), encoding='utf-8')" $dbId
  Write-Host "database_id = $dbId"
}
Run npx.cmd wrangler d1 migrations apply lugat --remote

Say "4/7 Worker yayınlanıyor -> https://sozluk.suheybk.com"
Run npx.cmd wrangler deploy

Say "5/7 Yönetici anahtarı"
if (-not (Test-Path .admin-token) -or -not (Get-Content .admin-token -Raw).Trim()) {
  PyRun -c "import secrets,pathlib; pathlib.Path('.admin-token').write_text(secrets.token_hex(24))"
}
$token = (Get-Content .admin-token -Raw).Trim()
$token | & npx.cmd wrangler secret put ADMIN_TOKEN
if ($LASTEXITCODE -ne 0) { Write-Host -ForegroundColor Red "ADMIN_TOKEN kaydedilemedi."; exit 1 }

Say "6/7 Veri hazırlanıyor (Kur'an morfolojisi + Arramooz)"
$dl = 'etl\out\indirilen'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
$quran = Join-Path $dl 'quran-morphology.txt'
if (-not (Test-Path $quran)) {
  Invoke-WebRequest -UseBasicParsing -OutFile $quran `
    -Uri 'https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt'
}
$arrDb = Join-Path $dl 'arramooz\arramooz\data\arabicdictionary.sqlite'
if (-not (Test-Path $arrDb)) {
  PyRun -m pip download --no-deps --quiet 'arramooz-pysqlite==0.4.2' -d $dl
  PyRun -m zipfile -e (Join-Path $dl 'arramooz_pysqlite-0.4.2-py3-none-any.whl') (Join-Path $dl 'arramooz')
}
Remove-Item -ErrorAction SilentlyContinue etl\out\lexicon.db
PyRun etl\run.py init
PyRun etl\run.py import quran $quran
PyRun etl\run.py import arramooz $arrDb
PyRun etl\run.py compare
PyRun etl\run.py export

Say "7/7 Veri D1'e yükleniyor"
$count = ((& npx.cmd wrangler d1 execute lugat --remote --json --command 'SELECT count(*) AS n FROM lemmas' | Out-String) | ConvertFrom-Json)[0].results[0].n
if ($count -gt 0) {
  Write-Host "Veritabanında zaten veri var; yükleme atlandı (onayları korumak için)."
} else {
  Get-ChildItem etl\out\sql\*.sql | Sort-Object Name | ForEach-Object {
    Run npx.cmd wrangler d1 execute lugat --remote --yes --file $_.FullName
  }
}

Write-Host ""
Write-Host "Bitti." -ForegroundColor Green
Write-Host "  Site:         https://sozluk.suheybk.com"
Write-Host "  Onay paneli:  https://sozluk.suheybk.com/yonetim"
Write-Host "  Yönetici anahtarı (.admin-token dosyasında da var): $token"
Write-Host ""
Write-Host "Not: Veriler 'onay bekliyor' durumunda yüklendi; panelden onaylayana kadar site boş görünür."
Write-Host "DNS ve SSL sertifikasının oturması birkaç dakika sürebilir."
