# RAG StepLab local backend

Bu backend yalnızca `POST /documents/parse` akışını sağlar:

```text
PDF upload → FastAPI doğrulaması → Docling → normalize edilmiş parse response
```

## Çalıştırma

Virtual environment ve dependency'ler bir kez kurulduktan sonra proje kökündeki `npm run dev`, frontend ile backend'i birlikte başlatır.

Backend'i tek başına çalıştırmak için PowerShell:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Frontend varsayılan olarak `http://127.0.0.1:8000` adresini kullanır. Farklı bir adres için frontend build/dev işleminden önce `NEXT_PUBLIC_API_BASE_URL` tanımlanabilir.

## Test

```powershell
.venv\Scripts\python.exe -m pytest
```
