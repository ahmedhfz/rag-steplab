---
name: motion
description: RAG StepLab React arayüzünde animasyon ve geçişleri uygulama veya hata ayıklama. Genel UI değişiklikleri için kullanmayın.
---

# RAG StepLab'de motion

Bir API kullanmadan önce kurulu `motion` sürümünü ve yakındaki bileşen örneklerini
kontrol edin. React import'ları `motion/react` kullanır.

App shell'deki `MotionConfig reducedMotion="user"` davranışını ve global
`prefers-reduced-motion` stillerini koruyun. Hareket içerik gizlememeli veya bir
aksiyonu animasyona bağımlı kılmamalı; animasyon sırasında state değişebilmesini
hesaba katın.

Motion değişikliğinde etkilenen interaction ve reduced-motion yolunu ilgili dar
kontrolle doğrulayın. Browser davranışını doğrulamak gerekiyorsa repository E2E
becerisini kullanın. Animasyon işi tek başına dependency upgrade, full E2E veya
harici Motion audit gerektirmez.
