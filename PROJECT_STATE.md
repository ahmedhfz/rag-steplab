# Proje Durumu

Bu dosya gelecekteki kararları etkileyebilecek çözülmemiş kalite ve kapasite
kanıtlarını tutar. Canlı deployment veya servis sağlığı raporu değildir; güncel
davranışı kod, yapılandırma ve release kanıtından doğrulayın.

## Açık kanıtlar

- OCR confidence değeri doğruluk olasılığı değil, tanısal bir skordur. Etiketli
  bir corpus Türkçe OCR için güvenilir kabul eşiği belirlememiştir.
- Önceki proje notunda, 4 GiB worker ile çalışan 28 sayfalık stress PDF için
  3472,25 MiB peak RSS ölçümü kaydedilmiştir. Bu tarihsel ölçüm daha büyük veya
  görsel yoğunluğu yüksek PDF'ler için güvenli bir sınır oluşturmaz; böyle bir
  iddia öncesinde daha geniş ve temsili benchmark gerekir.
- Docling `2.117.0`'da tutuluyor: bu sürümün on advisory'si CI audit'inde
  gerekçeli muaf (`docs/deployment.md`). Düzeltilmiş 2.132.0/2.135.0 sürümleri
  TR örnek PDF'inin 4. sayfasında ham çıktıda iki paragraf kaybettiği için
  alınmadı. 2.140.0 metni koruyor ama TR örnekte paragrafları cümle ortasından
  bölüyor. Yeni Docling sürümü içerik ve paragraf sınırlarını koruduğu
  doğrulanınca muafiyet kaldırılmalıdır.
