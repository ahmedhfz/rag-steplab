---
name: rag-e2e-validation
description: RAG StepLab E2E profile/target selection and execution evidence for auth, critical flows, production React visuals or hosted full-RAG verification. Not for docs-only edits, standalone unit tests or inventory listing alone.
---

# RAG E2E Validation

Komutlar `package.json`, projeler `playwright.config.ts`, CI seçimi
`.github/scripts/classify-changes.mjs` ve `.github/workflows/ci.yml` içindedir.
Bu skill mevcut script'leri kullanır; ayrı runner veya fixture sistemi oluşturmaz.

## Profil seçimi

| İstenen kanıt | Mevcut komut | Sınır |
| --- | --- | --- |
| Dar UI/contract akışı | `npm run e2e:smoke -- <spec>` | Seeded API, gerçek dedicated auth |
| Kritik akışlar | `npm run e2e:critical` | Seeded kritik alt küme |
| Auth değişikliği | `npm run e2e:auth` | Gerçek auth işlemleri |
| React görsel/geometri regresyonu | `npm run e2e:visual:production` | Seeded API; [visual runbook](../../../docs/production-visual-regression.md) |
| Gerçek provider pipeline | `npm run e2e:full` | Hosted veri ve provider maliyeti, tek worker |

Küçük UI değişikliği full-RAG gerektirmez. Seeded/visual başarı gerçek Docling,
Gemini veya corpus kalitesi kanıtı değildir. Görsel baseline güncellemesi yalnız
bilinçli tasarım değişikliği kapsamında yapılır; başarısız testi geçirmek için yapılmaz.

## Hedef ve hazırlık

1. Değişiklik etkisini ve istenen kanıtı seçin. Yerel, Preview ve production
   hedeflerini `E2E_BASE_URL`, `E2E_API_BASE_URL`, Supabase hedefi ve test hesabıyla
   birlikte değerlendirin; localhost frontend hosted API/auth kullanabilir.
2. Credential **adlarını** README'den kontrol edin; değerleri yazdırmayın.
   `e2e:bootstrap`/`e2e:user` dış kullanıcı state'ini değiştirebilir. Mevcut hazır
   hesabı kullanın; eksik setup yeni operasyon yetkisi olmadan çalıştırılmaz.
3. Deployment doğrulaması isteniyorsa SHA ve hedef URL ilişkisini doğrulayın.
   Manual Heavy validation non-full profiller için exact Vercel deployment arar;
   full-RAG sabit production URL kullanır. Seçili ref canlı SHA kanıtı değildir.
4. Auth state ve raporlar ignored `output/playwright/` altında kalır; `.auth/`
   artifact paylaşımına dahil edilmez. Ayrıntılar [README](../../../README.md)
   ve `.github/workflows/e2e-full.yml` içindedir.

## Hosted full-RAG

Yalnız mevcut hedef/işlem yetkisiyle ilerleyin. `scripts/e2e.mjs` cleanup guard'ı
production target beyanı, `E2E_ALLOW_PRODUCTION_CLEANUP=true`, dedicated
`test_account` marker'ı ve authenticated owner API'sini birlikte kullanır.
Yalnız `e2e-` filename namespace'i silinir. Guard'ı aşmayın veya service-role
ile genel silme eklemeyin.

Runbook'taki sırayı kullanın: yetkili namespaced cleanup → tek-worker full-RAG
→ başarısızlıkta da namespaced cleanup. Guard veya cleanup başarısızsa kapsamı
büyütmeden kalan durumu raporlayın. Her full testin kendi verisini otomatik
sildiğini varsaymayın. Semantic PDF smoke başka bir prosedürdür; ayrıntılar
[deployment runbook](../../../docs/deployment.md) içindedir.

## Tamamlama kanıtı

Seçilen profil/spec, hedef ve doğrulanabildiyse SHA, test sonucu ve artifact
konumunu raporlayın. Hosted koşuda namespace/cleanup sonucunu ayrıca belirtin.
Çalışmayan veya bloklanan katmanları açıkça ayırın; yerel/mock sonuçlarını canlı
başarı olarak sunmayın.
