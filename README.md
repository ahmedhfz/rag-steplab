# RAG StepLab

RAG StepLab, geliştiricilerin retrieval-augmented generation akışını
incelemesi için etkileşimli bir öğrenme laboratuvarıdır. RAG aşamalarını ve
üretilen kanıtı görünür kılar; SaaS ürünü veya ürün prototipi değildir.

Laboratuvar; doküman alımı ve parsing, chunking ve embedding, dense/keyword/
hybrid retrieval, isteğe bağlı reranking, grounded generation, citations,
evaluation ve run karşılaştırmasını kapsar.

```text
PDF → private Supabase Storage → queued parse → Modal API/worker
    → parse ve chunk lineage'ı → embeddings → retrieval/reranking
    → context ve generation → evaluation
```

Uygulama Next.js arayüzü, FastAPI RAG Core, Modal worker'ları ve Supabase
persistence katmanından oluşur. Run'lar ve provenance oturumlar arasında
korunur. Downstream sonuç ancak gerekli upstream lineage tamamlanmış ve uyumluysa
kullanılabilir. Auth ve owner-scoped persistence kullanıcı verisini yalıtır.
Retrieved document metni modele verilmiş talimat değil, güvenilmeyen veridir.
Kişisel veya hassas PDF'leri public deployment'a yüklemeyin.

## İlk deneme

Giriş yaptıktan sonra Overview'da **Örnek PDF ile dene** seçeneğini kullanın
veya kendi PDF'nizi ekleyin; ardından dokümanı Parse → Chunking → Embeddings
aşamalarında işleyip Playground ve Evaluation'a geçin. `public/samples/`
altındaki TR/EN kurgusal kent bisikleti PDF'leri normal upload ve gerçek
pipeline'ı kullanır; örnek düğmesi sahte parse, chunk veya cevap üretmez. Örnek
sorular yalnız seçili dokümanın SHA-256 değeri bu dosyalardan biriyle eşleşirse
gösterilir. Parse ve sonraki provider aşamaları servis erişimi gerektirir ve
maliyet doğurabilir.

Örnek PDF'lerin deterministik üretimi ve doğrulaması için
[scripts/sample-fonts/README.md](scripts/sample-fonts/README.md) dosyasına
bakın; içerik değişirse `lib/sample-documents.ts` içindeki SHA-256 değerlerini
de güncelleyin.

## Yerelde çalıştırma

Environment ve backend bağımlılıklarını [backend/README.md](backend/README.md)
doğrultusunda hazırladıktan sonra uygulamayı başlatın:

```powershell
npm run dev
```

`NEXT_PUBLIC_API_BASE_URL` ile API hedefini seçin: hosted kalıcı veriler için
hosted API'yi, veritabanı ve verisi hazır bir local kurulum için local API'yi
kullanın.

## Proje kaynakları

- Backend kurulumu, API ve RAG kalite sözleşmeleri: [backend/README.md](backend/README.md).
- Deployment ve production doğrulaması: [docs/deployment.md](docs/deployment.md).
- Supabase şema değişiklikleri ve migration otoritesi:
  [docs/architecture/migrations.md](docs/architecture/migrations.md).
- Test komutları ve path-aware CI seçimi: `package.json`,
  `.github/scripts/classify-changes.mjs` ve `.github/workflows/`.
- E2E profil seçimi: [.agents/skills/rag-e2e-validation/SKILL.md](.agents/skills/rag-e2e-validation/SKILL.md).
