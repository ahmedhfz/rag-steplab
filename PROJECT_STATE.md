# Project State

Last updated: 2026-09-21

## Current Status

RAG StepLab, gerçek ara çıktılar ve kalıcı run geçmişiyle çalışan bir RAG öğrenme
laboratuvarıdır. Next.js/React arayüzü (`app/`, `components/`, `lib/`), FastAPI
RAG Core (`backend/app/`) ve Supabase persistence katmanları mevcuttur.

PDF upload ve async Docling parse; üç chunking stratejisi; Gemini embeddings;
dense/keyword/hybrid retrieval; optional reranking; context, generation ve
citation doğrulaması; dataset tabanlı evaluation ve karşılaştırma uygulanmıştır.
Doküman kitaplığı, document-scoped saved pipeline'lar, Build aşamaları,
Playground, Evaluation, auth ve görünüm ayarları arayüzde bulunur.
İlk kullanımda TR/EN kurgusal örnek PDF, doküman ekleme yolu ve Journey birlikte
gösterilir; örnek sorular yalnız seçili örnek PDF ile eşleştiğinde görünür.

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
  mekanizması korunur. Kullanıcı başına tek aktif ağır iş admission'ı parse,
  embedding, provider experiment ve evaluation için veritabanı durumuna dayanır.
  Frontend provider veya storage sorumluluğunu üstlenmez.
- `PreferencesProvider` görünüm tercihlerini yönetir; System varsayılanı,
  Light/Dark ve hydration öncesi tema bootstrap'ı uygulanmıştır.
- Sonraki aşama CTA'sı içerik sonunda, yalnız uyumlu tamamlanmış upstream
  çıktıyla görünür; Run/Re-run çalışma alanında kalır.
- README ürün tanımı, AGENTS ajan çalışma kuralları, PROJECT_STATE güncel durum
  özetidir. Ayrıntılı geçmiş Git'tedir; bu dosya görev günlüğü değildir.

## Recently Completed

- Takılmış ağır işler için zaman aşımı ve expired retry admission düzeltmesi
  `51b9459` ile main'e alındı. Bu kayıt kendi başına production release kanıtı değildir.
- Public-beta UI polish yerel çalışma ağacında: ilk kullanım ve örnek PDF akışı,
  TR/EN login anlatımı, Build aksiyon/engelleyici metinleri, Playground citation
  ve Source Inspector kanıt sırası, Evaluation hazırlık durumu. Seeded görsel ve
  etkileşim doğrulaması gerçek provider kalite kanıtı sayılmaz.
- Post-release hardening PR #100 (`93d76ac`) ile main'e merge edilip normal
  release workflow'u üzerinden yayımlandı: Next.js security patch'i, production
  dependency audit kapıları, haftalık bounded Dependabot, güvenilmeyen retrieval
  context prompt sınırı, chunk lineage fingerprint'i, opt-in benchmark evaluation
  ve kullanıcı başına durable ağır iş admission'ı eklendi.
- Doküman silme private Storage cleanup'ı transaction-backed outbox ile eventual
  ve idempotent hale getirildi; migration production'a uygulandı. İki eski
  inspection E2E beklentisi mevcut ürün davranışına göre düzeltildi.

- Fonksiyonel/OCR remediation için önceki production kabul kanıtı `f954a53`
  release'inde tamamlandı: hosted parse/chunk/embed lineage'i
  (`a37f7ebe-8587-4153-9cf9-e440328fc13b`, parse
  `18aeddd7-2b9b-4a5b-81cb-2d0fa6f5fd53`) ile 14 soruluk koşuda B1 OCR,
  yapısal parse, retrieval, reranking ve abstention doğrulandı; grounding
  sayı/tarih kusuru düzeltildi. Güncel hardening release'i Modal'da
  `93d76ac`, Vercel production main deployment'ı `a16e2e6` ile izlenir.
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

Public-beta UI polish yerel feature branch'te tamamlandı; push, merge ve deploy
yapılmadı. TR/EN, tema, responsive ve seeded visual kontrolleriyle
doğrulanıyor; hosted provider veya production corpus kalite koşusu yapılmadı.

## Next

Tam yerel polish doğrulamasını bitirip değişiklikleri gözden geçirmek; ardından
normal PR/release kararı ve gerçek kullanıcı geri bildirimi. Yeni OCR kalite ölçümleri yalnızca
etiketli örnekler ve açık kapsam kararıyla genişletilecek.

## Open Questions

Türkçe OCR için confidence dağılımı ve kabul/insan inceleme eşiği daha geniş,
etiketli bir corpus ile ölçülmedi; mevcut metadata tanısal görünürlük sağlar,
otomatik filtre uygulamaz.
4 GiB hosted worker'da 28 sayfalık stress PDF tamamlandı ancak 3472,25 MiB peak
RSS yalnız yaklaşık %15 bellek payı bırakıyor. Yeni kaynak artışı yapılmadı;
daha büyük ve görsel-yoğun fixture matrisi olmadan daha geniş güvenli zarf iddiası
yapılmamalıdır.
