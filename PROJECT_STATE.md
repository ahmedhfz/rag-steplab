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
