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
kontrol ve native/OCR provenance eşlemesi için worker belleğinde tutulur; API/storage sözleşmesi `normalized-v1`
kalır, algoritma `runMetadata.headingClassifierVersion` ile izlenir. Mevcut
parse artifact'ları değişmez; düzeltme yeni parse/reparse sonuçlarına uygulanır.

OCR, Docling'in seçici PDF davranışını ve native metin önceliğini korur.
`app/ocr.py` üç ONNX dosyasını SHA256 ile sabitler: v3 English mobile detector,
mevcut angle classifier, PP-OCRv6 Small multilingual recognizer. RapidOCR 3.9.2 /
ONNX Runtime 1.30.0 CPU kullanılır; embedded recognition dictionary Türkçe
harfleri taşır. Global preprocessing veya sözlük düzeltmesi uygulanmaz.
Yerelde `python -m app.ocr` modelleri hazırlayın; gerekirse `RAG_OCR_MODEL_PATH`
ayarlayın. Parse sırasında indirme/fallback yoktur; eksik veya farklı hash hata verir.
Modal worker image modeli hazırlarken indirir; boş Docling Volume OCR profili değiştirmez.

`sourceOrigin` ve `sourceRegions` öğe seviyesinde kaynak/koordinat/OCR confidence
taşır; tam profil yalnız `runMetadata.ocr` içindedir. Native metne skor atanmaz;
eski kayıtlar unknown kalır. Parse ve Source Inspector bölge ve tanısal skor
gösterir. PDF viewer FitR desteği varsa bölgeye yakınlaşır; koordinatlar her
durumda görünür. Chunk `sourceElementIds` bu öğelere mevcut lineage ile bağlanır.
Confidence kalibre doğruluk değildir; otomatik eleme/eşik uygulanmaz.

Gerçek crop testi: `RUN_OCR_REGRESSION=1 python -m pytest tests/test_ocr_recognition.py`.
Ölçüm: `python scripts/benchmark_ocr.py --output result.json --pdf <stress-test.pdf>`.

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
ile korur. Benchmark modu public API'de varsayılan olarak kapalıdır; yalnız
kontrollü internal koşularda server-side `BENCHMARK_EVALUATION_ENABLED=true`
ile açılır. `EvaluationCase.expectedOutcome=insufficient_context`, relevant
element ID'si olmayan no-answer case'idir. Bu case'lerin Hit@K, Recall@K,
Precision@K ve MRR case değerleri `null` olur ve aggregate retrieval ortalamasına
dahil edilmez; abstention doğruluğu ayrı raporlanır. Insufficient-context
generation `insufficientContext=true`, boş `answer`, `segments` ve `citations`
döndürür; kullanıcıya gösterilecek açıklama locale katmanında üretilir. Arayüz
bu `null` değerleri `0` değil `N/A`/`—` göstermeli ve retrieval-eligible case
sayısını belirtmelidir.

`citationValidity`, üretilen citation ID'lerinin o generation çağrısına verilen
context içinde bulunup bulunmadığını ölçer (`context_id_membership_v1`). Claim
entailment veya faithfulness ölçümü değildir; groundedness/faithfulness ayrı
metriklerdir. Gemini generation, reranking ve judge çağrıları resmi JSON schema
ile sınırlandırılır, ancak uygulama tarafındaki JSON parse ve semantic
validation katmanı korunur.

Reranker'ın `rerankRank`/`rank` değerleri gerçek sıralı pozisyondur. Geriye dönük
`rerankScore` alanı ordinal bir uyumluluk değeridir, confidence veya relevance
olasılığı değildir (`rerankScoreSemantics=deprecated_ordinal_not_confidence`).

Reranking ve generation prompt'ları retrieved document/chunk metnini güvenilmeyen
veri olarak sınırlar; dokümanın içindeki komutlar sistem veya kullanıcı talimatı
sayılmaz. Chunk özetleri `configHash`, `tokenizerVersion`, `chunkerVersion` ve
bu alanları strategy ile parse run kimliğine bağlayan `lineageFingerprint` taşır. Böylece
tokenizer fallback'i dahil ortam farkları aynı ayar görünümünün arkasında kalmaz.
Gemini adapter'ı mevcut tek `contents` ve structured-JSON sözleşmesini korur;
ayrı system/user role API'sine geçilmedi, çünkü bu sağlayıcı sözleşmesini ve
cache fingerprint'lerini gereksiz yere değiştirecekti. Delimiter sınırı, allowlist
kontrolü ve semantic validation birlikte savunma katmanıdır.

Parse, embedding, provider-backed experiment ve evaluation admission'ı kullanıcı
başına tek aktif ağır iş ile sınırlıdır. Kontrol PostgreSQL transaction advisory
lock altında durable run state'e bakar; yeni bağımsız iş 429
`user_run_limit_reached` alır. Evaluation'ın kendi sıralı child experiment'ları
aynı kabul edilmiş işin parçasıdır. Completed, failed veya interrupted terminal
durumları kapasiteyi serbest bırakır.

Yeni iş admission'ı aynı owner lock ve transaction içinde süresi dolan aktif
kayıtları `interrupted` durumuna uzlaştırır; geçmiş ve kısmi çıktılar silinmez.
Embedding/experiment/evaluation için explicit lease önceliklidir; eski lease'siz
kayıtlarda `started_at`, yoksa `created_at` üzerine mevcut pipeline çalışma bütçesi
uygulanır. Parse için Modal'ın 900 saniye execution + 300 saniye startup sınırı
ve 120 saniye tolerans kullanılır. Parse polling/yeniden başlatma ve pipeline
polling de aynı zaman aşımı kurallarını uygular. Temizlik yeni iş veya durum
sorgusu sırasında yapılır; ayrı bir periyodik tarayıcı yoktur. Worker'ın gerçek
bitiş anı bilinmeyen timeout kayıtlarında `duration_ms` boş bırakılır.

Doküman silme, source object bilgisini `rag_lab.storage_cleanups` private outbox'ına
document cascade ile aynı transaction'da yazar. Storage silme geçici olarak
başarısız olsa bile mantıksal silme tamamlanır; `DELETE` veya normal upload gibi
mutasyonlar pending kaydı idempotent olarak yeniden dener (listeleme GET'leri
özellikle yan etkisizdir). Outbox client rollerine açık değildir ve auth
kullanıcısı silinse de object cleanup tamamlanana kadar korunur.

## Test

```powershell
.venv\Scripts\python.exe -m pytest
```

CI ayrıca `python -m ruff check .` ve `python -m mypy` çalıştırır (backend dizininde;
kurallar `ruff.toml` ve `mypy.ini`'de, mevcut ihlaller dosya bazlı baseline'dır).

Summary endpoint ölçümleri sözleşme değil, isteğe bağlı tanıdır:
`npm run perf:summary` hosted/local API'de gerçek bir dokümanın `/summary` yanıt
boyutu ve süresini ölçer (`RAG_API_BASE_URL`, `RAG_API_TOKEN`, `RAG_DOCUMENT_ID`);
`npm run perf:summary:fixture` aynı ölçümü in-memory TestClient fixture'ıyla yapar
ve backend bağımlılıkları kurulu, PATH'teki `python`'ı kullanır.

## Python bağımlılık lock'ları

İnsan tarafından düzenlenen girdiler `requirements*.in` dosyalarıdır. `requirements*.txt`
dosyaları `uv pip compile --universal --generate-hashes` ile üretilen hash'li lock'lardır;
elle düzenlenmez. Modal API/worker image'ları ve CI aynı lock'ları kurar, pip hash'leri
zorunlu kılar. Runtime pin'leri (`requirements.txt`) CI, worker ve dev lock'larında
birebir aynı tutulur; Modal SDK sürümünün tek kaynağı `requirements.in`'dir.

```powershell
node ../.github/scripts/python-locks.mjs                              # girdiler değişince
node ../.github/scripts/python-locks.mjs -- --upgrade-package pyjwt  # tek paketi yükselt
node ../.github/scripts/python-locks.mjs --check                      # CI kontrolü
```

Script `uv`'yi PATH'te bekler (`requirements-ci.txt` içinde gelir). Worker lock'u Modal'ın
linux/x86_64 ortamı için CPU-only torch wheel'ini URL + hash ile sabitler. Dependabot `uv`
ekosistemiyle `.in` → `.txt` derlemesini aynı başlık seçenekleriyle kendisi yapar.
