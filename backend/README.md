# RAG StepLab backend

Backend gerçek ve kalıcı RAG learning pipeline'ını sağlar:

```text
PDF → private Storage → Docling → chunking → Gemini embeddings → pgvector/FTS
→ retrieval/reranking → context → grounded generation/citations → evaluation
```

## Çalıştırma

Virtual environment ve dependency'ler bir kez kurulduktan sonra proje kökündeki `npm run dev`, frontend ile backend'i birlikte başlatır.

Backend'i tek başına çalıştırmak için PowerShell:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Environment isimleri repository kökündeki `.env.example` dosyasında tanımlıdır. `rag_lab` şeması, `extensions.vector` ve private `rag-documents` bucket'ı Alembic öncesinde Supabase'te hazır olmalıdır. Secret değerleri source control'a eklenmez.

Frontend varsayılan olarak `http://127.0.0.1:8000` adresini kullanır. Farklı bir adres için frontend build/dev işleminden önce `NEXT_PUBLIC_API_BASE_URL` tanımlanabilir. Hosted kurulum için `docs/deployment.md` canonical kaynaktır.

## Test

```powershell
.venv\Scripts\python.exe -m pytest
```
