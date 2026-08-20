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

Supabase schema, private Storage bucket, SQLAlchemy/Alembic lineage'ı ve RAG
pipeline aynı kalır. Browser yalnız FastAPI yüzeyiyle konuşur; Docling worker
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
| FastAPI ASGI | 0.5 | 1024 MiB | 300 s | 0 / 2 |
| Full Docling worker | 2.0 | 4096 MiB | 900 s | 0 / 1 |

Compute placement Modal default scheduler'a bırakılır. Yalnız API routing için
ölçülmüş bir ihtiyaç oluşursa `MODAL_API_ROUTING_REGION=eu-west` kullanılabilir;
worker/API compute region başlangıçta pinlenmez.

`docling==2.117.0` pinned'dir. Model artifact'ları
`rag-steplab-docling-models-v2` Volume içinde
`/models/docling/docling-2.117.0` yolunda kalıcıdır. Image, Modal 1.x source
packaging gereği `backend/app` paketini explicit ekler. Her deploy sonrasında
remote smoke `app.main`, `app.parser`, Docling sürümü ve artifact yolunu
doğrulamalıdır.

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
NEXT_PUBLIC_API_BASE_URL=https://<modal-api-domain>
```

Modal API ve worker secret'ları server-side Modal Secret olarak tutulur.
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY` ve
benzeri değerler browser'a, `NEXT_PUBLIC_*` değişkenlerine, source control'a,
smoke output'una veya loglara yazılmaz. CORS yalnız gerçek Vercel origin'lerini
exact içerir; wildcard kullanılmaz. PDF limiti 50 MiB'dir.

## Deploy sırası

1. Local backend/frontend test, lint, typecheck ve build.
2. Backward-compatible Alembic migration; revision ve mevcut history kontrolü.
3. Modal deploy ve Docling model prefetch.
4. Remote import, health ve Karaman semantic smoke.
5. Vercel Preview browser E2E ve full RAG smoke.
6. PR/CI green ve merge.
7. Merged SHA'nın Modal'a deploy edilmesi ve direct smoke tekrarı.
8. `NEXT_PUBLIC_API_BASE_URL` production güncellemesi ve Vercel redeploy.
9. Production browser E2E, full RAG smoke ve kısa health/log observation.

`main` branch'ine gelen her push'ta GitHub Actions önce frontend, backend ve
secret-hygiene kapılarını çalıştırır. Üçü de başarılı olursa aynı workflow
`modal deploy --env main --tag "$GITHUB_SHA" --strategy rolling backend/modal_app.py`
komutuyla test edilen commit'i production Modal App'e gönderir. GitHub
repository/environment secret'larında `MODAL_TOKEN_ID` ve
`MODAL_TOKEN_SECRET` bulunmalıdır. Modal deployment history içindeki tag,
Vercel production deployment SHA'sı ve GitHub commit SHA'sı aynı olmalıdır.

Modal deploy komutları:

```powershell
backend\.venv\Scripts\modal.exe deploy backend/modal_app.py
backend\.venv\Scripts\python.exe -c "import modal; modal.Function.from_name('rag-steplab-api', 'prefetch_docling_models').remote()"
backend\.venv\Scripts\python.exe -c "import modal; print(modal.Function.from_name('rag-steplab-api', 'remote_import_smoke').remote())"
```

## Test ve production smoke

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
grounded generation/citations, evaluation, history ve stale invalidation
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
