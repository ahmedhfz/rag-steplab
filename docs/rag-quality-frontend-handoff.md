# RAG quality backend → frontend handoff

Bu not backend quality audit değişikliklerinin frontend worktree'sine aktarılması
içindir. Bu worktree'de UI redesign yapılmadı.

## API kontratı

- `EvaluationCase.expectedOutcome` değerleri `answer` (varsayılan) veya
  `insufficient_context` olabilir.
- Relevant element ID'si olmayan bir no-answer case için
  `expectedOutcome: "insufficient_context"` gönderilmelidir.
- Boş context generation sonucunda backend `insufficientContext: true`,
  `answer: ""`, boş `segments` ve boş `citations` döndürür; backend locale
  mesajı üretmez. Görsel açıklama frontend locale katmanına aittir.
- No-answer case'lerde `hitAtK`, `precisionAtK`, `recallAtK` ve `mrr` `null`
  olur ve aggregate retrieval ortalamasına girmez. `abstentionCorrect` ve
  aggregate `abstentionAccuracy` ayrı değerlendirilir.
- `citationValidity.method = "context_id_membership_v1"` yalnız citation ID'si
  verilen context içinde var mı sorusunu cevaplar; claim entailment veya
  faithfulness değildir.

## Reranker

- `rerankRank` / `rank`, Gemini listwise sıralamasındaki gerçek ordinal
  pozisyondur.
- `rerankScore` geriye dönük uyumluluk için tutulur ve
  `rerankScoreSemantics = "deprecated_ordinal_not_confidence"` ile işaretlenir.
  Model confidence, probability veya calibrated relevance score gibi
  etiketlenmemelidir.
- Yeni frontend göstergesi `rerankRank` kullanmalı; `rerankScore` yalnız
  teknik compatibility/debug ayrıntısı olarak kalmalıdır.

## Dataset admission

- Varsayılan `evaluationMode: "interactive"` en fazla 10 case kabul eder.
- Bounded backend benchmark için `evaluationMode: "benchmark"` en fazla 200
  case kabul eder. Bu sınır production maliyetini kontrol etmek içindir; UI
  interaktif akışında 200 case seçeneği açılmamalıdır.

## Frontend yapılacaklar

1. Evaluation dataset formuna no-answer case oluşturma yolu ekle; bu durumda
   relevant element ID zorunluluğunu kaldır ve `expectedOutcome` gönder.
2. Evaluation ekranında null retrieval metriklerini `0` gibi göstermeden
   `N/A`/`—` göster; yanında retrieval-eligible case sayısını göster.
3. `abstentionAccuracy` ve no-answer case tanısını ayrı bir answer/abstention
   metriği olarak göster.
4. Reranker tablosunda `rerankRank` kullan; eski `rerankScore` başlığını
   confidence/score olarak kullanma.
5. `answer === ""` ve `insufficientContext === true` birlikte geldiğinde
   locale'a göre açıklama göster; boş domain answer'ı doğrudan kullanıcıya
   anlamlı mesaj gibi sunma.

Bu değişiklikler için seeded fast E2E'de en az bir no-answer dataset sonucu,
null retrieval metriği ve rerank rank semantiği assertion'ı eklenmelidir.
