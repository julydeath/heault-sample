import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import {
  generateJsonWithOllamaCloud,
  OllamaConfigurationError,
  OllamaInvalidJsonError,
  OllamaUnavailableError,
} from "../services/ollamaCloudClient";

const router = Router();
const uploadDir = path.resolve(process.cwd(), "uploads");
let tesseractWorkerPromise: ReturnType<typeof createWorker> | null = null;

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
  },
});

function isImage(mimeType = "") {
  return mimeType.startsWith("image/");
}

function isPdf(mimeType = "", fileName = "") {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
}

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = createWorker("eng");
  }
  return tesseractWorkerPromise;
}

function scoreOcrText(text: string) {
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const medicalWords = (text.match(/report|patient|doctor|hospital|date|mg|ml|blood|test|scan|tablet|vaccine/gi) || []).length;
  return text.trim().length + letters * 0.8 + digits * 1.2 + medicalWords * 20;
}

async function createOcrVariants(filePath: string) {
  const base = sharp(filePath).rotate().resize({ width: 1900, withoutEnlargement: true });
  const normalized = `${filePath}-normalized.png`;
  const threshold = `${filePath}-threshold.png`;

  await base.clone().grayscale().normalize().sharpen().png().toFile(normalized);
  await base.clone().grayscale().normalize().threshold(165).median(1).png().toFile(threshold);

  return [normalized, threshold];
}

async function runImageOcr(filePath: string) {
  const worker = await getTesseractWorker();
  const variants = await createOcrVariants(filePath);
  const results: Array<{ filePath: string; text: string; score: number }> = [];

  try {
    for (const variant of variants) {
      const result = await worker.recognize(variant);
      const text = result.data.text || "";
      results.push({ filePath: variant, text, score: scoreOcrText(text) });
    }
  } finally {
    await Promise.all(variants.map((variant) => fs.unlink(variant).catch(() => undefined)));
  }

  results.sort((a, b) => b.score - a.score);
  return results[0]?.text?.trim() || "";
}

function analysisSystemPrompt() {
  return [
    "You are a medical document indexing assistant for Heault.",
    "Use only the OCR text supplied by the user.",
    "Do not diagnose. Do not invent facts.",
    "Classify into one of: prescriptions, reports, scans, certificates, vaccinations, others.",
    "Return JSON only with this exact shape:",
    "{\"status\":\"ready\",\"title\":\"string\",\"category\":\"prescriptions|reports|scans|certificates|vaccinations|others\",\"summary\":\"one short paragraph\",\"hospital\":\"string or empty\",\"doctor\":\"string or empty\",\"visitDate\":\"YYYY-MM-DD or empty\",\"tags\":[\"short lowercase tag\"],\"confidence\":0.0,\"needsReview\":false,\"warnings\":[\"short warning\"]}.",
  ].join(" ");
}

function specialistSystemPrompt() {
  return [
    "You prepare a concise doctor-visit brief from user-uploaded medical records.",
    "Use only the supplied saved document data.",
    "Do not diagnose. Do not invent facts.",
    "Return JSON with keys: status, specialist, visitSummary, relevantDocuments, keyFindings, questionsToAsk, missingInformation, needsReview.",
  ].join(" ");
}

function needsReview(reason: string) {
  return {
    status: "needs_review",
    needsReview: true,
    reason,
  };
}

function normalizeDocumentAnalysis(result: unknown, fileName: string) {
  const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const categories = new Set(["prescriptions", "reports", "scans", "certificates", "vaccinations", "others"]);
  const rawCategory = typeof value.category === "string" ? value.category.toLowerCase() : "";
  const tags = Array.isArray(value.tags)
    ? value.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.map((warning) => String(warning).trim()).filter(Boolean).slice(0, 5)
    : [];

  return {
    status: "ready",
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : fileName.replace(/\.[^.]+$/, ""),
    category: categories.has(rawCategory) ? rawCategory : "others",
    summary: typeof value.summary === "string" && value.summary.trim()
      ? value.summary.trim()
      : "Document indexed from OCR text. Please review details.",
    hospital: typeof value.hospital === "string" ? value.hospital.trim() : "",
    doctor: typeof value.doctor === "string" ? value.doctor.trim() : "",
    visitDate: typeof value.visitDate === "string" ? value.visitDate.trim() : "",
    tags,
    confidence: typeof value.confidence === "number" ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    needsReview: Boolean(value.needsReview),
    warnings,
  };
}

function mapAiError(error: unknown) {
  if (error instanceof OllamaConfigurationError) {
    return {
      httpStatus: 500,
      body: needsReview(error.message),
    };
  }

  if (error instanceof OllamaUnavailableError) {
    return {
      httpStatus: 503,
      body: needsReview("Ollama Cloud is unreachable."),
    };
  }

  if (error instanceof OllamaInvalidJsonError) {
    return {
      httpStatus: 502,
      body: needsReview("Ollama Cloud returned invalid JSON."),
    };
  }

  return {
    httpStatus: 500,
    body: needsReview("AI analysis failed."),
  };
}

router.post("/ocr", upload.single("file"), async (req, res) => {
  const file = req.file;
  const startedAt = Date.now();

  if (!file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }

  try {
    logEvent("ocr_started", {
      mimeType: file.mimetype,
      fileSize: file.size,
      originalName: file.originalname,
    });

    if (isImage(file.mimetype)) {
      const text = await runImageOcr(file.path);
      logEvent("ocr_finished", {
        mimeType: file.mimetype,
        durationMs: Date.now() - startedAt,
        textLength: text.length,
      });
      res.json({
        status: "ok",
        fileName: file.originalname,
        mimeType: file.mimetype,
        ocrText: text,
        pageLevelText: [{ page: 1, text }],
      });
      return;
    }

    if (isPdf(file.mimetype, file.originalname)) {
      const buffer = await fs.readFile(file.path);
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy();
      const text = (parsed.text || "").trim();

      if (!text) {
        res.status(422).json({
          status: "needs_review",
          error: "Scanned PDF OCR is not supported yet.",
          ocrText: "",
          pageLevelText: [],
        });
        return;
      }

      logEvent("ocr_finished", {
        mimeType: file.mimetype,
        durationMs: Date.now() - startedAt,
        textLength: text.length,
      });
      res.json({
        status: "ok",
        fileName: file.originalname,
        mimeType: file.mimetype,
        ocrText: text,
        pageLevelText: [{ page: 1, text }],
      });
      return;
    }

    res.status(415).json({ error: "Unsupported file type." });
  } catch (error) {
    logEvent("ocr_failed", {
      mimeType: file.mimetype,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown OCR error",
    });
    res.status(500).json({
      status: "needs_review",
      error: "OCR failed.",
      ocrText: "",
      pageLevelText: [],
    });
  } finally {
    await fs.unlink(file.path).catch(() => undefined);
  }
});

router.post("/analyze-document", async (req, res) => {
  const { documentId, fileName, mimeType, ocrText } = req.body || {};
  const startedAt = Date.now();

  if (!documentId || !fileName || !mimeType || typeof ocrText !== "string") {
    res.status(400).json({ error: "documentId, fileName, mimeType, and ocrText are required." });
    return;
  }

  if (!ocrText.trim()) {
    res.status(422).json(needsReview("OCR text is empty."));
    return;
  }

  try {
    logEvent("ai_analysis_started", {
      documentId,
      fileName,
      mimeType,
      ocrLength: ocrText.length,
    });
    // TODO: Production must include explicit user consent before sending medical documents or OCR text to cloud AI.
    const result = await generateJsonWithOllamaCloud({
      systemPrompt: analysisSystemPrompt(),
      schemaName: "HeaultDocumentAnalysis",
      userPrompt: JSON.stringify({
        documentId,
        fileName,
        mimeType,
        ocrText,
      }),
    });
    const normalized = normalizeDocumentAnalysis(result, fileName);
    logEvent("ai_analysis_finished", {
      documentId,
      durationMs: Date.now() - startedAt,
      category: normalized.category,
      needsReview: normalized.needsReview,
    });
    res.json(normalized);
  } catch (error) {
    logEvent("ai_analysis_failed", {
      documentId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown AI error",
    });
    const mapped = mapAiError(error);
    res.status(mapped.httpStatus).json(mapped.body);
  }
});

router.post("/specialist-summary", async (req, res) => {
  const { specialist, documents } = req.body || {};

  if (!specialist || !Array.isArray(documents)) {
    res.status(400).json({ error: "specialist and saved document data are required." });
    return;
  }

  try {
    // TODO: Production must include explicit user consent before sending medical documents or OCR text to cloud AI.
    const result = await generateJsonWithOllamaCloud({
      systemPrompt: specialistSystemPrompt(),
      schemaName: "HeaultSpecialistSummary",
      userPrompt: JSON.stringify({
        specialist,
        documents,
      }),
    });
    res.json(result);
  } catch (error) {
    const mapped = mapAiError(error);
    res.status(mapped.httpStatus).json(mapped.body);
  }
});

export default router;
