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

İlk uçtan uca, gerçek ve kalıcı learning pipeline hazırdır:

- PDF dosyası private Supabase Storage'a yüklenir; Docling çıktısı canonical normalized element olarak PostgreSQL'e yazılır.
- `fixed_token`, `recursive_token` ve `structure_aware` chunking gerçek provenance ile çalışır.
- Gemini Embedding 2 vektörleri pgvector'da saklanır; dense, PostgreSQL FTS keyword ve RRF hybrid retrieval kullanılabilir.
- Optional Gemini reranking, görünür context construction, grounded generation ve backend-doğrulamalı citations çalışır.
- Golden evaluation dataset'leri Hit@K, Recall@K, Precision@K, MRR, citation validity ve groundedness ölçümleri üretir.
- Parse/chunk/embedding/experiment geçmişi yenilemeden sonra geri yüklenir; reparse ve rechunk eski downstream run'ları stale yapar.

Uygulama sahte doküman, chunk, skor, cevap veya evaluation metriği göstermez. Auth ve multi-tenancy bilinçli olarak kapsam dışıdır; kişisel veya hassas PDF'ler public deployment'a yüklenmemelidir.

## Backend

Backend `backend/` altında FastAPI, Docling, SQLAlchemy 2, psycopg 3 ve Alembic kullanır. Kurulum, environment ve migration adımları için [backend/README.md](backend/README.md) dosyasına bakın.

```text
PDF → Storage → Parse → Chunk → Embed → Retrieve → Rerank → Context → Generate → Evaluate
```

Backend virtual environment ve `.env` hazırlandıktan sonra proje kökünde tek komut yeterlidir:

```powershell
npm run dev
```

Bu komut Next.js'i `http://localhost:3000`, FastAPI'yi `http://127.0.0.1:8000` üzerinde birlikte başlatır. Yalnız frontend gerektiğinde `npm run dev:frontend` kullanılabilir.

Hosted Supabase → Render → Vercel akışı, environment contract, Free plan sınırları ve full RAG smoke adımları için [deployment dokümantasyonuna](docs/deployment.md) bakın.

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
