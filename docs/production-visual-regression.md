# Production React görsel regresyon kontratı

Bu kontrat mevcut production React ekranlarını gerçek route ve gerçek bileşenlerle korur. Testler yalnızca `e2e/support/seeded-api.ts` içindeki deterministic backend cevaplarını kullanır; static HTML fixture veya `public/__visual__` route'u production kanıtı sayılmaz.

## Figma dayanağı

- Dosya: `Go1p5jJ4CrtVfhoOa7pSic`
- Overview: `4:147` — `get_design_context`, screenshot ve hierarchy/geometry çağrıları başarılı.
- Playground Retrieval: `4:3703` — `get_design_context`, screenshot ve hierarchy/geometry çağrıları başarılı.

Figma node'ları yapı ve desktop geometriyi doğrular. Runtime state'in kaynağı repo sözleşmeleri ve gerçek React bileşenleridir; production ekranı static Figma clone'a çevrilmez.

## Kapsanan state'ler

`e2e/visual/production-visual.spec.ts` aşağıdaki 17 Light state'i `1441 × 1041` desktop viewport'unda çalıştırır:

- Overview: first-use/no document ve canonical active pipeline
- Documents: populated library
- Parsing: completed result
- Chunking: config/no result ve completed result
- Embeddings: ready/no result ve completed result
- Playground: Empty, Retrieval, Reranking, Context ve Answer
- Evaluation: Dataset, Results ve iki tamamlanmış run ile populated Compare
- Settings: canonical settings

Bunlara tam bir Light × Dark matrisi oluşturmadan yedi yüksek sinyalli Dark baseline eklenir:

- Overview
- Chunking config, pipeline Select portal'ı açık
- Playground Context
- Playground Answer (README Dark ekran görüntüsünün kaynağı)
- Evaluation Compare
- Settings
- Auth Login

Türkçe arayüzde dil karışımı kalmadığını görmek için iki desktop Light/TR state
(`chunking-result-tr`, `playground-answer-tr`) ve `390 × 844` mobil viewport'ta altı
state eklenir: Overview, uzun tek parça doküman adlı (`longNames`) Documents,
Parsing sonucu, Playground Answer, Evaluation Compare (Light) ve Playground Answer
(Dark). Mobil state'ler desktop geometrisi yerine drawer navigasyonu, tam genişlik
`<main>` ve taşma yok kontratını (`e2e/support/overflow.ts`: doküman kaydırması ve
öğe düzeyinde taşan/kesilen içerik) doğrular.

Aynı spec signup ve forgot-password auth ekranlarını route inventory olarak screenshot'lamayı sürdürür. Reset-password için mobil Light/TR ve desktop Dark/EN form geometrisi ve screenshot kontrol edilir; bu iki state yeni pixel baseline eklemez. Upload/dropzone, parse loading/error/retry, management, Playground aksiyonları ve auth/protected smoke mevcut seeded smoke/auth testleriyle korunur. `e2e/smoke/sample-document.spec.ts` shipped TR/EN örneklerin normal API upload'ını, seçimini, açık parse gerektirmesini ve yalnız doğru SHA-256 seçiliyken soru gösterilmesini doğrular.

First-use Overview referansı, yeni kullanıcı akışına ait kasıtlı bir ürün kararıdır; Figma'daki populated Overview node'unun birebir karşılığı olduğu iddia edilmez. Örnek PDF yüklemesi ve devamındaki işlemler mevcut gerçek doküman/pipeline sözleşmelerini kullanır.

## Geometry ve pixel gate

Tüm production state'lerde ortak shell sözleşmesi:

- sidebar: `x=0`, `width=248px`
- main: `x=248px`, `width=1193px`
- içerik başlangıcı: `x=288px`, `width=1113px`
- geometry toleransı: her ölçüm için `±1px`
- HTML `scrollWidth`: `1441px`
- PNG: `1441 × 1041`
- channel threshold: `20`

Referanslar CI ile aynı Linux/Chromium ortamında üretildiği için tüm state'lerde tek
pixel eşiği uygulanır: `MAE ≤1.5`, changed pixel `≤1.5%`. Kalan fark yalnız
rasterization gürültüsüdür; gerçek layout veya metin değişikliği eşiği aşar. Önceki
grup eşikleri (`MAE ≤3.7–5`, `≤5–8%`) Windows'ta üretilen referansların Linux farkını
karşılamak içindi. Vercel Preview araç çubuğu ve Next dev overlay screenshot
sırasında gizlenir (uygulamanın parçası değiller).

Overview journey için desktop connector ve node X koordinatları Figma'nın `1054.1 × 199.975` logical canvas'ına normalize edilir; canvas gerçek kullanılabilir genişliği doldurur, node/icon boyutları ile yaklaşık `200px` dikey geometri sabit kalır. `1440px` ve üzeri desktop varyantında Measure sağ kenara yaklaşır; daha dar viewport'larda mevcut compact journey korunur.

## Çalıştırma

```bash
npm run e2e:visual:production
```

Bu ağır suite yalnız classifier `production_visual=true` ürettiğinde PR CI'da çalışır. Tema-wide kaynaklar (`app/globals.css`, root layout, preference/theme altyapısı), görsel bileşenler ve baseline/spec değişiklikleri bu gate'i açar. Bu sınıflandırma tek başına `auth_e2e` açmaz; auth E2E yalnız auth-sensitive dosyalar değiştiğinde çalışır.

Production referanslarını yalnızca bilinçli bir baseline değişikliğinde güncelleyin.
Tercih edilen yol, referansları CI ile aynı Linux/Chromium ortamında üretmektir:
`Heavy validation` workflow'unu ilgili branch'te `production-visual-update` ile
çalıştırın; değişen/yeni/orphan PNG listesi job özetinde, üretilen referanslar
artifact'tadır. Orphan PNG'leri silin, artifact'taki dosyaları commit edin. Sıkı
eşikler Linux referansı varsayar; Windows/macOS'ta üretilen PNG commit edilmez.
Yerel üretim yalnız geçici inceleme içindir:

```bash
UPDATE_PRODUCTION_VISUAL_REFERENCES=1 npm run e2e:visual:production
```

PowerShell:

```powershell
$env:UPDATE_PRODUCTION_VISUAL_REFERENCES = "1"
npm.cmd run e2e:visual:production
```

Referans PNG'leri `e2e/visual/reference/production/` altında tracked'tir. Actual PNG, diff PNG ve JSON metrikleri ignored `output/playwright/` altında kalır. Authenticated account footer'ı screenshot'ta sabit mask ile örtülür; başka dinamik veri maskelenmez.

## Regresyon protokolü

Gate'in gerçek production bileşenini yakaladığını doğrulamak için kontrollü deney:

1. Baseline production visual gate green olmalı.
2. Gerçek React ekranında tek anlamlı layout kayması yapılmalı.
3. İlgili state gate'i geometry veya pixel diff ile fail olmalı.
4. Değişiklik geri alınmalı.
5. Aynı state yeniden çalıştırıldığında gate green olmalı.

Bu deney static fixture üzerinde yapılmaz ve kalıcı görsel değişiklik üretmez.
