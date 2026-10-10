---
name: modal
description: RAG StepLab Modal API/worker configuration, deployment planning, import/cache diagnostics and authorized operations. Use for backend/modal_app.py or Modal worker boundaries, not generic Python, GPU, sandbox or frontend work.
metadata:
  version: "1.5.4"
---

# RAG StepLab Modal

Modal CLI skill kökeninden repository'ye uyarlanmıştır; bakım sahibi repository
maintainer'larıdır. `modal skills update` ile yerel prosedürü körlemesine ezmeyin.
SDK sürümünün tek kaynağı `backend/requirements.in` (hash'li lock'lar ondan üretilir); gerektiğinde kurulu CLI'nin
`--version`/`--help` çıktısı ve [resmi doküman indeksi](https://modal.com/llms.txt)
ile ilgili API'yi doğrulayın. Genel dokümanların tamamını yüklemek gerekmez.

## Değişiklik yüzeyini seç

- `backend/modal_app.py`: API/worker image'ları, resource profilleri, app/function
  kimlikleri, model Volume ve remote smoke tanımı.
- `backend/app/`: parser, dispatch ve pipeline uygulaması; `backend/AGENTS.md`
  owner isolation/lifecycle/fencing sınırını taşır.
- `backend/requirements*.in` girdileri ve üretilmiş hash'li `requirements*.txt`
  lock'ları: `requirements` hafif API runtime, `requirements-worker` ağır Docling/ML,
  `requirements-ci` hafif test/lint; lock'lar elle düzenlenmez (`npm run python:lock`).
- [Deployment runbook](../../../docs/deployment.md) ve `.github/workflows/release.yml`:
  otomatik gate'ler, manuel işlemler ve rollback'in kanonik kaynağı.

API image'a ağır worker bağımlılıklarını taşımayın. Active `api_eu` ile legacy
`api` rollback kimliğini karıştırmayın. Kaynak profilini manifestten okuyun;
ölçüm olmadan CPU/bellek/cache optimizasyonu eklemeyin.

## Prosedür

1. API-only, worker/provider veya migration etkisini belirleyin. Classifier ve
   release koşullarından hangi kontrollerin gerçekten çalışacağını çıkarın.
2. İlgili backend testlerini hafif CI environment'ında çalıştırın; Modal config
   değişikliğinde `backend/tests/test_modal_configuration.py` kullanın. Local
   import/manifest doğrulaması uzaktaki image veya provider başarısı değildir.
3. Deployment istenmiş ve yetkiliyse runbook'taki test edilmiş SHA, `main`
   environment ve rolling stratejisini kullanın. Yetki yoksa uygulanabilir plan
   ve eksik kanıtı verin; code edit yetkisi remote invocation/deploy yetkisi değildir.
4. Model/artifact değişikliği veya cache eksikliği kanıtı varsa prefetch'i ayrı
   operasyon olarak değerlendirin; her deploy'a otomatik eklemeyin.
5. Deployment sonrası Modal tag/SHA, health/ready ve auth korumasını doğrulayın.
   Worker/provider değişikliğinde remote import sonucunu kontrol edin. Gerçek
   parsing/semantic/provider doğrulaması gerekiyorsa `rag-e2e-validation` becerisi
   ve runbook üzerinden uygun yetkili smoke'u seçin.

## Sonuç ve başarısızlık sınırı

Local test, Modal tag, remote import, API health ve hosted RAG sonuçlarını ayrı
raporlayın; Vercel SHA eşleşmesi release workflow'unda otomatik garanti değildir.
Eksik credential, yanlış hedef/tag veya kalıcı smoke hatasında başka environment'a
geçmeyin ve yeniden deploy döngüsü başlatmayın; runbook rollback kapsamını belirtin.
Credential değerleri ve ham provider/PDF içerikleri çıktıya taşınmaz.

Async Python'da uzak Modal çağrıları için mevcut `.aio()` kullanımını koruyun;
SDK değişikliği gerekiyorsa ilgili resmi API referansını okuyun.
