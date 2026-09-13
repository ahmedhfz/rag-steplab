# OCR regresyon örnekleri

30 gerçek crop, kullanıcı tarafından verilen `Gundelik_Yasam_RAG_Stress_Test_28_Sayfa.pdf`
(SHA256 `6f25695b5e33beb007d0cf0aff66fff08ac3cffcd4a281c780416633e95bd8a4`),
7. sayfadaki altı resim bölgesinden alınmıştır. Crop sınırları `samples.json`
içindedir. Tam PDF repository'ye eklenmez.

36 sentetik crop, Arial 16/24/32 px ile üretilmiştir. Ground truth elle
doğrulanmıştır; örnekler her çalışmada yeniden çizilmez. Türkçe harfler ve kısa
kodlarda yanlış çıktılar confidence değerleriyle raporlanır, düzeltilmez.

`python scripts/benchmark_ocr.py --output result.json` gerçek modellerle
opt-in çalışır. Deterministik metin karşılaştırması ölçüm sağlar; tüm örneklerin
kusursuz okunması beklenmez. Bilinen `ton balığı → ton baliğı` ve `I/1/l`
sınırlamaları sözlük düzeltmesiyle gizlenmez.
