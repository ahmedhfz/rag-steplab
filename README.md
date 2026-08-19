# RAG StepLab

RAG StepLab, Retrieval-Augmented Generation sistemlerini adım adım öğrenmek ve deneylerle incelemek için geliştirilen görsel, etkileşimli bir learning laboratory projesidir. Bir SaaS veya ürün prototipi değildir.

## Kimler için?

RAG'e yeni başlayan ve parsing'den generation'a kadar pipeline'ın her aşamasında ne olduğunu görmek isteyen geliştiriciler içindir.

## Burada ne öğrenilebilir?

- document ingestion, parsing ve chunking
- embeddings, indexing ve vector search
- retrieval, Top-K, hybrid search ve reranking
- context construction, generation, grounding ve citations
- retrieval ve answer evaluation
- tracing, karşılaştırma ve observability

Amaç yalnızca sonuç üretmek değil; kullanılan ayarların, ara çıktıların ve ölçümlerin sistem davranışını nasıl değiştirdiğini görünür kılmaktır.

## Mevcut durum

Frontend learning UI ve ilk gerçek parsing backend'i hazırdır:

- **Overview / Pipeline:** RAG akışının adımlarını ve durumlarını gösterir.
- **Documents / Parsed Content / Chunks:** PDF seçildikten ve parse tamamlandıktan sonra gerçek Docling structured, Markdown ve JSON çıktısını gösterir; chunk ekranı sonraki aşama için kilitlidir.
- **Retrieval Playground:** Retrieval parametrelerini hazırlayan, sonuç/answer/trace alanlarını gerçek entegrasyona kadar boş tutan arayüzdür.
- **Evaluation:** Gerçek evaluation dataset ve sonuçları için empty-state foundation sağlar.
- **Settings:** İngilizce / Türkçe dil, teknik detay seviyesi ve öğrenme ipuçlarını yönetir.

Uygulama sahte doküman, chunk, retrieval sonucu, skor, cevap veya evaluation metriği göstermez. PDF seçimi frontend'de doğrulanır; **Parse Document** gerçek `FastAPI → Docling` endpoint'ine gönderir. Backend yalnızca Document → Parse aşamasını kapsar; database, chunking, embeddings ve sonraki RAG aşamaları henüz uygulanmamıştır.

## Local parse backend

Backend `backend/` altında bulunur ve `POST /documents/parse` endpoint'ini sağlar. Kurulum ve çalıştırma adımları için [backend/README.md](backend/README.md) dosyasına bakın.

```text
PDF upload → FastAPI validation → Docling conversion → normalized response
```

Backend virtual environment bir kez kurulduktan sonra proje kökünde tek komut yeterlidir:

```powershell
npm run dev
```

Bu komut Next.js'i `http://localhost:3000`, FastAPI'yi `http://127.0.0.1:8000` üzerinde birlikte başlatır. Yalnız frontend gerektiğinde `npm run dev:frontend` kullanılabilir.

## Learning roadmap

1. RAG fundamentals
2. Ingestion, parsing ve chunking
3. Embeddings ve vector search
4. Retrieval experiments
5. Hybrid retrieval ve reranking
6. Context construction, generation ve citations
7. Evaluation ve comparison
8. Tracing ve observability
9. Advanced RAG experiments

Detaylı proje bağlamı ve çalışma ilkeleri `AGENTS.md` içindedir.
