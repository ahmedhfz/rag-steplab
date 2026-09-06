# RAG StepLab

## Amaç ve sahiplik

RAG StepLab, retrieval-augmented generation pipeline'ını öğrenmek ve deneysel
olarak incelemek için educational developer tool'dur. Frontend, FastAPI/RAG
Core, Supabase persistence ve provider/worker sınırları ayrı tutulur; yeni
özellik bu öğrenme ve gözlemlenebilirlik amacına somut katkı sağlamalıdır.

## Kaynaklar ve yönlendirme

Klasör yapısı ve script'ler için `package.json`, kullanıcı akışları için
`README.md`, backend kurulumu için `backend/README.md`, deployment için
`docs/deployment.md`, migration otoritesi için `docs/architecture/migrations.md`
kanoniktir. Path-aware validation yönlendirmesi
`.github/scripts/classify-changes.mjs`, `.github/workflows/ci.yml`,
`.github/workflows/release.yml` ve ilgili E2E workflow'larındadır. Tarihli
durum belgeleri kod, manifest veya workflow ile çelişirse bağlam olarak
değerlendirilir; güncel kaynak yeniden okunur.

Backend işlerinde `backend/AGENTS.md`, database işlerinde `supabase/AGENTS.md`
okunur. Repository becerileri `.agents/skills/` altında tek kopya tutulur:
`modal` Modal operasyonları, `motion` animasyon işleri, `rag-e2e-validation`
E2E profil/hedef seçimi içindir. `.codex/config.toml` yalnız Codex MCP ayarını taşır.

## Mimari ve doğruluk sınırları

- Gerçek provenance korunur: sahte doküman, chunk, skor, cevap veya progress
  gösterilmez. Gerekli aktif upstream lineage yoksa aksiyon disabled olur ve
  kullanıcıya nedeni görünür.
- Inspect ile use akışlarını ayırın. Saved pipeline ve document-scoped
  lineage kanonik kimliktir; reparse/rechunk veya başarısız upstream sonrası
  stale downstream çıktıları geçersiz kılınır.
- Auth ve owner isolation persistence katmanında gerçektir; kullanıcıya ait
  olmayan belge, pipeline veya run'a erişim eklenmez. Provider, worker ve
  storage sorumluluklarını UI'ya taşımayın; RAG Core sınırını koruyun.
- Görünüm tercihlerinde `PreferencesProvider` tek kaynaktır. Tema varsayılanı
  `System` olup `Light` ve `Dark` seçeneklerini, versioned storage migration'ını
  ve hydration öncesi root bootstrap'ını birlikte koruyun.

## Validation ve E2E sınırları

`package.json` script'leri ve classifier'ın seçtiği CI gate'leri kullanın;
seeded smoke, auth ve full provider E2E profillerini birbirine karıştırmayın.
Seeded/deterministic suite üretim provider/corpus kalitesini kanıtlamaz. Hosted
Docling/Modal/Gemini zinciri pahalı ve yetkili bir full E2E/release doğrulamasıdır;
production cleanup yalnız namespaced dedicated hesap, owner filtresi ve açık
cleanup kilidi birlikte sağlanırsa yapılır.

## Deployment ve dış durum

Supabase migration, Modal deploy ve Vercel/release işlemleri yalnız ilgili
workflow'un veya açık operasyon yetkisinin kapsamındadır. Docs-only değişiklik
runtime, provider, database veya production state mutation gerektirmez.

## Kanonik dokümantasyon

Genel ürün sınırları `README.md`; backend ayrıntıları `backend/README.md`;
deployment ve migration kararları `docs/deployment.md` ile
`docs/architecture/migrations.md` içindedir. Bu belgede geçici ekran
envanteri, roadmap snapshot'ı veya sürüm listesi tutulmaz.
