# Project State

Last updated: 2026-09-12

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

None

## Next

None

## Open Questions

None
