# RAG StepLab — Project Context

## Project Purpose

RAG StepLab, Retrieval-Augmented Generation öğrenmek isteyen kişiler için geliştirilen görsel ve etkileşimli bir **educational developer tool / RAG learning laboratory** projesidir.

Bu repository'nin ana amacı bir SaaS, enterprise product veya production uygulaması geliştirmek değildir. Amaç; RAG sisteminin parsing, chunking, embedding, indexing, retrieval, reranking, context construction, generation, citation ve evaluation aşamalarını anlaşılır, incelenebilir ve deney yapılabilir hâle getirmektir.

Kullanıcılar zamanla:

- RAG akışını adım adım görsel olarak takip edebilmeli,
- farklı ayar ve modelleri kontrollü biçimde deneyebilmeli,
- sonuçları ölçüp karşılaştırabilmeli,
- retrieval ve generation davranışının neden değiştiğini inceleyebilmeli,
- sistemin her aşamada hangi input'u alıp hangi output'u ürettiğini görebilmelidir.

Auth, billing, multi-tenancy, müşteri kurulumu, enterprise deployment veya action-taking agent özellikleri bu repository'nin learning roadmap'inin parçası değildir. Yeni bir çalışma, yalnızca RAG öğrenme ve deney hedeflerine somut katkı sağlıyorsa kapsama alınmalıdır.

## Current State

```text
Phase 1–7 — First Complete Learning Pipeline
Status: Persistent Document → Parse → Chunk → Retrieve → Generate → Evaluate flow ready
```

Şu anda:

- Next.js tabanlı frontend learning UI hazırdır.
- Overview / Pipeline ekranı vardır.
- Documents / Chunks ekranı vardır.
- Retrieval Playground ekranı vardır.
- Evaluation ve Settings ekranları vardır.
- Gerçek veri bulunmayan alanlar sahte sonuç üretmeden empty state gösterir.
- Lokal PDF seçimi, drag-and-drop, dosya tipi ve boyut doğrulaması frontend seviyesinde çalışır; Parse Document seçildiğinde PDF FastAPI backend'ine gönderilir.
- İngilizce / Türkçe arayüz ve frontend öğrenme tercihleri tarayıcıda lokal olarak saklanır.
- `POST /documents/parse`, PDF'i Docling ile parse eder ve normalized structured, Markdown, JSON ve summary response döndürür.
- PDF, private Supabase Storage'da; parse/chunk/embedding/experiment/evaluation lineage'ı PostgreSQL'de kalıcıdır.
- Üç gerçek chunking stratejisi, Gemini Embedding 2 + pgvector, PostgreSQL FTS, RRF hybrid retrieval ve optional Gemini reranking çalışır.
- Context construction, grounded generation, backend-doğrulamalı citations ve ölçülebilir evaluation sonuçları UI'da görünürdür.
- Refresh persistence ile reparse/rechunk stale invalidation davranışı uygulanmıştır.

Henüz:

- auth, billing ve multi-tenancy yoktur; bunlar learning roadmap'inin parçası değildir,
- yüksek trafik için ayrı bir queue/worker ölçekleme katmanı yoktur; parse ve experiment/evaluation run'ları kalıcı async state ve Modal worker lifecycle'ı ile çalışır,
- ANN/HNSW, semantic/parent-child chunking ve advanced RAG experiment'leri henüz yoktur,
- kapsamlı tracing/telemetry persistence henüz yoktur.

Hiçbir aşama fake processing, fake score veya fake answer çalıştırmamalıdır. Gerekli aktif upstream lineage yoksa aksiyon açıkça disabled olmalı ve neden kullanılamadığı kullanıcıya gösterilmelidir.

## Learning Roadmap

Roadmap ürün fazları değil, birbirini destekleyen öğrenme ve deney alanlarıdır:

1. **RAG fundamentals:** Temel pipeline, veri akışı, grounding ve retrieval-generation ilişkisi.
2. **Ingestion / parsing / chunking:** Doküman alma, yapısal parsing, chunk size, overlap ve chunk kalite analizi.
3. **Embeddings / vector search:** Vector representation, indexing, similarity ölçümleri ve dense search.
4. **Retrieval experiments:** Top-K, metadata filtering, query varyasyonları ve retrieval sonuçlarının karşılaştırılması.
5. **Hybrid retrieval / reranking:** Sparse retrieval, BM25, hybrid search, fusion yöntemleri ve reranker deneyleri.
6. **Context construction / generation / citations:** Context seçimi ve sıralaması, LLM generation, grounding ve kaynak gösterimi.
7. **Evaluation and comparison:** Golden datasets, Recall@K, Precision@K, MRR, answer quality ve faithfulness karşılaştırmaları.
8. **Tracing / observability:** Pipeline adımlarını, süreleri, input/output'ları, token kullanımını ve hataları görünür kılma.
9. **Advanced RAG experiments:** Parent-child retrieval, query rewriting, gelişmiş chunking ve benzeri teknikleri ölçülebilir deneylerle ekleme.

Her aşamada önce en basit çalışan mekanizma kurulmalı; yeni teknikler ölçüm veya öğrenme ihtiyacı doğrulandığında eklenmelidir.

## Technology Direction

Mevcut frontend:

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
```

Gerçek RAG pipeline teknoloji yönü:

```text
Python
FastAPI
PostgreSQL
pgvector
Docling
Gemini API / Google GenAI SDK
pytest
```

Backend ve RAG teknolojileri ilk complete pipeline için kurulmuştur. Yeni dependency veya servis yalnız bu laboratuvarda hangi öğrenme veya deney problemini çözdüğü açıklanabiliyorsa eklenmelidir.

## Architecture Direction

Genel öğrenme mimarisi:

```text
Learning UI
    ↓
FastAPI
    ↓
RAG Core
    ↓
PostgreSQL + pgvector
```

RAG Core şu sorumlulukları açık ve incelenebilir biçimde barındırır:

- ingestion ve parsing
- chunking
- embeddings ve indexing
- retrieval ve reranking
- context construction
- generation ve citations
- evaluation ve tracing

UI yalnızca sonuç ekranı olmamalıdır; mümkün olduğunca ara adımları, kullanılan ayarları, üretilen verileri ve ölçümleri görünür kılmalıdır. RAG Core, UI ve infrastructure detaylarından makul ölçüde ayrılmalı; ancak gerçek ihtiyaç oluşmadan generic factory, provider manager veya universal adapter gibi katmanlar oluşturulmamalıdır.

## Engineering Principles

- Her task öncesinde mevcut proje yapısını ve ilgili dosyaları incele.
- Kullanıcının verdiği scope dışına çıkma.
- Öğrenilebilirlik, açıklık ve teknik doğruluğu önceliklendir.
- Önemli RAG mekanizmalarını gereksiz framework abstraction'ları arkasında gizleme.
- UI'da pipeline'ın iç işleyişini, ara sonuçlarını ve kullanılan ayarları mümkün olduğunca görünür hâle getir.
- Her teknik özellik için “Hangi problemi çözüyor?” sorusunun net bir cevabı olmasını bekle.
- Retrieval ve generation davranışını ölçülebilir, karşılaştırılabilir ve regression testlerine uygun tasarla.
- Mock ile gerçek implementation'ı isimlendirme, yapı, davranış ve dokümantasyonda açıkça ayır.
- Minimal scope'u koru; premature abstraction ve architecture expansion yapma.
- Gereksiz refactor veya kullanılmayan dependency ekleme.
- Kod okunabilirliğini clever abstraction'lardan önde tut.
- Yeni bir model, dependency veya framework'ü yalnızca popüler ya da industry standard olduğu için ekleme.
- RAG Core ile application ve infrastructure sorumluluklarını gereksiz biçimde karıştırma.
- Alternatifleri ve trade-off'ları gerektiğinde açıkça belirt.
- Kullanıcının önerdiği yaklaşım teknik olarak zayıf, riskli veya gereksiz karmaşıksa sessizce uygulama; nedenini açıkla ve daha iyi yaklaşımı öner.
- Değişiklik sonrası kapsama uygun test, lint, typecheck veya build kontrollerini çalıştır.
- Secret, kişisel veri, raw document content ve hassas log verilerini güvenli şekilde ele al.

## Debugging ve Deployment Disiplini

- Production ilk debug ortamı değildir. Tercih edilen sıra: kod/log inceleme → local → test → Preview → production smoke.
- Bir hipotez kanıtlanmadan root cause olarak kabul edilmez; her aşamada gözlenebilir evidence kaydedilir.
- Her küçük debug bulgusu için yeni PR, CI ve production deploy döngüsü başlatılmaz. Geçici diagnostic sinyalleri mümkün olduğunca tek seferde toplanır.
- Production deploy esas olarak final validation için kullanılır.
- External integration hatalarında sınırlar sırayla izole edilir: provider → callback → token/session exchange → application state.
- Bir layer PASS olarak kanıtlandıysa yeni evidence olmadıkça tekrar tekrar değiştirilmez.
- Secret, token, authorization code, verifier, raw cookie veya benzeri hassas değerler loglanmaz.
- Temporary debug code iş bitince kaldırılır.
- Değişikliğin etkilediği sistemler birlikte değerlendirilir; frontend-only değişiklik için gereksiz database veya Modal deploy çalıştırılmaz.
- Cross-cutting, security veya deployment değişikliklerinde gerektiğinde full validation çalıştırılır.
- PR kapandıktan ve ilgili worktree artık gerekmiyorsa güvenli biçimde kaldırılır; ardından `origin/main` fetch edilir ve local `main` yalnız fast-forward ile `origin/main` ile hizalanır. Birleşmemiş değişiklikler silinmez.

## Testing / E2E / Playwright

- UI veya kullanıcı akışı değiştiren task'larda Playwright kapsamını açıkça değerlendir; kritik akış değiştiyse ilgili E2E assertion'ını aynı PR'da güncelle.
- Fast E2E, gerçek dedicated Supabase auth kullanır; RAG API cevapları deterministic seeded contract ile tarayıcıda izole edilir. Seeded suite production RAG verisi yazmamalıdır.
- Full RAG E2E, gerçek hosted frontend → FastAPI/Modal → Supabase → Gemini zincirini tek worker ile çalıştırır. Yalnız schedule, manuel workflow veya release öncesi doğrulamada kullanılır.
- Login her testte tekrarlanmaz. `auth-setup`, dedicated E2E kullanıcıyla oturum açar ve ignored `output/playwright/.auth/user.json` storage state üretir.
- Secret, access token, storage state ve gerçek kullanıcı verisi loglanmaz veya artifact'e eklenmez. E2E kullanıcısı yalnız server-side admin key ile idempotent oluşturulur.
- Fixture küçük, deterministik ve sentetik olmalıdır. Marker, sayfa, heading/list/table ve citation beklentileri sabit tutulur; OCR veya büyük gerçek doküman fast suite'e eklenmez.
- Her browser testi kritik backend response'unu, görünür sonucu ve gereken akışlarda reload persistence'ı doğrular. Sadece sayfanın render olması başarı sayılmaz.
- Console error, page error ve beklenmeyen failed request test hatasıdır. Trace ilk retry'da; screenshot/video yalnız failure'da tutulur.
- Production cleanup yalnız dedicated test-account marker'ı, `e2e-` filename namespace'i, owner user ID filtresi ve açık `E2E_ALLOW_PRODUCTION_CLEANUP=true` kilidi birlikte sağlanırsa çalışır.

| Değişiklik | Zorunlu doğrulama |
| --- | --- |
| Docs-only | E2E yok; ilgili lint/build gereksinimi classifier belirler |
| UI, auth veya frontend API contract | Seeded fast E2E; auth değiştiyse auth suite |
| Backend/RAG contract | Backend testleri + seeded fast E2E |
| Migration | Migration validation + backend testleri + seeded fast E2E |
| Modal/deploy/release kritik akış | Önce fast E2E, sonra gerçek full RAG E2E |

Yeni kritik UI flow'u, önce en küçük deterministic fast assertion ile korunur. Gerçek provider davranışı ancak seeded contractın kanıtlayamayacağı entegrasyon sınırı için full suite'e eklenir.

## Learning Principle

Yeni bir RAG kavramı veya teknik özellik eklendiğinde mümkün olduğunca şu sorular cevaplanabilmelidir:

1. Bu kavram nedir?
2. Hangi problemi çözüyor?
3. Sistemin hangi aşamasında kullanılıyor?
4. Input ve output'u nedir?
5. Kullanılmazsa ne olur?
6. Alternatifleri nelerdir?
7. Trade-off'u nedir?
8. Etkisi nasıl ölçülür veya karşılaştırılır?

Implementasyon, UI ve dokümantasyon bu yanıtları görünür kılmalıdır.

## Secrets

- API key, token, service role key veya başka bir secret source code'a yazılmamalıdır.
- Gerçek secret değerleri `AGENTS.md`, `README.md` veya tracked config içine eklenmemelidir.
- `.env` gibi secret dosyaları gerektiğinde `.gitignore` benzeri korumalara dahil edilmelidir.
- Gemini API key ileride environment variable üzerinden alınmalıdır.
- Log, test fixture, örnek çıktı veya hata mesajları secret sızdırmamalıdır.

## Codex iteration ve path-aware verification

- **Scope-first:** Scoped görevde önce yalnız ilgili dosyaları ve doğrudan dependency'lerini incele; kullanıcı repo-wide audit istemedikçe tüm repo'yu yeniden tarama.
- **No unrelated work:** Scope dışı refactor, cleanup, naming, dependency upgrade veya “while I’m here” değişikliği yapma.
- **Targeted-first:** Development loop'unda yalnız değişiklikle ilgili targeted testleri çalıştır; her küçük edit sonrası full suite çalıştırma.
- **Final full verification:** Implementation tamamlandıktan sonra, değişen path'lerin gerektirdiği final gate'te geniş backend/frontend suite'leri, lint, typecheck ve build kontrollerini bir kez çalıştır.
- **Failure loop:** Full test failure'ında önce yalnız failing test'i debug et; targeted test green olmadan full suite'i tekrar çalıştırma.
- **Path-aware verification:** Yalnız değişen path'lerin gerektirdiği gate'leri seç. Codex/local loop'unda backend değişikliği unrelated frontend E2E'yi, frontend değişikliği unrelated backend/provider testlerini otomatik tetiklemez; CI'nin mevcut classifier'ının zorunlu gate'leri korunur.
- **Expensive E2E:** Seeded, hosted ve real-provider E2E'leri development loop'unda tekrarlama; ilgili flow değiştiyse final verification'da çalıştır. `npm run e2e:full` scheduled/manual veya release doğrulamasına aittir.
- **Reuse evidence:** Aynı turda değişmemiş dosyayı, başarıyla geçmiş pahalı testi veya doğrulanmış external contract'ı gereksiz yere yeniden inceleme.
- **No automatic second audit:** Implementation ve gerekli final verification başarılıysa repo-wide ikinci audit yapmadan bitir; ikinci audit yalnız kullanıcı isterse veya somut sistemik risk çıkarsa yapılır.
- **Parallelize safe work:** Bağımsız inspection ve targeted testleri mümkünse paralel yürüt; dependency sırası olan editleri paralelleştirme.
- **Stop condition:** İstenen davranış implement edilmiş, regression testleri geçmiş, gerekli final gate'ler green ve git diff scope içindeyse task tamamdır; yeni improvement arama.
- **Correctness over speed:** Bu optimizasyonlar gerekli security, migration, concurrency veya production contract testlerini atlamak için kullanılamaz; amaç aynı kanıtı tekrar tekrar üretmemektir.

### Path-aware verification matrix

`<ilgili_test>.py` ve `<ilgili_test>` mevcut test yoluyla daraltmadır; yeni script veya komut değildir.

| Değişen path | Development loop | Final gate / CI karşılığı |
| --- | --- | --- |
| `backend/` | `python -m pytest backend/tests/<ilgili_test>.py` | `python -m pytest backend/tests`; ilgili kullanıcı akışında `npm run e2e:smoke` |
| Frontend (`app/`, `components/`, `lib/`, `test/`, `e2e/`) | `npm test -- --maxWorkers=1 <ilgili_test>` | `npm run lint`; `npm run typecheck`; `npm test -- --maxWorkers=1`; `npm run build`; `node --check scripts/smoke.mjs`; ilgili akışta `npm run e2e:smoke`, auth değişikliğinde `npm run e2e:auth` |
| `supabase/` veya migration authority | `node scripts/check-migration-authority.mjs` | `node scripts/check-migration-authority.mjs`; `supabase start`; `supabase db reset --local --no-seed`; `supabase test db --local`; `supabase db lint --local --schema rag_lab --fail-on error` |
| `modal/worker` (`backend/modal_app.py`, worker ile ilgili `backend/app/`) | `python -m pytest backend/tests/<ilgili_test>.py` | `python -m pytest backend/tests`; release CI'de `modal deploy --env "$MODAL_ENVIRONMENT" --tag "$GITHUB_SHA" --strategy rolling backend/modal_app.py`; ilgili contract için `npm run e2e:smoke`, real-provider doğrulaması için yalnız `npm run e2e:full` |
| Docs-only (`AGENTS.md`, `README.md`, `docs/`) | Test yok; gerekirse `git diff --check` | Frontend/backend/database/modal/E2E gate'lerini çalıştırma; CI'nin docs-only classification ve always-on `secret-hygiene` kontrolü yeterlidir |

Migration production apply (`supabase db push --linked --yes --skip-vault`) ve Modal/hosted E2E yalnız ilgili CI/release yetkisi ve final gate kapsamında çalıştırılır.
