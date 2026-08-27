# Figma golden visual parity akışı

Bu akış, canonical Figma `Go1p5jJ4CrtVfhoOa7pSic` dosyasındaki 18 masaüstü state'i iki ayrı kontratla doğrular: provider'sız statik golden clone, ardından gerçek seeded production route smoke/geometry gate'i. Golden fixture üretim arayüzü değildir; Figma'dan tarayıcıya aktarımın yapısal olarak kaymadığını kanıtlayan test altyapısıdır.

## Canonical state kapsamı

`4:147` Overview için mevcut PR #66 kontratı korunur. Diğer 17 node için `public/__visual__/figma-canonical.html?screen=...` altında provider/API kullanmayan statik clone bulunur:

```text
documents-populated
parsing-result
chunking-config / chunking-result
embeddings-ready / embeddings-result
playground-empty / playground-retrieval / playground-context / playground-answer
evaluation-dataset / evaluation-results / evaluation-compare
settings
auth-login / auth-signup / auth-forgot
```

Üretim state gate'i `e2e/visual/figma-production.spec.ts` ile gerçek seeded data üzerinde `/`, `/documents`, `/parse`, `/chunking`, `/embeddings`, `/playground` Answer ve Evaluation Dataset/Results/Compare sekmelerini dolaşır. Seed fixture yalnız davranış ve lifecycle doğrulaması içindir; Figma mock verisi production UI'a aktarılmaz.

## Canonical kontrat

- Figma node: `4:147`
- Viewport ve reference PNG: `1441 × 1041`, device scale factor `1`
- Fontlar: yerel Geist Sans; yalnız `Prepare / Test / Measure` düzlem etiketlerinde Geist Mono
- Pixel metriği: RGB kanallarının ortalama mutlak farkı (MAE). Aynı Windows Chromium koşusunda `2.9754` ile ana `≤3.5` hedefi korunur. Ubuntu CI Chromium, aynı geometri ve assetlerle yalnız glyph rasterizasyon kenarlarında `3.6501` üretir; bu kanıt nedeniyle cross-platform merge gate üst sınırı en küçük güvenli payla `3.7`'dir.
- Changed-pixel metriği: herhangi bir RGB kanalındaki mutlak fark `20` değerini aşan piksel yüzdesi. Bu değer bir “parity yüzdesi” değil, regresyon tanı metriğidir.
- Geometri toleransı: her test edilen `x`, `y`, `width`, `height` için `±1px`

Figma'da ölçülen ana geometri:

| Alan | x | y | genişlik | yükseklik |
| --- | ---: | ---: | ---: | ---: |
| AppShell | 0 | 0 | 1441.449 | 1040.856 |
| Sidebar | 0 | 0 | 247.990 | 1040.856 |
| Main Content | 247.990 | 0 | 1193.459 | 1040.856 |
| Page Header | 288.219 | 40 | 1113 | 82 |
| Continue | 288.219 | 150 | 1113 | 77.424 |
| Journey | 317.931 | 307.136 | 1054 | 216 |
| Prepare | 342.965 | 323.136 | 441 | 192 |
| Test | 794.287 | 323.136 | 428 | 192 |
| Measure | 1232.740 | 323.136 | 114 | 192 |
| Current Setup | 288.219 | 576.848 | 615.788 | 277.761 |
| Recent Activity | 928.007 | 576.848 | 473.671 | 277.761 |
| Why this matters | 288.219 | 878.848 | 1113 | 97 |

Dokuz journey node'u `40 × 40px` boyutunda ve Figma'nın sabit koordinatlarında tutulur. Eğri ve tamamlanmış segmentler elle normalize edilmez; Figma'nın `4:329` export'u olan yerel `icon.svg` kullanılır. Diğer ikonlar da aynı design-context çağrısının gerçek SVG export'larıdır.

## Çalıştırma

```bash
npm run e2e:visual
npm run e2e:visual:canonical
npm run e2e:visual:production
```

Test şu sırayı uygular:

1. İzole `/__visual__/figma-overview.html` fixture'ını açar.
2. Viewport'u `1441 × 1041` olarak doğrular.
3. `document.fonts.ready` ile yerel Geist fontlarını, ardından tüm yerel SVG'leri bekler.
4. Ana bölgeleri ve dokuz journey node'unu `getBoundingClientRect()` ile doğrular.
5. Ekran görüntüsünün gerçek PNG boyutunu doğrular.
6. Canonical Figma PNG ile Playwright snapshot karşılaştırmasını ve MAE tanısını çalıştırır.
7. Canonical golden `e2e/visual/reference/overview-4-147.png` dosyasıdır. Actual, diff ve JSON metriklerini `output/playwright/figma-visual/` altında üretir. Karşılaştırma helper'ı `e2e/visual/figma-visual-diff.mjs` altında tutulur; bu yollar CI tarafından frontend/E2E olarak sınıflandırılır.

Cross-platform `3.7` limiti yapısal toleransı gevşetmez. CI artifact incelemesinde `1441 × 1041` boyut ve bütün geometri assertion'ları geçti; fark görüntüsü yalnız metin glyph kenarlarında yoğunlaştı. Alan konumu veya boyutu değişirse `±1px` geometri kapısı, görsel dağılım değişirse Playwright snapshot kapısı bağımsız olarak testi kırar.

`npm run e2e:smoke`, mevcut seeded smoke suite'inden sonra Overview kontratını çalıştırır. CI ayrıca `e2e:visual:canonical` ve `e2e:visual:production` komutlarını çalıştırır. Statik gate fixture navigasyonuna bağlı değildir; Supabase, Modal veya `DocumentPipelineProvider` çağırmaz. Production gate gerçek seeded API route interception'ı ile state erişimini ve desktop shell/page geometry'sini doğrular.

## Her ekran için zorunlu sıra

```text
Figma canonical node
→ statik near-literal fixture
→ exact viewport
→ exact local assets
→ geometry assertions
→ screenshot diff
→ hierarchy freeze
→ state adapter
→ runtime state derivation
→ responsive pass LAST
```

Golden fixture görsel kontrattır. Üretim UI'sı değildir ve gerçek veriyi taklit etmek için genişletilmemelidir. State adapter'lar domain değerlerini bu hierarchy içindeki presentation slotlarına taşır; provider davranışının yerini almaz.

## Overview üretim mimarisi

Overview için gerçek entegrasyon sınırı:

```text
DocumentPipelineProvider
        ↓
OverviewViewModel / Adapter
        ↓
Figma-derived Presentation View
```

Adapter `documentName`, `continueLabel`, `continueHref`, `stageStates`, `currentSetup`, `recentActivity`, `pipelineName` ve `nextAction` gibi gerçek değerleri önceden sabitlenmiş Figma slotlarına vermelidir. Adapter hierarchy'yi, journey koordinatlarını veya ana bölge geometrisini yeniden tasarlamamalıdır. Runtime empty/loading/error/reuse durumları bu presentation view üzerinde ayrı ve ölçülebilir türevler olarak eklenir; responsive uyarlama en son yapılır.
