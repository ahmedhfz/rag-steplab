# RAG StepLab Database

## Migration otoritesi

Şema için tek aktif otorite Supabase CLI ve `supabase/migrations/` dizinidir.
Alembic historical repository state olarak kalır; çalıştırılabilir migration
otoritesi değildir. Migration geçmişini yeniden yazmayın veya paralel bir
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
ve başka credential repository'ye yazılmaz. RLS, owner isolation ve append-only
migration davranışını koruyun.

## Kanonik dokümantasyon

Detaylı kararlar `docs/architecture/migrations.md`, deployment sırası
`docs/deployment.md`, CI/release karşılığı `.github/workflows/ci.yml` ve
`.github/workflows/release.yml` içindedir.
