# RAG StepLab Database

## Migration otoritesi

Şema için tek aktif otorite Supabase CLI ve `supabase/migrations/` dizinidir.
Alembic yalnız tarihsel Git geçmişindedir; aktif dosya veya çalıştırılabilir
migration otoritesi değildir. Migration geçmişini yeniden yazmayın veya paralel bir
history başlatmayın.

## Yerel migration akışı

Yeni migration ve local doğrulama sırası:

```powershell
supabase migration new <name>
supabase start
supabase db reset --local --no-seed
supabase test db --local
supabase db lint --local --schema rag_lab --fail-on error
node scripts/check-migration-authority.mjs
```

Baseline/history repair yalnız belgelenmiş mevcut hosted state için istisnadır;
baseline migration'ı production DDL'ı yeniden çalıştırmak için kullanmayın.
Local state'in hosted state ile aynı olduğunu varsaymayın.

## Dış durum sınırları

Production `supabase db push --linked` yalnız release workflow'u veya açık
operasyon yetkisi kapsamında çalıştırılır. Database password, service-role key
ve başka credential repository'ye yazılmaz. Append-only migration davranışını koruyun.

Mevcut `rag_lab` uygulama şeması private privilege sınırı ve backend
`ScopedRepository` içindeki `owner_user_id` filtreleriyle korunur; aktif RLS
politikaları varmış gibi davranmayın. `supabase/tests/database/01_schema.sql`
özellikle documents RLS'nin kapalı olduğunu doğrular. `anon`/`authenticated`
erişimini genişletmeyin; güvenlik modeli değişikliği ayrı tasarım ve yetki gerektirir.
Bu açıklama Supabase'in diğer şemalarındaki RLS davranışını değiştirme talimatı değildir.

## Kanonik dokümantasyon

Detaylı kararlar `docs/architecture/migrations.md`, deployment sırası
`docs/deployment.md`, CI/release karşılığı `.github/workflows/ci.yml` ve
`.github/workflows/release.yml` içindedir.
