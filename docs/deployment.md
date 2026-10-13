# RAG StepLab deployment — Modal

Bu dosya aktif production mimarisinin canonical deployment ve rollback
sözleşmesidir.

## Production mimarisi

```text
Vercel Next.js
    ↓
Modal FastAPI ASGI API
    ↓
Modal internal worker (full Docling DocumentConverter)
    ↓
Supabase PostgreSQL + pgvector + private Storage
    ↓
Gemini
```

Supabase schema, private Storage bucket, Supabase CLI migration lineage'ı ve
RAG pipeline aynı kalır. Browser yalnız FastAPI yüzeyiyle konuşur; Docling worker
public endpoint değildir.

## Parse polling

Async parse sözleşmesi (`202 → queued → running → completed | failed`,
`parse_interrupted` normalizasyonu) [backend/README.md](../backend/README.md#async-parse-sözleşmesi)
içinde tanımlıdır. Frontend 2 saniyede bir poll eder. Browser 15 dakika sonunda gerçek run'ı
failed yapmadan takibi durdurur; refresh durable polling'i sürdürür. Transient
network/5xx/408/429 hataları run'ı failed yapmaz. queued/running sırasında
ikinci submit hem UI hem database unique inflight guard ile engellenir. Fake
answer veya score üretilmez. Progress yüzdesinin backend checkpoint'leri
authoritative'dir; UI iki checkpoint arasında yalnız açıkça `estimated` olarak
işaretlenen ve bir sonraki checkpoint'i geçmeyen görsel ilerleme gösterebilir.

## Modal App

Tek `rag-steplab-api` Modal App dört farklı compute profili kullanır
(`backend/modal_app.py`):

| Bileşen | Function | CPU | Bellek | Timeout | Min/Max |
| --- | --- | ---: | ---: | ---: | ---: |
| FastAPI ASGI | `api_eu` | 0.5 | 1024 MiB | 300 s | 1 / 4 |
| Full Docling parse worker | `parse_worker` (`benchmark_parse` aynı profili kullanır) | 2.0 | 4096 MiB | 900 s | 0 / 2 |
| Pipeline worker (embedding, experiment, evaluation) | `pipeline_worker` | 1.0 | 2048 MiB | 1800 s | 0 / 3 |
| Bakım tarayıcısı (10 dakikada bir, Modal schedule) | `maintenance_sweeper` | 0.25 | 512 MiB | 300 s | 0 / 1 |

Yalnız bir `api_eu` container'ı sıcak kalır; Max değerleri yalnız eşzamanlı
yükte farklı kullanıcıların işlerini paralel çalıştırır, boşta maliyet eklemez.
Kullanıcı başına tek aktif ağır iş kuralı ve run lease/fencing'i veritabanında
uygulandığından container sayısından bağımsızdır. `@modal.concurrent`
kullanılmaz: her container aynı anda tek input işler, böylece senkron endpoint'ler
ve CPU-yoğun chunking aynı 0.5 CPU'yu paylaşmaz. Her süreç en çok
`POOL_SIZE + MAX_OVERFLOW` = 2 Postgres bağlantısı açabilir (`backend/app/db.py`);
sıralı çalışan container pratikte bir bağlantı kullanır. Tam ölçekte `api_eu` +
`pipeline_worker` + `parse_worker` + `maintenance_sweeper` = 10 container: pratikte
10, tavan 20 bağlantı (legacy `api` ve manuel `benchmark_parse` en çok 4 container
ekler). Supavisor session modunda eşzamanlı client sayısı pool size ile sınırlıdır;
Max değerleri artırılmadan önce Supabase Dashboard'daki pool size'ın bu tavanı
karşıladığı doğrulanır.

Pipeline worker ve bakım tarayıcısı API image'ını kullanır (Docling taşımaz).
Hosted ortamda embedding run'ları durable `pipeline_worker` üzerinde çalışır;
lease her sağlayıcı batch'inden önce yenilenir. `maintenance_sweeper` storage
cleanup outbox'ını boşaltır ve worker'ı ölmüş run'ları kapatır. Pipeline worker timeout ve startup
timeout `PIPELINE_WORKER_TIMEOUT_SECONDS` / `PIPELINE_WORKER_STARTUP_TIMEOUT_SECONDS`
ile ayarlanır (varsayılan 1800 s / 300 s); backend lease/timeout hesabı aynı
değişkenleri okur, bu yüzden Modal deploy'u ile API secret'ında aynı değer
tutulmalıdır. Legacy `api` yalnız rollback içindir. `prefetch_docling_models`
(1800 s) ve `remote_import_smoke` (300 s) operasyonel yardımcı Function'lardır.
Deploy anı değişkenleri: `MODAL_API_COMPUTE_REGION` (varsayılan `eu`),
`MODAL_API_ROUTING_REGION` (`eu-west`), `MODAL_API_SECRET_NAMES`
(`rag-steplab-api-runtime`) ve `MODAL_WORKER_SECRET_NAMES`
(`rag-steplab-parser-runtime`); secret değerleri Modal Secret içinde kalır.

Production Supabase `eu-central-1` yakınlığı için yalnız interactive API
`region=eu` ve `routing_region=eu-west` kullanır. Routing region mevcut Function
üzerinde değiştirilemediğinden `api_eu` yeni Function kimliğidir; önceki `api`
endpoint'i cutover rollback'i olarak scale-to-zero kalır. Docling worker'ın
compute placement ve scale-to-zero davranışı değişmez.

API image yalnız `backend/requirements.txt` taşır; Docling ve ağır Torch katmanı
yalnız worker image'ındadır. Böylece sıcak API container'ına parser/ML runtime'ı
taşınmaz.

`docling==2.117.0` pinned'dir. Model artifact'ları
`rag-steplab-docling-models-v2` Volume içinde
`/models/docling/docling-2.117.0` yolunda kalıcıdır. Image, Modal 1.x source
packaging gereği `backend/app` paketini explicit ekler. Worker/provider değişikliğinde
release remote smoke `app.main`, `app.parser` ve Docling sürümünü kontrol eder.
Artifact/cache hazır oluşu ve gerçek parse sonucu ayrı operasyonel doğrulamadır.

OCR profilinin üç hash-pinned ONNX modeli `app/ocr.py` ile worker image build
sırasında `/opt/rag-steplab/ocr/rapidocr-v6-small-onnx-v1` içine hazırlanır.
Bu yol Docling Volume dışında kalır; boş Volume OCR modelini maskelemez.
`prefetch_docling_models` yalnız layout/tableformer indirir ve image OCR
manifestini doğrular. RapidOCR default downloader ile başka recognition
profili hazırlamayın. Request sırasında OCR indirmesi veya sessiz fallback
yoktur. Runtime pin'leri `requirements-worker.txt` içindedir. OCR profil
değişiklikleri yeni worker image'ı ve yetkili hosted parse doğrulaması gerektirir;
kaynak değişikliği tek başına deploy edildiği anlamına gelmez.

Karaman regression PDF'iyle ilk ölçüm:

| Koşum | Parse süresi | Peak RSS |
| --- | ---: | ---: |
| Cold | 33.983 ms | 2.872,7 MiB |
| Warm | 25.996 ms | 3.325,89 MiB |

Bu sonuç 4 GiB worker profilini korumayı gerektirir. CPU/bellek ancak aynı
semantic gate birden fazla gerçek PDF ile geçerse küçültülür.

## Secrets ve environment

Frontend yalnız public API URL'sini alır:

```text
NEXT_PUBLIC_API_BASE_URL=https://<modal-api-eu-domain>
```

Modal API ve worker secret'ları server-side Modal Secret olarak tutulur.
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY` ve
benzeri değerler browser'a, `NEXT_PUBLIC_*` değişkenlerine, source control'a,
smoke output'una veya loglara yazılmaz. CORS yalnız gerçek Vercel origin'lerini
exact içerir; wildcard kullanılmaz. PDF limiti 50 MiB'dir.

`BENCHMARK_EVALUATION_ENABLED` varsayılan olarak `false` kalır. Yalnız sınırlı,
internal benchmark çalışması için geçici olarak açılır; normal kullanıcı
evaluation akışının 10-case sınırını genişletmez.

Next.js tüm route'larda CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`nosniff`, strict-origin referrer ve daraltılmış Permissions Policy gönderir.
CSP `connect-src` yalnız self ile build sırasında tanımlı API/Supabase origin'lerini
kapsar; yalnız Vercel Preview geri bildirim aracı için `VERCEL_ENV=preview`
koşulunda `https://vercel.live` script, bağlantı ve frame kaynağı olarak eklenir.
PDF önizleme için blob frame korunur; production CSP'de Vercel kaynağı yoktur.
HSTS uygulama tarafından tekrar
üretilmez: production TLS/HSTS davranışı Vercel edge katmanının sorumluluğudur
ve release smoke'ta response header olarak ayrıca doğrulanmalıdır.

CI, production npm dependency audit'i ile worker/base ve CI Python lock
audit'lerini çalıştırır. Python bağımlılıkları `backend/requirements*.in`
girdilerinden üretilen hash'li `uv` lock'larıdır (`backend/requirements*.txt`);
Modal image'ları ve CI aynı lock'ları kurar, audit deploy edilen pin'leri denetler. Worker audit'i `docling==2.117.0` için yayımlanan on
advisory'yi (`ci.yml` içindeki liste) bilinçli olarak muaf tutar: bunlar HTML,
LaTeX, OpenDocument, METS-GBS, Docling JSON backend'leri, KServe OCR ve plugin
yükleme yollarını etkiler. Upload `%PDF-` imzası ister ve converter
`allowed_formats=[PDF]` ile kısıtlıdır. PYSEC-2026-4194 (METS-GBS format tespiti)
muafiyeti ayrıca upload'ın `%PDF-` imzasını offset 0'da zorunlu kılıp gzip/zip
magic'ini reddetmesine dayanır; bu kontrol gevşetilirse muafiyet geçersizdir. Düzeltilmiş sürümler (2.132.0 ve
2.135.0, `docling-ibm-models` 4.x) örnek TR PDF'inin 4. sayfasındaki iki
paragrafı ham Docling çıktısında düşürdüğünden yükseltme yapılmadı; yeni Docling
sürümü aynı örnekte içerik kaybetmediği doğrulanınca muafiyet kaldırılır.
Dependabot npm, Python (`uv` lock'ları) ve SHA ile pinli GitHub Actions için haftalık,
bounded PR üretir. Repository private ve GitHub Code Scanning etkin olmadığı
için CodeQL workflow'u bilinçli olarak yoktur; ücretsiz uygunluk doğrulanmadan
Advanced Security gerektiren bir gate zorunlu kılınmaz.

## Deploy sırası ve gerçek otomatik kapılar

1. PR'da değişikliğe göre yerel hedefli kontrolleri çalıştır. `.github/workflows/ci.yml`
   classifier'ın seçtiği frontend/backend/migration ve auth/seeded/visual
   kontrollerini uygular; her PR tüm E2E profillerini çalıştırmaz. Worker/image
   değişikliğinde opt-in `Modal image build` job'u (`MODAL_IMAGE_CHECK=true`)
   image'ları Modal `ci` environment'ında geçici app olarak build edip remote import
   smoke'u çalıştırır; deploy etmez.
2. İlgili PR kontrolleri ve inceleme tamamlanınca yetkili merge yapılır.
3. `.github/workflows/release.yml` her `main` push'unda `production-release`
   GitHub environment'ında çalışır ve kararlarını diff'ten değil production
   durumundan verir. İptal edilen veya başarısız bir run'ın işi sonraki run'da
   kaybolmaz.
4. Migration: `supabase db push --linked --dry-run` bekleyen migration gösterirse
   local reset/test/lint ve authority kontrolünden sonra apply edilir; ardından
   `upToDate` ve salt okunur `supabase db diff --linked --schema rag_lab` drift
   kontrolü yapılır. Bunlardan biri başarısızsa Modal adımı ilerlemez.
5. Modal: canlı Modal tag'i (son deploy edilen Git SHA) ile hedef SHA arasında
   backend/runtime değişikliği varsa (veya tag bilinmiyorsa) backend testlerinden
   sonra `main` environment'ına SHA tag'iyle rolling deploy, tag doğrulaması ve
   worker değiştiyse remote import smoke yapılır. API health/ready/auth koruma
   kontrolü her run'da çalışır.
6. Vercel production promotion'ı Vercel **Deployment Checks** ile bu job'un
   (`Production release`) başarısına bağlanır: Vercel build'i paralel yapsa da yeni
   frontend, migration ve Modal deploy'u bitmeden production domain'ine atanmaz.
   Bu ayar Vercel project settings'tedir; kapalıysa sıra garanti edilmez.
7. Docling prefetch, Karaman semantic smoke ve hosted full-RAG ayrı yetkili
   operasyonlardır; release workflow'u bunları otomatik çalıştırmaz. Model/cache
   değişikliği gerektirmedikçe her deploy'da prefetch yapmayın.
8. `.github/workflows/e2e-full.yml` yalnız manuel Heavy validation workflow'udur;
   schedule yoktur. Seeded/auth/visual profilleri düşük yetkili E2E secret'larıyla
   çalışır; `full-rag` yalnız `production-e2e` environment'ında, global tek koşu
   olarak ve kendi `E2E_RUN_ID` namespace'ini temizleyerek çalışır.
   `production-visual-update` referans PNG'lerini CI ile aynı Linux ortamında üretip
   değişen/yeni/orphan listesiyle artifact olarak verir. Deployment başarı kanıtı ile
   gerçek provider ve corpus sonucu ayrı raporlanır.

Supabase Dashboard repository integration kullanılmaz; migration authority
GitHub Actions + Supabase CLI'dır. Linked işlem için `SUPABASE_ACCESS_TOKEN` ve
`SUPABASE_PROJECT_REF`; Modal için `MODAL_TOKEN_ID` ve `MODAL_TOKEN_SECRET`
gerekir. Bu secret'lar repository seviyesinde değil `production-release`
environment'ındadır (deployment branch policy: `main`); service-role
`E2E_SUPABASE_SECRET_KEY` yalnız `production-e2e` environment'ındadır. Secret'lar
yalnız kullanan adımların env'ine verilir; secret gören job'larda `npm ci
--ignore-scripts` kullanılır. GitHub environment adları büyük/küçük harf duyarsız
olduğu için Vercel'in oluşturduğu `Production`/`Preview` environment'larıyla
çakışmayan adlar seçilmiştir. Secret değerleri çıktıya veya repository'ye yazılmaz.

Release komutu:
`modal deploy --env main --tag "$GITHUB_SHA" --strategy rolling backend/modal_app.py`.
Workflow Modal tag'ini doğrular. Manual full-RAG workflow'u sabit production URL'sini
kullanır; seçili Git ref ile canlı frontend/backend SHA'larının eşit olduğunu bu
koşudan çıkarmayın.

## Migration authority

Runtime ORM SQLAlchemy 2 olarak kalır; schema değişiklikleri yalnız şu akıştan
geçer:

```text
supabase/migrations/*.sql
        ↓
Supabase CLI
        ↓
Supabase PostgreSQL
```

Local komut akışı [supabase/AGENTS.md](../supabase/AGENTS.md), karar ve production
baseline [migrations.md](architecture/migrations.md) içindedir.
`supabase migration fetch --linked` remote history'yi yeniden oluşturmak
için kullanılabilir. Existing production baseline migration'ı remote'da tekrar
çalıştırılmaz; Supabase migration repair ile applied olarak işaretlenir.
Historical baseline yalnız boş/local environment rebuild'i içindir.

Manuel Modal işlemleri yalnız mevcut operasyon yetkisi kapsamında yapılır.
Repository root'unda temiz ve test edilmiş checkout için production komutu:

```powershell
$releaseSha = git rev-parse HEAD
backend\.venv\Scripts\modal.exe deploy --env main --tag $releaseSha --strategy rolling backend/modal_app.py
backend\.venv\Scripts\python.exe -c "import modal; print(modal.Function.from_name('rag-steplab-api', 'remote_import_smoke', environment_name='main').remote())"
```

Gerektiğinde ayrı yetkili model-cache hazırlığı:

```powershell
backend\.venv\Scripts\python.exe -c "import modal; modal.Function.from_name('rag-steplab-api', 'prefetch_docling_models', environment_name='main').remote()"
```

## Test ve production smoke

Aşağıdaki hosted smoke veri oluşturur ve provider maliyeti doğurabilir; sıradan
local test değildir. Authenticated API için dedicated kullanıcıya ait
`SMOKE_ACCESS_TOKEN` process environment'ta güvenli şekilde sağlanmalıdır;
token değeri komuta, loga veya belgeye yazılmaz. Hedef, PDF ve izin verilen veri
etkisini doğrulamadan çalıştırmayın. Script PDF'i `e2e-smoke-<run>.pdf` adıyla
yükler ve kendi oluşturduğu dokümanı koşu sonunda siler (bağlı run/dataset
kayıtları cascade ile gider); `SMOKE_KEEP_DATA=1` veriyi bırakır. SHA tekilleştirmesi
mevcut bir dokümanı döndürürse o doküman silinmez.

```powershell
backend\.venv\Scripts\python.exe -m pytest backend/tests
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

$env:SMOKE_API_URL = "https://<modal-api-domain>"
$env:SMOKE_FRONTEND_URL = "https://<vercel-production-domain>"
$env:SMOKE_PDF_PATH = "C:\path\to\karaman-operasyon-raporu.pdf"
$env:SMOKE_REQUIRE_PARSE = "1"
$env:SMOKE_REQUIRE_SEMANTIC = "1"
$env:SMOKE_REQUIRE_RAG = "1"
$env:SMOKE_QUERY = "BAT-S12 nedir? Kısa yanıtla."
$env:SMOKE_TIMEOUT_MS = "60000"
node scripts/smoke.mjs
```

Ek isteğe bağlı değişkenler: `SMOKE_PARSE_TIMEOUT_MS` (parse bekleme süresi,
varsayılan 900000) ve `SMOKE_REQUIRE_JUDGE=1` (evaluation'da judge'ı açar ve
judge modelinin raporlanmasını zorunlu kılar).

Semantic gate 8 sayfa, 9–11 tablo, 24–28 gerçek başlık, page provenance ve
`BAT-S12`, `INV-T17`, `12,84 GWh`, `%17,6`, `%25` marker'larını doğrular. Full
gate üç chunk stratejisi, embedding, dense/keyword/hybrid, rerank, context,
grounded generation/citations, evaluation, history ve lineage compatibility
zincirini yürütür. Production normalization sonucu tablo sayısı sıfırsa parse
`docling_tables_missing` ile failed olur; lightweight fallback çalıştırılmaz.
Raw PDF, prompt/context veya secret loglanmaz.

## Rollback

Modal revision hatasında `Production release` workflow'u `workflow_dispatch` ile
`ref` = önceki sağlıklı `main` commit SHA'sı verilerek çalıştırılır. Workflow
SHA'nın `main` geçmişinde olduğunu doğrular, migration ve drift adımlarını atlar
(rollback şemayı geri almaz), o SHA'yı ayrı checkout'tan test edip aynı SHA
tag'iyle deploy eder ve health kontrolünü yapar. `force_modal_deploy` aynı SHA'yı
yeniden deploy eder. Geri dönülen kodun mevcut şemayla çalıştığı (expand/contract)
önceden doğrulanmalıdır.

Frontend sorunu varsa Vercel'in önceki sağlıklı deployment'ı promote edilir
(Vercel dashboard "Instant Rollback" veya `vercel rollback <deployment-url>`).
Database migration downgrade yalnız yeni kod eski schema ile çalışamıyorsa ve
mevcut queued/running run kalmadığı doğrulandıktan sonra uygulanır. Supabase
project, schema veya Storage bucket yeniden oluşturulmaz.

## Legacy Render emergency recreation

Eski Render service decommission edilmiştir ve repository'de aktif Render
Blueprint/config tutulmaz. Yalnız Modal platformunun uzun süre tamamen
erişilemez olduğu bir acil durumda degraded parser geçici olarak geri getirilmek
istenirse pre-migration commit `b285edb6f218fa9351b7f7c8fe9db5b07e18ef9c`
ayrı bir emergency branch'te kullanılabilir.

Eski service profili: Python, Frankfurt, free plan, `backend` root directory,
`pip install -r requirements.txt` build, `uvicorn app.main:app --host 0.0.0.0
--port $PORT` start ve `/health` health check. `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, exact `CORS_ORIGINS` ve diğer runtime
değerleri yeni Render secret'ları olarak server-side girilmelidir; eski secret
değerleri bu repository'de tutulmaz.

Bu recreation full Docling doğruluğu sağlamayan eski lightweight yolu geri
getirir ve yalnız geçici service continuity seçeneğidir. Yeni service URL'si
Vercel'e verilmeden önce health, PDF limiti, Storage persistence ve browser smoke
geçmelidir. Normal rollback yolu önceki sağlıklı Modal/Vercel deployment'ıdır.
