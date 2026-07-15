# Heault Deployment

## Best Free Option For This App

Do not use Vercel for the current backend upload flow. Vercel Functions have a small request/response payload limit, so phone images and PDFs can fail during `/api/ocr`.

Use Render Free for the backend demo:

- It runs the Express server as a normal web service.
- It gives an HTTPS `onrender.com` URL.
- It can receive the current multipart uploads.
- It may sleep when inactive, so the first request can be slow.

## Deploy Backend On Render

1. Push this repository to GitHub.
2. Open Render Dashboard.
3. New > Blueprint.
4. Connect the GitHub repository.
5. Render will read `render.yaml`.
6. Add these environment variables in Render:

```bash
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB_NAME=heault

AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://heault.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=your_azure_document_intelligence_key
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30

OLLAMA_API_KEY=your_ollama_cloud_api_key
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=your_ollama_model

AZURE_STORAGE_CONNECTION_STRING=your_azure_blob_connection_string
AZURE_STORAGE_CONTAINER=heault-originals

OTP_BYPASS=1
OTP_HASH_SALT=change_this_to_a_long_random_value
```

For real OTP later:

```bash
OTP_BYPASS=0
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=...
```

## Check Backend

After Render deploys, open:

```text
https://your-service-name.onrender.com/health
```

Expected:

```json
{"status":"ok","service":"heault-server"}
```

## Build APK For Hosted Backend

Replace the URL below with your Render URL:

```bash
EXPO_PUBLIC_HEAULT_API_URL=https://your-service-name.onrender.com \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
JAVA_HOME="/Users/prathyusha/Desktop/manoj/heault sample/.jdk/jdk-17.0.19+10/Contents/Home" \
NODE_ENV=production \
./android/gradlew -p android :app:assembleRelease
```

Then install:

```bash
cp android/app/build/outputs/apk/release/app-release.apk Heault-v1.0.0-release.apk
adb install -r Heault-v1.0.0-release.apk
```
