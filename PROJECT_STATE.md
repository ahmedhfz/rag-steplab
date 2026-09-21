# Project State

Last updated: 2026-09-13

## Current Status

RAG StepLab, gerçek ara çıktılar ve kalıcı run geçmişiyle çalışan bir RAG öğrenme
laboratuvarıdır. Next.js/React arayüzü (`app/`, `components/`, `lib/`), FastAPI
RAG Core (`backend/app/`) ve Supabase persistence katmanları mevcuttur.

PDF upload ve async Docling parse; üç chunking stratejisi; Gemini embeddings;
dense/keyword/hybrid retrieval; optional reranking; context, generation ve
citation doğrulaması; dataset tabanlı evaluation ve karşılaştırma uygulanmıştır.
Doküman kitaplığı, document-scoped saved pipeline'lar, Build aşamaları,
Playground, Evaluation, auth ve görünüm ayarları arayüzde bulunur.

Vitest, backend pytest, database testleri ve Playwright seeded/auth/visual/full
profilleri vardır. CI değişen yollara göre gate seçer. Deployment düzeni Vercel
frontend, Modal API/worker ve Supabase'dir; full hosted RAG doğrulaması ayrı
manuel workflow'dur. Bu özet canlı servis sağlığı veya güncel test geçişi kanıtı değildir.

## Current Decisions

- Gerçek provenance ve document/pipeline lineage kanoniktir. Reparse/rechunk
  sonrası eski downstream çıktılar geçersizleşir; inspect ve use ayrıdır.
- Supabase JWT ile çözülen kullanıcı için backend owner filtreleri ve private
  `rag_lab` privilege sınırı kullanılır; bu şemada aktif RLS varsayılmaz.
- Şema değişikliklerinin tek otoritesi `supabase/migrations/` ve Supabase CLI'dır.
  Runtime persistence SQLAlchemy/psycopg üzerinden yürür.
- Uzun işler Modal worker'a ayrılır; durable run state ve lease/fencing
  mekanizması korunur. Frontend provider veya storage sorumluluğunu üstlenmez.
- `PreferencesProvider` görünüm tercihlerini yönetir; System varsayılanı,
  Light/Dark ve hydration öncesi tema bootstrap'ı uygulanmıştır.
- Sonraki aşama CTA'sı içerik sonunda, yalnız uyumlu tamamlanmış upstream
  çıktıyla görünür; Run/Re-run çalışma alanında kalır.
- README ürün tanımı, AGENTS ajan çalışma kuralları, PROJECT_STATE güncel durum
  özetidir. Ayrıntılı geçmiş Git'tedir; bu dosya görev günlüğü değildir.

## Recently Completed

- Fonksiyonel/OCR remediation production'a alındı: main `f954a53` Vercel
  production ve Modal `v55` üzerinde çalışıyor. Yeni hosted parse/chunk/embed
  lineage'i (`a37f7ebe-8587-4153-9cf9-e440328fc13b`, parse
  `18aeddd7-2b9b-4a5b-81cb-2d0fa6f5fd53`) ile 14 soruluk kabul koşusu
  tamamlandı; B1 OCR, yapısal parse, retrieval, reranking ve abstention
  doğrulandı. Üretimde bulunan grounding sayı/tarih biçimleme kusuru
  `f954a53` ile düzeltildi ve kabul koşusu tekrarlandı.
- Tüm uygulama ikonları `iconoir-react@7.12.1` tabanlı tek semantic registry'ye
  taşındı; Navigation/Journey ve aşama durumları aynı ikon ailesini kullanıyor.
  Lucide bağımlılığı kaldırıldı; Google ve marka asset'leri korunuyor.
- Docling normalizasyonu checkbox/provenance/time-range koruması, geometri
  tabanlı okuma sırası ve bağlamsal başlık seviyeleriyle; structure-aware
  chunking, calibrated hybrid trace ve grounded generation validation güncellendi.
- OCR remediation uygulandı: Docling'in PDF-aware seçici OCR akışında RapidOCR
  3.9.2 + CPU ONNX Runtime 1.30.0 ve hash-pinned PP-OCRv6 Small recognizer
  kullanılıyor; native/OCR/mixed provenance, bbox ve tanısal confidence
  parsed element sözleşmesine eklendi. Gerçek stress PDF'inin 7. sayfasında
  `B1: pirinç` ve 15. sayfa tablo başlığı doğrulandı; full worker benchmark'ı
  Linux Python 3.13 / 2 CPU / 4 GiB koşulunda tamamlandı.
- Doküman kitaplığına açık onay isteyen silme akışı eklendi; başarılı silme
  sonrası document-scoped pipeline/lineage seçimleri temizleniyor ve aktif
  doküman silindiyse sıradaki doküman seçiliyor.
- Docling heading adayları kaynak geometri ve tablo/container bağlamıyla
  sınıflandırıldı; kısa callout metinleri paragraph olarak korunuyor (`cb6b72d`).
- Responsive arayüz ve içerik sonu aşama geçişleri düzeltildi (`4007c89`).
- Dark mode token, portal, ikon ve odak kontrastları iyileştirildi (`1cfe817`).
- Polling, lineage state ve inspection/evaluation sunumuna yönelik audit
  düzeltmeleri birleştirildi (`d5d1dc5`).

## Current Work

Production doğruluk kapısı tamamlandı. OCR provenance/confidence görünürlüğü ve
grounding güvenlik davranışı mevcut; daha geniş etiketli corpus ile confidence
kalibrasyonu ve eşik seçimi hâlâ ölçülmedi.

## Next

UI/UX polish ve normal ürün iterasyonu; yeni OCR kalite ölçümleri yalnızca
etiketli örnekler ve açık kapsam kararıyla genişletilecek.

## Open Questions

Türkçe OCR için confidence dağılımı ve kabul/insan inceleme eşiği daha geniş,
etiketli bir corpus ile ölçülmedi; mevcut metadata tanısal görünürlük sağlar,
otomatik filtre uygulamaz.
Temiz `origin/main` üzerinde de iki inspection E2E beklentisi başarısız:
geçmiş experiment için `Unsaved changes` ve chunk teknik ID görünürlüğü.
Kritik lineage/OCR gate'leri geçti; bu pre-existing beklentiler ayrıca ele alınmalıdır.
