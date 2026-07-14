# Heault Server

Backend-only API for Azure Document Intelligence OCR and Ollama Cloud document analysis.

The Expo app must call this API. Do not put Azure or Ollama keys in Expo, and do not use `EXPO_PUBLIC_` for secrets.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Required environment variables:

```bash
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://heault.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=your_azure_document_intelligence_key
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30

OLLAMA_API_KEY=your_ollama_cloud_api_key
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=<cloud_model_name>

MIN_OCR_CONFIDENCE=0.95
STORAGE_PROVIDER=local

MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=heault

OTP_BYPASS=1
OTP_HASH_SALT=change_this_for_non_dev
```

When `OTP_BYPASS=1`, the development OTP is `1234`. Set `OTP_BYPASS=0` and configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` to use Twilio Verify.

## Endpoints

- `POST /api/auth/start`: starts mobile OTP login with country code and phone number.
- `POST /api/auth/verify`: verifies OTP and returns a session token.
- `POST /api/ocr`: multipart file upload. Images and PDFs use Azure Document Intelligence `prebuilt-layout` when Azure credentials are configured. OCR confidence must meet `MIN_OCR_CONFIDENCE`, and the extracted content must look medical before AI analysis starts.
- `POST /api/analyze-document`: sends OCR text to Ollama Cloud through the backend and returns strict JSON.
- `POST /api/specialist-summary`: generates a specialist visit summary from saved document data.

Medical documents are sent from the backend to Azure Document Intelligence for OCR. Medical OCR text is sent from the backend to Ollama Cloud for analysis. Production must add explicit user consent before sending medical document content to cloud services.
