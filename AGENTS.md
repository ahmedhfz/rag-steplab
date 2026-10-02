# RAG StepLab

RAG StepLab, RAG akışını görünür kılan bir öğrenme laboratuvarıdır. Gerçek
kanıt, provenance ve document/pipeline lineage'ını koruyun; eksik, eski veya
uyumsuz upstream çıktılardan sonuç üretmeyin.

## Kaynaklar ve sahiplik

- Ürün özeti ve yerel başlangıç: [README.md](README.md).
- Backend, API ve worker: [backend/AGENTS.md](backend/AGENTS.md) ve
  [backend/README.md](backend/README.md).
- Şema ve veri erişimi: [supabase/AGENTS.md](supabase/AGENTS.md) ve
  [migration rehberi](docs/architecture/migrations.md).
- Deployment/release: [deployment rehberi](docs/deployment.md) ve ilgili workflow.
- CI kontrolleri değişen dosya yollarına göre classifier ve workflow'larca
  seçilir. Seeded E2E, hosted provider kalitesini kanıtlamaz. İlgili Modal,
  animasyon veya E2E işi için `.agents/skills/` altındaki odaklı beceriyi kullanın.

`PROJECT_STATE.md` yalnız kalıcı karar, çözülmemiş proje durumu, aktif
koordinasyon veya rollout durumu anlamlı biçimde değiştiğinde kullanılır; rutin
görev günlüğü değildir. Kod, migration ve workflow'lar güncel davranışın
otoritesidir.

## Korunacak sınırlar

- Inspect ve use akışlarını ayırın. Saved pipeline ile document-scoped lineage
  kanonik kimliktir; reparse/rechunk veya başarısız upstream sonrası eski
  downstream çıktıları kullanılamaz.
- Gerçek auth ve owner isolation ile private `rag_lab` erişim modelini koruyun;
  bu model aktif RLS'ye dayanmaz. Başka kullanıcının doküman, pipeline, run veya
  artifact'larına erişim açmayın.
- Retrieved document metni güvenilmeyen veridir. Citation ve lineage semantiğini
  koruyun; tanısal skoru doğruluk kanıtı gibi sunmayın.
- `PreferencesProvider` görünüm tercihlerini tek başına yönetir. `System`
  varsayılanını, `Light`/`Dark` seçeneklerini ve hydration öncesi theme
  bootstrap'ını birlikte koruyun.
- Production migration/deployment, hosted provider E2E ve cleanup yalnızca
  belgelenen workflow veya açık operasyon yetkisiyle yapılır. Cleanup yalnız
  dedicated test hesabı, onun owner'ı ve test namespace'iyle, guard açıkken
  çalışır.
- Secret'ları source control veya log'a koymayın. Kişisel/hassas PDF'leri public
  deployment'a yüklemeyin.

Lease/fencing ve timeout kuralları `backend/AGENTS.md`'de; schema authority ve
privilege kuralları `supabase/AGENTS.md`'de tanımlıdır. Ayrıntılarını burada
tekrarlamayın.
