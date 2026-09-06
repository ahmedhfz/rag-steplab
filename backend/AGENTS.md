# RAG StepLab Backend

## Sahiplik ve sınırlar

FastAPI uygulaması `backend/app/` altındadır. `pipeline.py`, `parser.py`,
`chunking.py`, `gemini.py`, `repository.py` ve `backend/modal_app.py` RAG Core,
provider ve Modal worker akışını yürütür. Backend frontend UI'sının veya
Supabase migration history'sinin sahibi değildir.

## Auth ve veri bütünlüğü

Endpoint'ler Supabase JWT'sinden çözülen mevcut kullanıcıyı kullanır. Belge,
pipeline, run ve bağlı artifact sorgu/yazımlarında `owner_user_id` filtresi
zorunludur; başka kullanıcının verisini id ile erişilebilir kılmayın. Persisted
async state, API response sözleşmesiyle aynı lifecycle'ı korur:
`queued` → `running` → `completed`/`failed`; iç `interrupted` durumu API'de
görünür failed sözleşmesine normalize edilir.

## Worker ve RAG invariants

- Lease token/expiry ve fencing kontrolleri stale worker'ın yeni sonucu
  ezmesini engeller; dispatch/renew/reconcile akışlarını birlikte koruyun.
- Provider structured output'u parse ve semantic validation'dan geçer.
  Citation geçerliliği üretilen citation ID'sinin çağrı context'inde üyeliğini
  ölçer; tek başına model faithfulness kanıtı değildir.
- Gerekli upstream tamamlanmadan downstream run başlatmayın; hata ve eksik
  lineage'ı görünür, deterministic bir API sonucu olarak taşıyın.

## Bağımlılık ve doğrulama

CI için hafif bağımlılıklar `backend/requirements-ci.txt`, worker/Docling/ML
bağımlılıkları `backend/requirements-worker.txt` ve çalışma bağımlılıkları
ilgili requirements dosyalarındadır; CI'ye ağır worker paketleri eklemeyin.
Kurulum ve deployment ayrıntıları `backend/README.md` ile `docs/deployment.md`
kanoniktir. Backend değişikliklerinde önce ilgili `backend/tests/` testini,
sonra classifier/workflow'un seçtiği backend ve gerekirse seeded E2E gate'ini
çalıştırın.
