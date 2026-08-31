# Figma Overview golden-clone PoC

Bu PoC yalnızca canonical Figma dosyasındaki Overview `4:147` node'unu kanıtlar. Amaç, production Overview'ı yeniden yazmak değil; Figma frame'inden provider/backend bağımsız, deterministik bir tarayıcı fixture'ı üretip gerçek bir visual merge gate oluşturmaktır.

## Kontrat

- Figma dosyası: `Go1p5jJ4CrtVfhoOa7pSic`
- Canonical node: `4:147`
- Golden PNG: `e2e/visual/reference/overview-4-147.png`
- Static fixture: `e2e/visual/fixtures/figma-overview.html`
- Viewport: `1441 × 1041`, device scale factor `1`
- Fontlar: yerel Geist Sans; `Prepare / Test / Measure` etiketlerinde Geist Mono
- Geometry toleransı: her `x`, `y`, `width`, `height` için `±1px`
- Pixel metriği: RGB kanallarının ortalama mutlak farkı (MAE)
- Channel threshold: `20`
- MAE limiti: `≤3.7`
- Changed-pixel limiti: channel threshold'u aşan pikseller için `≤5%`

MAE ve changed-pixel değerleri mutlak bir “parity yüzdesi” değildir; rasterizasyon farklarını görünür kılan ve görsel regresyonu merge öncesi durduran tanı metrikleridir. Mevcut local Chromium baseline'ı `MAE 2.9754`, `changed pixels 4.0566%` değerindedir.

## Ölçülen ana geometri

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

Dokuz journey node'u `40 × 40px` boyutunda, Figma'nın sabit koordinatlarında ve gerçek SVG asset'leriyle tutulur. Bu static fixture curve için kendi `figma/overview/assets/icon.svg` kopyasını kullanır; production React journey ise state-aware connector'ları normalized canvas üzerinde dinamik üretir. Fixture koordinatları generic grid'e veya yuvarlanmış Tailwind aralıklarına dönüştürülmez.

## Fixture sınırı

Fixture yalnızca `e2e/visual/fixtures` altında yaşar. Production `public` yüzeyinden servis edilmez, navigation'a eklenmez ve `DocumentPipelineProvider`, Supabase, backend, Modal, zaman, random ID veya runtime state kullanmaz. Test-only asset ve fontlar da aynı fixture ağacında tutulur.

Bu nedenle fixture production view değildir. Gelecekte production entegrasyonu şu sırayı izlemelidir:

```text
DocumentPipelineProvider
        ↓
OverviewViewModel / Adapter
        ↓
Figma-derived Presentation View
```

Adapter gerçek `documentName`, `continueLabel`, `continueHref`, `stageStates`, `currentSetup`, `recentActivity`, `pipelineName` ve `nextAction` değerlerini sabitlenmiş presentation slotlarına bağlar; hierarchy veya desktop geometriyi yeniden tasarlamaz. Runtime empty/loading/error/reuse state'leri bu view üzerinde türetilir. Responsive çalışma parity kontratından sonra gelir.

## Çalıştırma

```bash
npm run e2e:visual
```

Test:

1. Fixture'ı local `file://` URL'siyle açar; uygulama server'ına ihtiyaç duymaz.
2. Browser viewport ve PNG boyutunu `1441 × 1041` olarak doğrular.
3. Yerel fontları ve bütün SVG asset'lerini bekler; harici HTTP request oluşmadığını kontrol eder.
4. AppShell, sidebar, main content, Continue, üç plane, dokuz node, curve ve alt kartların `getBoundingClientRect()` değerlerini `±1px` ile doğrular.
5. Canonical PNG'ye karşı MAE ve changed-pixel diff üretir.
6. Playwright screenshot snapshot'ı ile ikinci bir regresyon kontrolü yapar.

Actual PNG, diff PNG ve JSON metrikleri ignored `output/playwright/figma-visual/` altında üretilir. Bu artefact'lar inceleme içindir; golden referans değildir.

Gelecekteki ekranlar için zorunlu sıra:

```text
Figma canonical node
→ static near-literal fixture
→ exact viewport
→ exact local assets
→ geometry assertions
→ screenshot diff
→ hierarchy freeze
→ state adapter
→ runtime state derivation
→ responsive pass LAST
```

Golden fixture görsel kontrattır; production UI'ın yerine geçmez.
