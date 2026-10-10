# RAG StepLab

**RAG'in her adımını gerçek dokümanınızla, kanıtıyla birlikte görün, değiştirin ve
karşılaştırın.** RAG StepLab, geliştiricilerin retrieval-augmented generation
akışını aşama aşama incelediği etkileşimli bir öğrenme laboratuvarıdır.

Canlı uygulama: <https://rag-steplab.vercel.app>

Laboratuvar; doküman alımı ve parsing, chunking ve embedding, dense/keyword/
hybrid retrieval, isteğe bağlı reranking, grounded generation, citations,
evaluation ve run karşılaştırmasını kapsar.

## Ne görürsünüz

Sol menüdeki aşamalar gerçek bir PDF üzerinde sırayla ilerler; her aşama bir
öncekinin kalıcı çıktısını kullanır.

| Aşama | Ne görürsünüz |
| --- | --- |
| Overview | Seçili dokümanın pipeline yolculuğu, sıradaki adım ve örnek PDF ile ilk deneme |
| Documents | Yüklenen PDF'ler, önizleme ve doküman yönetimi |
| Parsing | Docling sonucu: sayfalar, başlıklar, tablolar, Markdown ve kaynak bölgeleri (native/OCR provenance, tanısal OCR skoru) |
| Chunking | Strateji ve ayara göre üretilen chunk'lar ve kaynak öğelere lineage bağlantısı |
| Embeddings | Embedding çalıştırmaları ve hazır olan indeks |
| Playground | Soru sorma: dense/keyword/hybrid retrieval, reranking, context, grounded cevap ve citations |
| Evaluation | Dataset, case bazlı metrikler ve iki run'ın yan yana karşılaştırması |
| Settings | Dil (TR/EN) ve görünüm (System/Light/Dark) tercihleri |

Run'lar ve provenance oturumlar arasında korunur. Downstream sonuç ancak gerekli
upstream lineage tamamlanmış ve uyumluysa kullanılabilir; reparse veya rechunk
sonrası eski downstream çıktıları kullanılmaz.

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

## Mimari

```text
PDF → private Supabase Storage → queued parse → Modal API/worker
    → parse ve chunk lineage'ı → embeddings → retrieval/reranking
    → context ve generation → evaluation
```

Next.js arayüzü (Vercel) yalnız FastAPI RAG Core ile konuşur; FastAPI ve Docling
worker'ları Modal üzerinde çalışır, kalıcı veri Supabase PostgreSQL + pgvector ve
private Storage'dadır, embedding/generation/rerank/judge çağrıları Gemini'yedir.
Auth ve owner-scoped persistence kullanıcı verisini yalıtır. Retrieved document
metni modele verilmiş talimat değil, güvenilmeyen veridir. Kişisel veya hassas
PDF'leri public deployment'a yüklemeyin. Ayrıntılar:
[docs/deployment.md](docs/deployment.md).

## Yerel kurulum

Gereksinimler: Node.js 22 (CI'daki sürüm), Python 3.13
([.python-version](.python-version)) ve bir Supabase projesi. Uygulamadaki tüm
rotalar giriş ister; bu yüzden hosted bir Supabase projesi ya da `supabase start`
ile ayağa kalkan local stack (Supabase CLI) üzerinde Auth gerekir.

1. Frontend bağımlılıklarını kurun ve environment şablonunu kopyalayın:

   ```powershell
   npm install
   Copy-Item .env.example .env
   ```

2. `.env` içinde en az `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ile backend'in JWT doğrulaması için
   `SUPABASE_URL` değerlerini kendi Supabase projenizle doldurun.
   `SUPABASE_JWT_ISSUER` ve `SUPABASE_JWT_JWKS_URL` şablonda `<project-ref>`
   placeholder'ı taşır ve doluysa `SUPABASE_URL`'den türetilen değerlerin önüne
   geçer; bunları aynı proje adresiyle güncelleyin ya da boş bırakın. Değişken
   açıklamaları `.env.example` içindedir; secret'ları source control'a eklemeyin.
3. Backend'i kurun (virtual environment, bağımlılıklar, OCR modelleri, kalıcı
   Supabase/Gemini seçenekleri): [backend/README.md](backend/README.md).
4. Frontend ve (API adresi local ise) FastAPI'yi birlikte başlatın:

   ```powershell
   npm run dev
   ```

Uygulama <http://localhost:3000> adresinde açılır; hesap oluşturma ve giriş
Supabase Auth üzerinden yapılır. `NEXT_PUBLIC_API_BASE_URL` hosted bir API'yi
gösteriyorsa yalnız frontend başlar; seçim ayrıntıları
[backend/README.md](backend/README.md#çalıştırma) içindedir.

## Proje kaynakları

- Backend kurulumu, API ve RAG kalite sözleşmeleri: [backend/README.md](backend/README.md).
- Deployment ve production doğrulaması: [docs/deployment.md](docs/deployment.md).
- Supabase şema değişiklikleri ve migration otoritesi:
  [docs/architecture/migrations.md](docs/architecture/migrations.md).
- Test komutları ve path-aware CI seçimi: `package.json`,
  `.github/scripts/classify-changes.mjs` ve `.github/workflows/`.
- E2E profil seçimi: [.agents/skills/rag-e2e-validation/SKILL.md](.agents/skills/rag-e2e-validation/SKILL.md).
- Görsel regresyon: [docs/production-visual-regression.md](docs/production-visual-regression.md);
  animasyonlar: [docs/transitions.md](docs/transitions.md).

## Sınırlar

RAG StepLab bir öğrenme laboratuvarıdır; üretim RAG ürünü ya da doğruluk
garantisi veren bir değerlendirme sistemi değildir. OCR confidence ve
citation geçerliliği gibi skorlar tanısaldır, doğruluk kanıtı değildir.
Seeded testler hosted provider kalitesini kanıtlamaz; gerçek Docling, Gemini ve
corpus davranışı ayrı yetkili doğrulama gerektirir.
