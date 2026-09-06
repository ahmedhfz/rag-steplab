# Database migration authority

## Karar

RAG StepLab için tek schema migration authority Supabase CLI ve
`supabase/migrations` dizinidir. FastAPI runtime ORM olarak SQLAlchemy 2,
PostgreSQL driver olarak psycopg 3 kullanılmaya devam eder.

## Neden

Supabase PostgreSQL, pgvector ve private Storage production'ın kaynak
platformudur. İki ayrı migration history'si aynı şemayı yönetirse local,
remote ve production state'leri ayrışabilir. Bu nedenle Alembic yalnızca
tarihsel Git geçmişinde kalmış, aktif dosya ve çalıştırılabilir migration
authority olmaktan çıkarılmıştır.

## Production baseline

Remote migration history CLI ile fetch edilmiştir:

- `20260819231356_bootstrap_rag_steplab_infrastructure`
- `20260819232413_create_rag_steplab_app_role`
- `20260820211414_standardize_rag_lab_ownership`
- `20260820211422_standardize_rag_lab_ownership` (historical duplicate)
- `20260820211551_add_documents_active_run_indexes`

`20260820211450_rag_lab_production_baseline.sql` mevcut production
`rag_lab` şemasının data içermeyen snapshot'ıdır. Existing production'da
DDL çalıştırılmadan migration history repair ile applied olarak işaretlenir;
boş/local environment'ta ise mevcut şemayı yeniden oluşturur.
Baseline sürümü, historical active-run index migration'ından önce sıralanır;
çünkü o migration'ın hedeflediği tablolar geçmişte Alembic/manual DDL ile
oluşturulmuştu ve remote history'de ayrıca kayıtlı değildi.

`20260820212718_remove_alembic_version.sql`, runtime ve CI kontrolleri
tamamlandıktan sonra yalnız historical `rag_lab.alembic_version` tablosunu
kaldırır. Kullanıcı/application tabloları veya Storage verisi bu geçişte
silinmez.

## İş akışı

```text
supabase migration new <name>
        ↓
supabase db reset --local --no-seed
        ↓
Pull request validation
        ↓
main GitHub Actions → supabase db push --linked
```

Production DB password veya service-role key repository'ye yazılmaz.

## Durable pipeline worker lease migration

`20260824121538_durable_pipeline_worker_leases.sql`, experiment/evaluation
run'ları için `queued → running → completed/failed` state'ini, Modal dispatch
kimliğini ve nullable fencing lease alanlarını ekler. Chunk/embedding artifact
run'larında da token/expiry çifti bulunur. Eski satırlar backfill edilmez;
`NULL` lease çiftleri tarihsel kayıtları korur. `lease_token` ile
`lease_expires_at` birlikte dolu ya da birlikte boş olmak zorundadır; worker
stage yazıları mevcut token ile fence edilir.
