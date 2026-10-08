# RAG StepLab

RAG StepLab, Retrieval-Augmented Generation sistemlerini adım adım öğrenmek ve deneylerle incelemek için geliştirilen görsel, etkileşimli bir developer tool'dur. Public beta olarak paylaşılabilir; amacı genel amaçlı bir PDF sohbet ürünü olmak değil, RAG kararlarını ve kanıtlarını görünür kılmaktır.

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

## İlk deneme

1. Giriş yapın ve Overview'da **Örnek PDF ile dene** seçeneğini kullanın veya kendi PDF'nizi ekleyin.
2. Seçili dokümanı **Parse → Chunking → Embeddings** aşamalarında işleyin. Her aşamada gerçek çıktı ve geçmişi inceleyin; **Continue** yalnızca uyumlu çıktı hazırsa görünür.
3. **Playground**'da soru sorun; retrieval, reranking, context, generation ve citation adımlarını ayrı ayrı görün. Cevaptaki kaynakları **Source Inspector** ile PDF ve çıkarılmış metin üzerinde kontrol edin.
4. İsterseniz **Evaluation**'da kendi sorularınızı ve beklenen kaynakları içeren bir dataset oluşturup sonuçları karşılaştırın.

TR/EN için depoda dört sayfalık, seçilebilir metin içeren kurgusal kent bisikleti PDF'leri bulunur (`public/samples/`). Örnek sorular yalnızca bu dosyalardan biri gerçekten seçiliyken gösterilir; örnek düğmesi sahte parse, chunk veya cevap üretmez. PDF hesaba eklendikten sonra normal özel depolama ve gerçek pipeline kullanılır. Kendi PDF'nizi yüklemeden önce paylaşım ve gizlilik koşullarını gözden geçirin; hassas belgeleri public beta'da kullanmayın. Parse ve sonraki provider aşamaları servis erişimi gerektirir ve kullanım maliyeti doğurabilir.

Örnek PDF'ler başlık, paragraf, liste, küçük tablo ve tarih/sayı içerir; önerilen sorular yalnız UI'da bulunur. SHA-256 eşleşmesi dosya adından bağımsızdır. Üretim için Python 3.13 ve sabitlenmiş bağımlılıkları kullanın:

```bash
python -m pip install -r scripts/requirements-samples.txt
python scripts/generate-sample-documents.py
python scripts/generate-sample-documents.py --check
python scripts/test_sample_documents.py
```

Bağımlılıkları bir virtual environment'a kurmanız önerilir. Generator, depoda lisansıyla bulunan Lato fontlarını (`scripts/sample-fonts/`, SIL OFL 1.1) ve sabit PDF metadata'sını kullanır; işletim sistemindeki fontlara ihtiyaç duymaz. `--check` taze üretimi committed PDF'lerle byte düzeyinde karşılaştırır. İçerik değiştiğinde `lib/sample-documents.ts` SHA-256 değerlerini de güncelleyin; Vitest shipped dosyaların bu değerlerle eşleşmesini doğrular.

## Mevcut durum

İlk uçtan uca, gerçek ve kalıcı learning pipeline hazırdır:

- PDF dosyası private Supabase Storage'a yüklenir; Docling çıktısı canonical normalized element olarak PostgreSQL'e yazılır.
- `fixed_token`, `recursive_token` ve `structure_aware` chunking gerçek provenance ile çalışır.
- Gemini Embedding 2 vektörleri pgvector'da saklanır; dense, PostgreSQL FTS keyword ve RRF hybrid retrieval kullanılabilir.
- Optional Gemini reranking, görünür context construction, grounded generation ve backend-doğrulamalı citations çalışır.
- Golden evaluation dataset'leri Hit@K, Recall@K, Precision@K, MRR, citation validity ve groundedness ölçümleri üretir.
- Parse/chunk/embedding/experiment geçmişi yenilemeden sonra geri yüklenir; reparse ve rechunk eski downstream run'ları stale yapar.
- Ağır provider/parse işleri kullanıcı başına durable tek-aktif-run admission'ıyla
  korunur; benchmark evaluation public kullanımda varsayılan kapalıdır.
- Doküman silme private Storage object'ini transaction-backed cleanup outbox ile
  eventually ve idempotent biçimde temizler; retry yalnız mutasyonlarda çalışır,
  doküman listeleme GET'i read-only kalır.

Uygulama sahte doküman, chunk, skor, cevap veya evaluation metriği göstermez. Authenticated Supabase oturumları ve kullanıcı sahipliğiyle persistence izole edilir; retrieved metin prompt talimatı değil güvenilmeyen veri kabul edilir. Kişisel veya hassas PDF'ler public deployment'a yüklenmemelidir.

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

Bu komut Next.js'i `http://localhost:3000` üzerinde başlatır. `.env` hosted bir
`NEXT_PUBLIC_API_BASE_URL` içeriyorsa istekler local same-origin proxy üzerinden
kalıcı API'ye gider; local API seçilmişse FastAPI de `http://127.0.0.1:8000`
üzerinde birlikte başlatılır. Yalnız frontend gerektiğinde `npm run dev:frontend`
kullanılabilir.

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
edilmez. Bu kalite beklentisi otomatik release'in tüm zinciri çalıştırdığı
anlamına gelmez; otomatik/manual ayrımı `docs/deployment.md` içindedir.
Local kontroller ve ayrı yetkili semantic smoke örneği:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
# Hosted API: hedef URL'leri ve dedicated SMOKE_ACCESS_TOKEN güvenli process env ile sağlanır.
# Sonraki smoke veri oluşturabilir ve provider maliyeti doğurabilir.
$env:SMOKE_REQUIRE_PARSE = "1"
$env:SMOKE_REQUIRE_SEMANTIC = "1"
$env:SMOKE_PDF_PATH = "C:\path\to\karaman-operasyon-raporu.pdf"
node scripts/smoke.mjs
```

## Playwright E2E

E2E profilleri `package.json` ve `playwright.config.ts` içinde tanımlıdır:

- `npm run e2e:smoke`: tam deterministic seeded RAG suite; dedicated gerçek auth
  kullanır fakat production RAG verisi yazmaz.
- `npm run e2e:critical`: seeded suite'in kritik alt kümesi; classifier seçtiğinde
  PR CI'da çalışır. Her PR tam `e2e:smoke` koşmaz.
- `npm run e2e:auth`: gerçek auth akışları; auth-sensitive değişikliklerde seçilir.
- `npm run e2e:visual:production`: gerçek React route/bileşenleri ve seeded API ile
  görsel/geometri doğrulaması; canlı provider kanıtı değildir.
- `npm run e2e:full`: tek worker ile gerçek hosted RAG zinciri; manuel Heavy
  validation workflow'unda çalışır, schedule yoktur. Önce/sonra cleanup ayrı
  komuttur ve yalnız dedicated kullanıcının `e2e-` namespace'ini temizler.

Profil/hedef seçimi için `.agents/skills/rag-e2e-validation/SKILL.md` kullanılır.

İlk yerel kurulum (bootstrap hosted dedicated kullanıcı oluşturabilir/güncelleyebilir;
hedef ve işlem yetkisini önceden doğrulayın):

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

Fast E2E fixture iki sayfalı küçük bir sentetik PDF'tir ve `ORBIT-731` marker'ı, heading, liste, tablo, page provenance ve citation akışını sabit tutar. Bu test fixture'ı kullanıcıya sunulan dört sayfalık örnek PDF'lerden ayrıdır. Failure halinde HTML report, trace, screenshot ve video `output/playwright/` altında bulunur.

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

Cleanup; dedicated test-account marker'ı, owner user ID ve `e2e-` filename prefix'i dışındaki hiçbir kayda dokunmaz. CI seçiminin kaynağı `.github/scripts/classify-changes.mjs` ve workflow
dosyalarıdır; güvenlik sınırları `AGENTS.md` içindedir.

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
