# RAG StepLab — Project Context

## Project Purpose

RAG StepLab, Retrieval-Augmented Generation öğrenmek isteyen kişiler için geliştirilen görsel ve etkileşimli bir **educational developer tool / RAG learning laboratory** projesidir.

Bu repository'nin ana amacı bir SaaS, enterprise product veya production uygulaması geliştirmek değildir. Amaç; RAG sisteminin parsing, chunking, embedding, indexing, retrieval, reranking, context construction, generation, citation ve evaluation aşamalarını anlaşılır, incelenebilir ve deney yapılabilir hâle getirmektir.

Kullanıcılar zamanla:

- RAG akışını adım adım görsel olarak takip edebilmeli,
- farklı ayar ve modelleri kontrollü biçimde deneyebilmeli,
- sonuçları ölçüp karşılaştırabilmeli,
- retrieval ve generation davranışının neden değiştiğini inceleyebilmeli,
- sistemin her aşamada hangi input'u alıp hangi output'u ürettiğini görebilmelidir.

Auth, billing, multi-tenancy, müşteri kurulumu, enterprise deployment veya action-taking agent özellikleri bu repository'nin learning roadmap'inin parçası değildir. Yeni bir çalışma, yalnızca RAG öğrenme ve deney hedeflerine somut katkı sağlıyorsa kapsama alınmalıdır.

## Current State

```text
Phase 1–7 — First Complete Learning Pipeline
Status: Persistent Document → Parse → Chunk → Retrieve → Generate → Evaluate flow ready
```

Şu anda:

- Next.js tabanlı frontend learning UI hazırdır.
- Overview / Pipeline ekranı vardır.
- Documents / Chunks ekranı vardır.
- Retrieval Playground ekranı vardır.
- Evaluation ve Settings ekranları vardır.
- Gerçek veri bulunmayan alanlar sahte sonuç üretmeden empty state gösterir.
- Lokal PDF seçimi, drag-and-drop, dosya tipi ve boyut doğrulaması frontend seviyesinde çalışır; Parse Document seçildiğinde PDF FastAPI backend'ine gönderilir.
- İngilizce / Türkçe arayüz ve frontend öğrenme tercihleri tarayıcıda lokal olarak saklanır.
- `POST /documents/parse`, PDF'i Docling ile parse eder ve normalized structured, Markdown, JSON ve summary response döndürür.
- PDF, private Supabase Storage'da; parse/chunk/embedding/experiment/evaluation lineage'ı PostgreSQL'de kalıcıdır.
- Üç gerçek chunking stratejisi, Gemini Embedding 2 + pgvector, PostgreSQL FTS, RRF hybrid retrieval ve optional Gemini reranking çalışır.
- Context construction, grounded generation, backend-doğrulamalı citations ve ölçülebilir evaluation sonuçları UI'da görünürdür.
- Refresh persistence ile reparse/rechunk stale invalidation davranışı uygulanmıştır.

Henüz:

- auth, billing ve multi-tenancy yoktur; bunlar learning roadmap'inin parçası değildir,
- queue/worker veya yüksek trafik ölçekleme katmanı yoktur,
- ANN/HNSW, semantic/parent-child chunking ve advanced RAG experiment'leri henüz yoktur,
- kapsamlı tracing/telemetry persistence henüz yoktur.

Hiçbir aşama fake processing, fake score veya fake answer çalıştırmamalıdır. Gerekli aktif upstream lineage yoksa aksiyon açıkça disabled olmalı ve neden kullanılamadığı kullanıcıya gösterilmelidir.

## Learning Roadmap

Roadmap ürün fazları değil, birbirini destekleyen öğrenme ve deney alanlarıdır:

1. **RAG fundamentals:** Temel pipeline, veri akışı, grounding ve retrieval-generation ilişkisi.
2. **Ingestion / parsing / chunking:** Doküman alma, yapısal parsing, chunk size, overlap ve chunk kalite analizi.
3. **Embeddings / vector search:** Vector representation, indexing, similarity ölçümleri ve dense search.
4. **Retrieval experiments:** Top-K, metadata filtering, query varyasyonları ve retrieval sonuçlarının karşılaştırılması.
5. **Hybrid retrieval / reranking:** Sparse retrieval, BM25, hybrid search, fusion yöntemleri ve reranker deneyleri.
6. **Context construction / generation / citations:** Context seçimi ve sıralaması, LLM generation, grounding ve kaynak gösterimi.
7. **Evaluation and comparison:** Golden datasets, Recall@K, Precision@K, MRR, answer quality ve faithfulness karşılaştırmaları.
8. **Tracing / observability:** Pipeline adımlarını, süreleri, input/output'ları, token kullanımını ve hataları görünür kılma.
9. **Advanced RAG experiments:** Parent-child retrieval, query rewriting, gelişmiş chunking ve benzeri teknikleri ölçülebilir deneylerle ekleme.

Her aşamada önce en basit çalışan mekanizma kurulmalı; yeni teknikler ölçüm veya öğrenme ihtiyacı doğrulandığında eklenmelidir.

## Technology Direction

Mevcut frontend:

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
```

Gerçek RAG pipeline için planlanan başlangıç yönü:

```text
Python
FastAPI
PostgreSQL
pgvector
Docling
Gemini API / Google GenAI SDK
pytest
```

Backend ve RAG teknolojileri ilk complete pipeline için kurulmuştur. Yeni dependency veya servis yalnız bu laboratuvarda hangi öğrenme veya deney problemini çözdüğü açıklanabiliyorsa eklenmelidir.

## Architecture Direction

Genel öğrenme mimarisi:

```text
Learning UI
    ↓
FastAPI
    ↓
RAG Core
    ↓
PostgreSQL + pgvector
```

RAG Core zamanla şu sorumlulukları açık ve incelenebilir biçimde barındırabilir:

- ingestion ve parsing
- chunking
- embeddings ve indexing
- retrieval ve reranking
- context construction
- generation ve citations
- evaluation ve tracing

UI yalnızca sonuç ekranı olmamalıdır; mümkün olduğunca ara adımları, kullanılan ayarları, üretilen verileri ve ölçümleri görünür kılmalıdır. RAG Core, UI ve infrastructure detaylarından makul ölçüde ayrılmalı; ancak gerçek ihtiyaç oluşmadan generic factory, provider manager veya universal adapter gibi katmanlar oluşturulmamalıdır.

## Engineering Principles

- Her task öncesinde mevcut proje yapısını ve ilgili dosyaları incele.
- Kullanıcının verdiği scope dışına çıkma.
- Öğrenilebilirlik, açıklık ve teknik doğruluğu önceliklendir.
- Önemli RAG mekanizmalarını gereksiz framework abstraction'ları arkasında gizleme.
- UI'da pipeline'ın iç işleyişini, ara sonuçlarını ve kullanılan ayarları mümkün olduğunca görünür hâle getir.
- Her teknik özellik için “Hangi problemi çözüyor?” sorusunun net bir cevabı olmasını bekle.
- Retrieval ve generation davranışını ölçülebilir, karşılaştırılabilir ve regression testlerine uygun tasarla.
- Mock ile gerçek implementation'ı isimlendirme, yapı, davranış ve dokümantasyonda açıkça ayır.
- Minimal scope'u koru; premature abstraction ve architecture expansion yapma.
- Gereksiz refactor veya kullanılmayan dependency ekleme.
- Kod okunabilirliğini clever abstraction'lardan önde tut.
- Yeni bir model, dependency veya framework'ü yalnızca popüler ya da industry standard olduğu için ekleme.
- RAG Core ile application ve infrastructure sorumluluklarını gereksiz biçimde karıştırma.
- Alternatifleri ve trade-off'ları gerektiğinde açıkça belirt.
- Kullanıcının önerdiği yaklaşım teknik olarak zayıf, riskli veya gereksiz karmaşıksa sessizce uygulama; nedenini açıkla ve daha iyi yaklaşımı öner.
- Değişiklik sonrası kapsama uygun test, lint, typecheck veya build kontrollerini çalıştır.
- Secret, kişisel veri, raw document content ve hassas log verilerini güvenli şekilde ele al.

## Learning Principle

Yeni bir RAG kavramı veya teknik özellik eklendiğinde mümkün olduğunca şu sorular cevaplanabilmelidir:

1. Bu kavram nedir?
2. Hangi problemi çözüyor?
3. Sistemin hangi aşamasında kullanılıyor?
4. Input ve output'u nedir?
5. Kullanılmazsa ne olur?
6. Alternatifleri nelerdir?
7. Trade-off'u nedir?
8. Etkisi nasıl ölçülür veya karşılaştırılır?

Implementasyon, UI ve dokümantasyon bu yanıtları görünür kılmalıdır.

## Secrets

- API key, token, service role key veya başka bir secret source code'a yazılmamalıdır.
- Gerçek secret değerleri `AGENTS.md`, `README.md` veya tracked config içine eklenmemelidir.
- `.env` gibi secret dosyaları gerektiğinde `.gitignore` benzeri korumalara dahil edilmelidir.
- Gemini API key ileride environment variable üzerinden alınmalıdır.
- Log, test fixture, örnek çıktı veya hata mesajları secret sızdırmamalıdır.
