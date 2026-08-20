# RAG StepLab deployment

Bu proje için production akışı:

```text
Vercel Next.js → Render FastAPI/Docling → Supabase PostgreSQL + Storage → Gemini API
```

RAG StepLab auth veya multi-tenant bir SaaS değildir. İlk dağıtım düşük trafik, tek backend servisi ve synchronous FastAPI çalışması içindir. Redis, Celery, Kafka, Docker ve local PostgreSQL kullanılmaz.

## Mevcut cloud durumu

Connector ile 20 Ağustos 2026 tarihinde doğrulanan durum:

- Supabase `rag-steplab` oluşturuldu: project ref `dronqqospsuhnjjitqls`, region `eu-central-1`, status `ACTIVE_HEALTHY`, organization planı `free`.
- Supabase project maliyeti connector tarafından `0/month` döndü.
- `rag_lab` private schema oluşturuldu.
- `vector` extension etkin ve sürümü platform tarafından `0.8.2` olarak raporlandı. Extension sürümü migration/config içinde pinlenmez.
- `rag-documents` private Storage bucket oluşturuldu; yalnız `application/pdf`, 50 MiB object limiti.
- Supabase üzerinde dedicated `rag_steplab_app` login role ve session-pooler bağlantısı oluşturuldu; bağlantıdan yalnız `current_user` doğrulandı. Parola ve server key repository veya log’a yazılmadan Render secret environment değişkenlerine aktarıldı.
- Canonical Alembic migration `0001_rag_lab_initial` canlı projeye uygulandı. Tam 9 uygulama tablosu, `vector(768)`, generated `tsvector`, GIN index ve `rag_lab.alembic_version` doğrulandı; migration sonrası role geçici verilen database `CREATE` yetkisi geri alındı.
- Render hesabında tek workspace `My Workspace` (`tea-da31oh0u01pc738cheq0`) kullanıldı. `rag-steplab-api` (`srv-da3bcjtg1s2s73d855dg`) yalnız `Free` plan ve Frankfurt region ile oluşturuldu; public URL `https://rag-steplab-api.onrender.com`. GitHub App erişimi yalnız `ahmedhfz/rag-steplab` repository’siyle sınırlandırıldı. `feature/rag-pipeline` commit `469f05b` deploy’u canlıdır; `/health` ve PostgreSQL bağlantısını da sınayan `/ready` HTTP 200 döndürdü.
- Vercel team’de yeni `rag-steplab` projesi (`prj_0YyTu7GFkuDBOBCTYTPvpysLPZC5`) oluşturuldu ve `ahmedhfz/rag-steplab` GitHub repository’sine bağlandı; mevcut `lumimate-ai` projesine dokunulmadı.
- Vercel framework preset’i `Next.js`, root directory `.` olarak doğrulandı. `feature/rag-pipeline` sabit preview alias’ı `https://rag-steplab-git-feature-rag-pipeline-ahmed-hafizoglu-s-projects.vercel.app` olarak kullanılır. Preview branch ve production ortamlarında `NEXT_PUBLIC_API_BASE_URL=https://rag-steplab-api.onrender.com` tanımlandı. Yerel secret dosyalarının Vercel kaynak yüklemesine girmemesi `.vercelignore` ile ayrıca korunur.

Supabase bootstrap’i yalnız schema, vector extension ve private bucket kaynakları içindir. Uygulama tablolarının canonical migration sahibi `backend/alembic` olacaktır; repository’ye `supabase/migrations` ağacı eklenmemelidir. İlk migration `rag_lab` şeması ile `extensions.vector` hazır değilse bilinçli olarak başarısız olur; bu platform kaynaklarını uygulama migration’ı oluşturmaya çalışmaz.

## Render Blueprint

Root’taki `render.yaml` Frankfurt bölgesinde `rag-steplab-api` adlı Free Python web service tanımlar:

- service root: `backend`
- Python runtime: `3.13.0` (`PYTHON_VERSION` is explicit because the Blueprint root is `backend`)
- build: `pip install -r requirements.txt`
- start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- health check: `/health`
- deploy trigger: `checksPass`
- persistent disk, worker, cron ve Render Postgres yoktur.

Render edge TLS’i sonlandırır; uygulama yalnız `0.0.0.0:$PORT` dinler. Free instance cold-start ve Docling bellek/startup süresi gerçek PDF smoke testiyle doğrulanmalıdır. Bu risk çözülmeden paid plan seçilmemelidir.

## Environment contract

`.env.example` güvenli isim şablonudur. Render’da şu iki grup ayrıdır:

Public frontend:

```text
NEXT_PUBLIC_API_BASE_URL
```

Render-only server variables:

```text
DATABASE_URL
DATABASE_SCHEMA=rag_lab
SUPABASE_URL
SUPABASE_SECRET_KEY
SUPABASE_STORAGE_BUCKET=rag-documents
GEMINI_API_KEY
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
GEMINI_EMBEDDING_DIMENSIONS=768
GEMINI_GENERATION_MODEL=gemini-flash-lite-latest
GEMINI_RERANK_MODEL=gemini-flash-lite-latest
GEMINI_JUDGE_MODEL=gemini-flash-lite-latest
CORS_ORIGINS
CORS_ORIGIN_REGEX
WRITE_ENABLED=true
```

`SUPABASE_SECRET_KEY`, database URL/password ve Gemini key hiçbir `NEXT_PUBLIC_*` değişkenine yazılmaz. `CORS_ORIGINS` yalnız gerçek Vercel production/preview origin’lerini içermelidir; `*` kullanılmaz. Backend’in canonical concurrency değişkeni `MAX_CONCURRENT_PIPELINE_RUNS`’tır.

Gemini model adları runtime environment yüzeyinden seçilir. Bu hedef için varsayılan alias’lar `gemini-embedding-2` ve `gemini-flash-lite-latest` (generation/rerank/judge), deploy öncesi güncel Google AI model dokümanından yeniden doğrulanmalıdır. Embedding vector uzunluğu `GEMINI_EMBEDDING_DIMENSIONS` ile runtime’da doğrulanır.

Supabase persistent Render backend için session pooler bağlantısı kullanılmalıdır. Transaction pooler prepared statement desteklemediği için SQLAlchemy runtime URL’si olarak seçilmez. Alembic migration için ayrı, güvenli bir migration connection string kullanılabilir.

## Safe deployment order

1. Backend/Alembic kodu ve migration’lar merge edildikten sonra GitHub CI kalite kapıları geçer.
2. Supabase’te extension/schema/bucket doğrulanır; Alembic `upgrade head` yalnız uygulama tablolarını uygular.
3. Render workspace `tea-da31oh0u01pc738cheq0` kullanılır; private GitHub repository erişimi sağlandıktan sonra Blueprint `render.yaml` yalnız Free plan ile apply edilir.
4. Render service oluşturulduktan sonra secret/config değerleri Dashboard’da girilir; gerçek key veya password repo’ya konmaz. Supabase DB credential’ı zaten dışarıda güvenli tutuluyor.
5. Render `/health` 200 kontrolü yapılır.
6. Vercel’de `rag-steplab` adı müsaitse GitHub repo root Next.js projesi bağlanır; isim çakışırsa `rag-steplab-ahmedhfz` kullanılır.
7. Vercel Preview URL’si Render `CORS_ORIGINS` içine eklenir ve yeni deployment başlatılır.
8. `node scripts/smoke.mjs` ile frontend/backend health, ardından `SMOKE_PDF_PATH` ile gerçek parse akışı doğrulanır.

## Smoke commands

Local dual-service development:

```powershell
npm run dev
node scripts/smoke.mjs
```

Gerçek PDF parse:

```powershell
$env:SMOKE_PDF_PATH = "C:\path\to\sample.pdf"
$env:SMOKE_REQUIRE_PARSE = "1"
node scripts/smoke.mjs
```

Full hosted RAG contract smoke (real PDF, persistence and configured Gemini/DB):

```powershell
$env:SMOKE_FRONTEND_URL = "https://<vercel-domain>"
$env:SMOKE_API_URL = "https://<render-domain>"
$env:SMOKE_PDF_PATH = "C:\path\to\sample.pdf"
$env:SMOKE_REQUIRE_RAG = "1"
node scripts/smoke.mjs
```

`SMOKE_REQUIRE_RAG=1` üç chunk stratejisini, embedding, dense/keyword/hybrid retrieval, reranking, context, generation, evaluation dataset/run, history ve aynı document üzerinde reparse sonrası stale lineage kontrolünü çalıştırır. `SMOKE_REQUIRE_JUDGE=1` ayrıca evaluation judge modelini çağırır; Gemini quota/cost sınırı nedeniyle varsayılan kapalıdır.

Hosted endpoints:

```powershell
$env:SMOKE_FRONTEND_URL = "https://<vercel-domain>"
$env:SMOKE_API_URL = "https://<render-domain>"
$env:SMOKE_PDF_PATH = "C:\path\to\sample.pdf"
$env:SMOKE_REQUIRE_PARSE = "1"
node scripts/smoke.mjs
```

Smoke script response body, token veya secret yazdırmaz; yalnız endpoint label/status, sayısal chunk/vector/element count ve test aşaması adını raporlar. Full smoke çalıştırılmadan önce Render’da secret/config env’leri ve Supabase session-pooler `DATABASE_URL` env yüzeyine bağlanmalıdır; credential değerleri bu dokümana eklenmez.

## Failure gates

- Render `/health` başarısızsa Vercel deployment’i tamamlanmış sayılmaz.
- CORS başarısızsa origin listesi exact URL’lerle düzeltilir; wildcard eklenmez.
- Supabase bağlantısı başarısızsa credential, pooler mode, region/DNS ve connection limitleri kontrol edilir.
- Gemini 401/403, quota, 429, timeout veya model-not-found durumlarında güvenli API error döndürülür; key loglanmaz.
- Docling timeout/memory nedeniyle Free Render deploy başarısızsa önce PDF boyutu, concurrency ve startup ölçülür; ücretli plan yalnız açık kullanıcı onayıyla değerlendirilir.
- Cloud kaynaklarının var olması uçtan uca RAG kanıtı değildir; gerçek PDF ile Storage → parse → persistence → downstream smoke zorunludur.

## Official references

- [Supabase Postgres connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase vector columns](https://supabase.com/docs/guides/ai/vector-columns)
- [Supabase Storage uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Render FastAPI deploy](https://render.com/docs/deploy-fastapi)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render health checks](https://render.com/docs/health-checks)
- [Vercel Git deployments](https://vercel.com/docs/git)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
