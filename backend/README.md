# RAG StepLab backend

Backend gerçek ve kalıcı RAG learning pipeline'ını sağlar:

```text
PDF → private Storage → 202 parse run → Modal API/worker → full Docling
→ chunking → Gemini embeddings → pgvector/FTS → retrieval/reranking → context
→ grounded generation/citations → evaluation
```

## Async parse sözleşmesi

`POST /documents/parse` ve persisted doküman için `POST
/documents/{documentId}/parse`, PDF Storage'a alındıktan sonra HTTP `202` ve
`documentId`/`parseRunId` döndürür. Frontend `GET /parse-runs/{parseRunId}`
ile şu public durumları izler:

```text
queued → running → completed
                 ↘ failed
```

`completed` yanıtı normalized `structured`, Markdown ve summary içerir. `failed`
yanıtı `error.code` ve güvenli bir mesaj içerir. Veritabanında tutulabilecek
`interrupted` durum API sınırında `failed` + `parse_interrupted` olarak
normalize edilir; browser'a ayrı bir interrupted state açılmaz. Polling sırasında
geçici ağ hataları run'ı başarısız saymaz; durable status tekrar okunur.

Parse tamamlanmadan chunking, embedding veya downstream deneyler başlatılamaz.
Bu nedenle `queued`/`running`/`failed` run için sahte progress, score veya parse
özeti üretmek yasaktır.

## Modal deployment

Production parsing tam Docling `DocumentConverter` ve semantic normalization
üzerinden çalışır. Normalizasyon, layout modelinin heading adaylarını tablo/container
üyeliği ve kaynak satır geometrisiyle kontrol eder. Gövde boyutunda, açıklamaya
bitişik kısa etiketler metin ve provenance korunarak paragraph olur; numaralı,
daha büyük veya ayrı duran section title'lar korunur. Kaynak geometrisi yoksa
tipografi üzerinden heading düşürülmez. Docling parsed page verisi yalnız bu
kontrol için worker belleğinde tutulur; API/storage sözleşmesi `normalized-v1`
kalır, algoritma `runMetadata.headingClassifierVersion` ile izlenir. Mevcut
parse artifact'ları değişmez; düzeltme yeni parse/reparse sonuçlarına uygulanır.

Mevcut profil worker için `CPU 2`, `4096 MiB`, `timeout
900 s`, `min_containers=0`, `max_containers=1`; API için yaklaşık `CPU 0.5`,
`1024 MiB`, `min_containers=1`, `max_containers=2`'dir (`api_eu`). Legacy `api`
cutover rollback yüzeyi scale-to-zero kalır. Docling modelleri pinned
ve versioned bir Modal Volume'a prefetch edilir. `backend/app` image'a explicit
paketlenir ve remote import smoke'ta `app.main` ile `app.parser` doğrulanır.

Otomatik Modal deploy/tag/health kontrolleri ile gerektiğinde yetkili model cache
hazırlığı ve manuel production full-RAG doğrulaması [docs/deployment.md](../docs/deployment.md) içinde tanımlıdır.

## Çalıştırma

Proje kökündeki `npm run dev` tek giriş noktasıdır. `.env` içindeki
`NEXT_PUBLIC_API_BASE_URL` hosted bir API gösteriyorsa frontend'i aynı-origin
local proxy ile bu API'ye bağlar; böylece browser CORS ayarı değiştirilmeden
kalıcı Supabase dokümanlarına erişilir. API URL'si local ise frontend ile
FastAPI birlikte başlatılır ve backend virtual environment gerekir.
Local development'ta `DATABASE_URL` yoksa `LOCAL_PARSE_WORKER_ENABLED` varsayılan
olarak açıktır ve aynı gerçek Docling worker path'i FastAPI sürecinde arka planda
çalışır. Böylece local memory Storage/Repository ile `202 → queued → running →
completed/failed` lifecycle'ı production sözleşmesiyle aynı kalır; parser sahte
çıktı üretmez. Paylaşılan production-like Postgres + Storage kurulumu kullanılıyorsa
`LOCAL_PARSE_WORKER_ENABLED=false` ile authenticated Modal CLI üzerinden
`rag-steplab-api` worker'ına dispatch edilebilir. Production credential'ları
browser'a veya source control'a kopyalanmaz.

Backend'i tek başına çalıştırmak için PowerShell:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Environment isimleri repository kökündeki `.env.example` dosyasında tanımlıdır. Paylaşılan
Supabase PostgreSQL kullanıldığında `rag_lab` şeması, `extensions.vector` ve
private `rag-documents` bucket'ı Supabase migration'ları tarafından hazırlanır.
Secret değerleri source control'a eklenmez.

## Database migrations

Migration authority yalnız Supabase CLI'dır:

```text
supabase/migrations/*.sql → Supabase CLI → Supabase PostgreSQL
```

Yeni migration oluşturmak için repository root'unda:

```powershell
supabase migration new <descriptive_name>
```

Local Supabase stack ile şema rebuild'i:

```powershell
supabase start
supabase db reset --local --no-seed
```

Uygulamanın local `DATABASE_URL` fallback'i korunur; Supabase CLI local
stack'i uygulamanın zorunlu runtime dependency'si değildir. Production
migration'ları yalnız GitHub Actions Supabase CLI job'ı uygular.

Frontend varsayılan olarak `http://127.0.0.1:8000` adresini kullanır. Farklı bir adres için frontend build/dev işleminden önce `NEXT_PUBLIC_API_BASE_URL` tanımlanabilir. Hosted kurulum için `docs/deployment.md` canonical kaynaktır.

## RAG kalite sözleşmesi

`EvaluationDatasetRequest` interaktif kullanımda en fazla 10 case kabul eder.
Bounded backend benchmark'ı için `evaluationMode=benchmark` ile üst sınır 200
case'tir; değerlendirme worker'ı da persisted dataset'leri aynı 200 case sınırı
ile korur. `EvaluationCase.expectedOutcome=insufficient_context`, relevant
element ID'si olmayan no-answer case'idir. Bu case'lerin Hit@K, Recall@K,
Precision@K ve MRR değerleri aggregate retrieval ortalamasına dahil edilmez;
abstention doğruluğu ayrı raporlanır.

`citationValidity`, üretilen citation ID'lerinin o generation çağrısına verilen
context içinde bulunup bulunmadığını ölçer (`context_id_membership_v1`). Claim
entailment veya faithfulness ölçümü değildir; groundedness/faithfulness ayrı
metriklerdir. Gemini generation, reranking ve judge çağrıları resmi JSON schema
ile sınırlandırılır, ancak uygulama tarafındaki JSON parse ve semantic
validation katmanı korunur.

## Test

```powershell
.venv\Scripts\python.exe -m pytest
```
