# Heault Server

Backend-only API for OCR and Ollama Cloud document analysis.

The Expo app must call this API. Do not put `OLLAMA_API_KEY` in Expo, and do not use `EXPO_PUBLIC_` for secrets.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Required environment variables:

```bash
OLLAMA_API_KEY=your_ollama_cloud_api_key
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=<cloud_model_name>
```

## Endpoints

- `POST /api/ocr`: multipart file upload. Images use Tesseract OCR. PDFs use embedded text extraction with `pdf-parse`. Scanned PDF OCR returns `Scanned PDF OCR is not supported yet.`
- `POST /api/analyze-document`: sends OCR text to Ollama Cloud through the backend and returns strict JSON.
- `POST /api/specialist-summary`: generates a specialist visit summary from saved document data.

Medical OCR text is sent from the backend to Ollama Cloud for analysis. Production must add explicit user consent before sending medical document content to cloud AI.
