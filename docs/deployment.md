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

## Async parse contract

```text
POST /documents/parse (multipart PDF)
    → Storage upload + document + queued run
    → HTTP 202 { documentId, parseRunId, status: "queued" }
    → GET /parse-runs/{parseRunId}
    → queued → running → completed | failed
```

Persisted source için `POST /documents/{documentId}/parse` aynı lifecycle'ı
kullanır. `completed` yanıtı normalized structured content, Markdown, summary
ve provenance içerir. Database'de internal `interrupted` tutulsa bile public
API ve frontend bunu `failed` + `error.code = parse_interrupted` olarak gösterir.
Public `interrupted` state yoktur.

Frontend 2 saniyede bir poll eder. Browser 15 dakika sonunda gerçek run'ı
failed yapmadan takibi durdurur; refresh durable polling'i sürdürür. Transient
network/5xx/408/429 hataları run'ı failed yapmaz. queued/running sırasında
ikinci submit hem UI hem database unique inflight guard ile engellenir. Fake
answer veya score üretilmez. Progress yüzdesinin backend checkpoint'leri
authoritative'dir; UI iki checkpoint arasında yalnız açıkça `estimated` olarak
işaretlenen ve bir sonraki checkpoint'i geçmeyen görsel ilerleme gösterebilir.

## Modal App

Tek `rag-steplab-api` Modal App iki farklı compute profili kullanır:

| Bileşen | CPU | Bellek | Timeout | Min/Max |
| --- | ---: | ---: | ---: | ---: |
| FastAPI ASGI (`api_eu`) | 0.5 | 1024 MiB | 300 s | 1 / 2 |
| Full Docling worker | 2.0 | 4096 MiB | 900 s | 0 / 1 |

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
yoktur. Runtime pin'leri `requirements-worker.txt` içindedir. Bu değişiklik
henüz deploy edildiği anlamına gelmez; yeni worker image + yetkili hosted parse
doğrulaması ayrı release adımıdır.

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
koşulunda `https://vercel.live` eklenir. PDF önizleme için blob frame korunur.
HSTS uygulama tarafından tekrar
üretilmez: production TLS/HSTS davranışı Vercel edge katmanının sorumluluğudur
ve release smoke'ta response header olarak ayrıca doğrulanmalıdır.

CI, production npm dependency audit'i ile worker/base ve CI Python requirement
audit'lerini çalıştırır. Dependabot npm, pip ve GitHub Actions için haftalık,
bounded PR üretir. Repository private ve GitHub Code Scanning etkin olmadığı
için bu değişiklik CodeQL workflow'u eklemez; ücretsiz uygunluk doğrulanmadan
Advanced Security gerektiren bir gate zorunlu kılınmaz.

## Deploy sırası ve gerçek otomatik kapılar

1. PR'da değişikliğe göre yerel hedefli kontrolleri çalıştır. `.github/workflows/ci.yml`
   classifier'ın seçtiği frontend/backend/migration ve auth/critical/visual
   kontrollerini uygular; her PR tüm E2E profillerini çalıştırmaz.
2. İlgili PR kontrolleri ve inceleme tamamlanınca yetkili merge yapılır.
3. `.github/workflows/release.yml`, yalnız `main` üzerinde `backend/app/**`,
   `backend/modal_app.py`, runtime/worker requirements veya `supabase/migrations/**`
   değiştiğinde tetiklenir. Her main push'u için genel frontend release kapısı değildir.
4. Release secret hygiene kontrolü yapar. Classifier `modal_deploy=true` ise hafif
   backend bağımlılıklarıyla backend testleri çalışır. `migration=true` ise local
   reset/test/lint ve authority kontrolünden sonra linked migration dry-run/apply
   ve `upToDate` doğrulaması yapılır. Migration başarısızsa aynı job'ın sonraki
   Modal adımı ilerlemez; Vercel deployment'ı bu job tarafından yönetilmez.
5. `modal_deploy=true` ise `main` environment'ına Git SHA tag'iyle rolling deploy,
   tag doğrulaması ve API health/ready/auth koruma kontrolleri yapılır.
   `worker_provider=true` ise ayrıca remote import smoke çalışır.
6. Docling prefetch, Karaman semantic smoke ve hosted full-RAG ayrı yetkili
   operasyonlardır; release workflow'u bunları otomatik çalıştırmaz. Model/cache
   değişikliği gerektirmedikçe her deploy'da prefetch yapmayın.
7. Vercel rollout/cutover ve production browser/full-RAG doğrulamasını ayrıca
   planlayın. Mevcut `.github/workflows/e2e-full.yml` yalnız manuel Heavy validation
   workflow'udur; schedule yoktur. Deployment başarı kanıtı ile gerçek provider
   ve corpus sonucu ayrı raporlanır.

Supabase Dashboard repository integration kullanılmaz; migration authority
GitHub Actions + Supabase CLI'dır. Linked işlem için `SUPABASE_ACCESS_TOKEN` ve
`SUPABASE_PROJECT_REF`; Modal için `MODAL_TOKEN_ID` ve `MODAL_TOKEN_SECRET`
gerekir. Secret değerleri çıktıya veya repository'ye yazılmaz.

Release komutu:
`modal deploy --env main --tag "$GITHUB_SHA" --strategy rolling backend/modal_app.py`.
Workflow Modal tag'ini doğrular; Vercel SHA eşleşmesini garanti etmez. Uçtan uca
release doğrulaması istendiğinde Vercel deployment SHA'sını ayrıca kontrol edin.
Manual full-RAG workflow'u sabit production URL'sini kullanır; seçili Git ref ile
canlı frontend/backend SHA'larının eşit olduğunu bu koşudan çıkarmayın.

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

Yeni migration üretmek için repository root'unda
`supabase migration new <descriptive_name>` kullanılır.
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
etkisini doğrulamadan çalıştırmayın. Script'in ürettiği kayıtların temizliğini
ayrı kapsamlandırın; E2E cleanup'ın her smoke verisini sildiğini varsaymayın.

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

Semantic gate 8 sayfa, 9–11 tablo, 24–28 gerçek başlık, page provenance ve
`BAT-S12`, `INV-T17`, `12,84 GWh`, `%17,6`, `%25` marker'larını doğrular. Full
gate üç chunk stratejisi, embedding, dense/keyword/hybrid-RRF, rerank, context,
grounded generation/citations, evaluation, history ve lineage compatibility
zincirini yürütür. Production normalization sonucu tablo sayısı sıfırsa parse
`docling_tables_missing` ile failed olur; lightweight fallback çalıştırılmaz.
Raw PDF, prompt/context veya secret loglanmaz.

## Rollback

Modal revision hatasında önceki sağlıklı Modal deployment yeniden deploy
edilir. Frontend sorunu varsa Vercel'in önceki sağlıklı deployment'ı promote
edilir. Database migration downgrade yalnız yeni kod eski schema ile
çalışamıyorsa ve mevcut queued/running run kalmadığı doğrulandıktan sonra
uygulanır. Supabase project, schema veya Storage bucket yeniden oluşturulmaz.

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
