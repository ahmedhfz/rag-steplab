# RAG StepLab deployment — Render → Modal migration

Bu doküman migration mimarisini, doğrulama kapılarını, cutover sırasını ve
rollback contract'ını tanımlar. Render yalnız bütün Modal ve Vercel kapıları
geçilene kadar geçici güvenlik ağı olarak tutulur.

## Hedef mimari

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

Supabase schema, Storage bucket, SQLAlchemy/Alembic lineage'ı ve mevcut RAG
pipeline'ı korunur. Render, rollback için migration'ın son kapısına kadar
aktif tutulur.

## Async parse contract

Yeni parse akışı:

```text
POST /documents/parse (multipart PDF)
    → Storage upload + document + queued run
    → HTTP 202 { documentId, parseRunId, status: "queued" }
    → GET /parse-runs/{parseRunId}
    → queued → running → completed | failed
```

Persisted source için `POST /documents/{documentId}/parse` aynı lifecycle'ı
kullanır. `completed` polling yanıtı normalized structured content, Markdown,
summary ve provenance içerir. `failed` yanıtı güvenli `error.code`/`message`
içerir. Database'de internal `interrupted` tutulsa bile public API ve frontend
bunu `failed` + `error.code = parse_interrupted` olarak gösterir; public
interrupted state yoktur.

Frontend polling kuralları:

- Poll interval 2 saniyedir. Browser 15 dakika sonunda gerçek run'ı failed
  yapmadan takibi durdurur; kullanıcıya refresh ile durable polling'i sürdürme
  mesajı gösterilir.
- queued/running sırasında ikinci submit disabled ve provider-level guard ile
  engellenir.
- transient network/5xx/408/429 polling hatası run'ı failed yapmaz; sonraki
  poll durable status'ı yeniden okur.
- browser refresh sonrasında persisted active parse run seçilip polling devam
  eder.
- completed olmayan run downstream chunk, embedding, retrieval veya evaluation
  için usable değildir.
- fake percentage, warming/progress, answer veya score üretilmez.

## Modal resource başlangıç profili

Bu değerler benchmark başlangıcıdır; semantic doğruluk ve stabilite korunmadan
resource azaltılmaz:

| Bileşen | CPU | Bellek | Timeout | Min/Max |
| --- | ---: | ---: | ---: | ---: |
| API | yaklaşık 0.5 | yaklaşık 1024 MiB | platform varsayılanı | 0 / 2 |
| Docling worker | 2.0 | 4096 MiB | 900 s | 0 / 1 |

Docling sürümü pinned tutulur. Model/artifact prefetch versioned Modal
Volume'a yapılır ve image içinde explicit `artifacts_path` kullanılır. Image
`backend/app` paketini explicit içermeli; remote import smoke şu iki importu
çalıştırmalıdır:

```text
import app.main
import app.parser
```

İlk benchmark'ta cold/warm süre, peak RAM, CPU ve Storage/DB network süreleri
ölçülür. Paid plan veya paid resource migration kapsamına dahil değildir.

Karaman regression PDF'iyle ilk Modal ölçümü: cold worker parse `33.983 ms`,
warm worker parse `25.996 ms`; gözlenen peak RSS sırasıyla `2.872,7 MiB` ve
`3.325,89 MiB` oldu. Bu sonuç 4 GiB başlangıç profilini korumayı gerektirir;
daha küçük profil ancak aynı semantic gate ve birden fazla PDF benchmark'ı
geçerse değerlendirilir.

## Environment contract

Frontend yalnız public URL alır:

```text
NEXT_PUBLIC_API_BASE_URL=https://<modal-api-domain>
```

Modal API/worker secret'ları server-side environment veya Modal Secret olarak
tutulur. `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`
ve benzeri değerler `NEXT_PUBLIC_*`, source control, README, smoke output veya
browser log'larına yazılmaz. CORS yalnız gerçek Vercel origin'lerini exact
olarak içerir; wildcard kullanılmaz.

## Local doğrulama

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Async + semantic smoke için Karaman regression PDF'i kullanın:

```powershell
$env:SMOKE_API_URL = "http://127.0.0.1:8000"
$env:SMOKE_FRONTEND_URL = "http://localhost:3000"
$env:SMOKE_PDF_PATH = "C:\path\to\karaman-operasyon-raporu.pdf"
$env:SMOKE_REQUIRE_PARSE = "1"
$env:SMOKE_REQUIRE_SEMANTIC = "1"
node scripts/smoke.mjs
```

Semantic gate şunları doğrular: 8 sayfa, 9–11 tablo, 24–28 başlık, geçerli
page provenance, orphan semantic element olmaması ve `BAT-S12`, `INV-T17`,
`12,84 GWh`, `%17,6`, `%25` marker'larının korunması. Full RAG contract için
ayrıca:

```powershell
$env:SMOKE_REQUIRE_RAG = "1"
$env:SMOKE_QUERY = "Dokümandaki bağlamla doğrudan cevaplanabilen bir soru"
node scripts/smoke.mjs
```

Full smoke parse → Storage → chunking (üç strategy) → embedding → dense,
keyword ve hybrid/RRF → rerank → context → grounded generation/citations →
evaluation → history → rechunk/reparse stale invalidation zincirini yürütür.
Smoke response body, raw PDF, token, secret veya credential yazdırmaz.

## Güvenli cutover sırası

1. Frontend/backend implementation ve local test kapıları.
2. Backward-compatible Alembic migration ve Supabase doğrulaması.
3. Modal dark deploy, remote import/model-cache smoke ve direct semantic smoke.
4. Vercel Preview → Modal API bağlantısı ve full preview smoke.
5. PR/CI green, merge ve merged SHA'nın Modal'a deploy edilmesi.
6. Modal smoke tekrar, Vercel production API URL cutover'ı ve production full
   RAG/browser smoke.
7. En az 30 dakika health/log observation.
8. Render traffic/identity son doğrulaması.
9. Yalnız exact eski `rag-steplab-api` service'i, final gate'ler green ise,
   silinir; ardından `render.yaml` ve aktif Render referansları cleanup PR ile
   kaldırılır.

Modal veya production smoke başarısızsa Render silinmez. Cutover sonrası hata
olursa production API URL Render'a geri alınır ve rollback smoke doğrulanır.

## Rollback notu

Render emergency recreation bilgisi yalnız final cleanup sonrasında bu dosyada
legacy rollback notu olarak tutulabilir. Render URL'si aktif deployment veya
frontend default'u olarak README/config içinde bırakılmaz.
