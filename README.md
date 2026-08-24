# RAG StepLab

RAG StepLab, Retrieval-Augmented Generation sistemlerini adım adım öğrenmek ve deneylerle incelemek için geliştirilen görsel, etkileşimli bir learning laboratory projesidir. Bir SaaS veya ürün prototipi değildir.

## Kimler için?

RAG'e yeni başlayan ve parsing'den generation'a kadar pipeline'ın her aşamasında ne olduğunu görmek isteyen geliştiriciler içindir.

## Burada ne öğrenilebilir?

- document ingestion, parsing ve chunking
- embeddings, indexing ve vector search
- retrieval, Top-K, hybrid search ve reranking
- context construction, generation, grounding ve citations
- retrieval ve answer evaluation
- tracing, karşılaştırma ve observability

Amaç yalnızca sonuç üretmek değil; kullanılan ayarların, ara çıktıların ve ölçümlerin sistem davranışını nasıl değiştirdiğini görünür kılmaktır.

## Mevcut durum

İlk uçtan uca, gerçek ve kalıcı learning pipeline hazırdır:

- PDF dosyası private Supabase Storage'a yüklenir; Docling çıktısı canonical normalized element olarak PostgreSQL'e yazılır.
- `fixed_token`, `recursive_token` ve `structure_aware` chunking gerçek provenance ile çalışır.
- Gemini Embedding 2 vektörleri pgvector'da saklanır; dense, PostgreSQL FTS keyword ve RRF hybrid retrieval kullanılabilir.
- Optional Gemini reranking, görünür context construction, grounded generation ve backend-doğrulamalı citations çalışır.
- Golden evaluation dataset'leri Hit@K, Recall@K, Precision@K, MRR, citation validity ve groundedness ölçümleri üretir.
- Parse/chunk/embedding/experiment geçmişi yenilemeden sonra geri yüklenir; reparse ve rechunk eski downstream run'ları stale yapar.

Uygulama sahte doküman, chunk, skor, cevap veya evaluation metriği göstermez. Auth ve multi-tenancy bilinçli olarak kapsam dışıdır; kişisel veya hassas PDF'ler public deployment'a yüklenmemelidir.

## Backend

Backend `backend/` altında FastAPI, Docling, SQLAlchemy 2 ve psycopg 3 kullanır. PostgreSQL şema değişikliklerinin tek kaynağı Supabase CLI migration'larıdır. Kurulum ve migration adımları için [backend/README.md](backend/README.md) dosyasına bakın.

```text
PDF → Supabase Storage → HTTP 202/queued → Modal API → Modal worker/Docling
    → persisted parse → Chunk → Embed → Retrieve → Rerank → Context → Generate → Evaluate
```

Parse artık uzun süren bir synchronous HTTP isteği değildir. `POST /documents/parse`
dosyayı Storage'a alıp `202` ve `parseRunId` döndürür; frontend parse run'ı
`queued → running → completed/failed` durumlarıyla izler. Geçici ağ kesintisi
polling'i bozmaz ve worker'ın iç `interrupted` durumu API'de `failed` +
`error.code=parse_interrupted` olarak görünür. Başarısız veya tamamlanmamış bir
run için sahte özet, ilerleme yüzdesi veya downstream veri gösterilmez.

Backend virtual environment ve `.env` hazırlandıktan sonra proje kökünde tek komut yeterlidir:

```powershell
npm run dev
```

Bu komut Next.js'i `http://localhost:3000`, FastAPI'yi `http://127.0.0.1:8000` üzerinde birlikte başlatır. Yalnız frontend gerektiğinde `npm run dev:frontend` kullanılabilir.

Supabase → Modal → Vercel production mimarisi, async parse sözleşmesi, kaynak
profili ve full RAG smoke adımları için
[deployment dokümantasyonuna](docs/deployment.md) bakın.

## Database migrations

```text
Schema changes → supabase/migrations/*.sql → Supabase CLI → Supabase PostgreSQL
FastAPI runtime → SQLAlchemy 2 → psycopg 3 → Supabase PostgreSQL
```

Yeni migration yalnızca Supabase CLI ile oluşturulur:

```powershell
supabase migration new <descriptive_name>
```

Local migration rebuild için Docker üzerinde Supabase stack kullanılabilir:

```powershell
supabase start
supabase db reset --local --no-seed
```

Production migration uygulaması yalnız GitHub Actions'ın Supabase CLI job'ı
üzerinden yapılır. DB password, service key veya access token repository'ye
yazılmaz; CLI link bilgisi çalışma anında sağlanır.

## Modal deployment

Production parser, lightweight text-layer heuristic yerine tam
`DocumentConverter` kullanır. Modal API ASGI katmanı Storage ve veritabanı
lineage'ını yönetir; Modal worker scale-to-zero profiliyle parse işini yürütür.
Başlangıç benchmark profili worker için `CPU 2 / 4096 MiB / timeout 900 s`, API
için yaklaşık `CPU 0.5 / 1024 MiB`'dir. Docling modelleri versioned bir Modal
Volume'da cache'lenir; cold start'ta tekrar internetten indirilmez.

Production değişiklikleri semantic ve full RAG smoke geçmeden başarılı ilan
edilmez. Local sözleşme ve semantic smoke için:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
$env:SMOKE_REQUIRE_PARSE = "1"
$env:SMOKE_REQUIRE_SEMANTIC = "1"
$env:SMOKE_PDF_PATH = "C:\path\to\karaman-operasyon-raporu.pdf"
node scripts/smoke.mjs
```

## Playwright E2E

E2E katmanı iki bilinçli profile ayrılır:

- `npm run e2e:smoke`: gerçek dedicated Supabase auth + deterministic seeded RAG API. PR gate'idir; production RAG verisi yazmaz.
- `npm run e2e:full`: gerçek hosted RAG zinciri. Tek worker ile scheduled/manual çalışır ve yalnız `e2e-` namespace'indeki test verisini temizler.

İlk yerel kurulum:

```powershell
npm ci
npx playwright install chromium
npm run e2e:bootstrap
npm run e2e:smoke
```

`e2e:bootstrap`, authenticated Supabase CLI üzerinden dedicated test kullanıcısını idempotent hazırlar ve değerleri yalnız ignored `.env.e2e.local` dosyasına yazar. CI için aynı değerler `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` ve `E2E_SUPABASE_SECRET_KEY` secret'larıdır. Protected Vercel Preview erişimi `VERCEL_AUTOMATION_BYPASS_SECRET` ile kurulur; secret browser URL'sine veya trace'e yazılmaz. Storage state `output/playwright/.auth/` altında üretilir ve version control'e girmez.

Faydalı komutlar:

```powershell
npm run e2e:auth
npm run e2e:headed
npm run e2e:report
npm run e2e:fixture
```

Fast fixture iki sayfalı küçük bir sentetik PDF'tir ve `ORBIT-731` marker'ı, heading, liste, tablo, page provenance ve citation akışını sabit tutar. Failure halinde HTML report, trace, screenshot ve video `output/playwright/` altında bulunur.

Gerçek full koşuyu yerelde yalnız açık production cleanup kilidiyle başlatın:

```powershell
$env:E2E_TARGET = "production"
$env:E2E_ALLOW_PRODUCTION_CLEANUP = "true"
$env:E2E_BASE_URL = "https://<production-host>"
$env:E2E_API_BASE_URL = "https://<production-api-host>"
npm run e2e:cleanup
npm run e2e:full
npm run e2e:cleanup
```

Cleanup; dedicated test-account marker'ı, owner user ID ve `e2e-` filename prefix'i dışındaki hiçbir kayda dokunmaz. CI karar tablosu ve yeni flow kuralları `AGENTS.md` içindedir.

## Learning roadmap

1. RAG fundamentals
2. Ingestion, parsing ve chunking
3. Embeddings ve vector search
4. Retrieval experiments
5. Hybrid retrieval ve reranking
6. Context construction, generation ve citations
7. Evaluation ve comparison
8. Tracing ve observability
9. Advanced RAG experiments

Detaylı proje bağlamı ve çalışma ilkeleri `AGENTS.md` içindedir.
