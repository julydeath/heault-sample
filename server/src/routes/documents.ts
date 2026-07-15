import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import {
  generateJsonWithOllamaCloud,
  OllamaConfigurationError,
  OllamaInvalidJsonError,
  OllamaUnavailableError,
} from "../services/ollamaCloudClient";
import {
  analyzeDocumentWithAzureLayout,
  AzureDocumentIntelligenceConfigurationError,
  isAzureDocumentIntelligenceConfigured,
} from "../services/azureDocumentIntelligenceClient";
import { readStoredOriginal, saveOriginalFile, storageStatus, StoredOriginal } from "../services/storage";
import { validateOcrForUpload } from "../services/documentValidation";
import { getCollection } from "../services/database";
import { AuthenticatedRequest, requireAuth } from "./auth";

const router = Router();
const uploadDir = path.resolve(process.cwd(), "uploads");
let tesseractWorkerPromise: ReturnType<typeof createWorker> | null = null;
const MAX_AI_IMAGE_COUNT = 3;
const MAX_AI_IMAGE_CHARS = 12_000_000;
let documentIndexesPromise: Promise<void> | null = null;

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
  },
});

function validationRejectedBody(validation: Exclude<ReturnType<typeof validateOcrForUpload>, { ok: true }>, extras: Record<string, unknown>) {
  return {
    status: "needs_reupload",
    code: validation.code,
    error: validation.reason,
    reason: validation.reason,
    minOcrConfidence: validation.minConfidence,
    medicalScore: validation.medicalScore,
    ...extras,
  };
}

function azureRetryStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "Azure OCR failed.";
  return /429|rate|quota|too many|limit/i.test(message) ? 429 : 503;
}

function isImage(mimeType = "") {
  return mimeType.startsWith("image/");
}

function isPdf(mimeType = "", fileName = "") {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
}

async function upsertDocumentRecord(documentId: string | undefined, patch: Record<string, unknown>) {
  if (!documentId) return;
  const documents = await getCollection("documents");
  if (!documents) return;
  await ensureDocumentIndexes();
  const originalStorage = patch.originalStorage;
  const hasOriginalStorage = Boolean(
    originalStorage
    && typeof originalStorage === "object"
    && "storageKey" in (originalStorage as Record<string, unknown>)
  );
  const update: Record<string, unknown> = {
    $set: {
      ...patch,
      updatedAt: new Date(),
    },
    $setOnInsert: {
      documentId,
      createdAt: new Date(),
      uploadedAt: new Date(),
    },
  };
  if (hasOriginalStorage) {
    update.$addToSet = {
      originalFiles: originalStorage,
    };
  }

  await documents.updateOne(
    { documentId },
    update,
    { upsert: true }
  ).catch((error) => {
    logEvent("document_record_save_failed", {
      documentId,
      error: error instanceof Error ? error.message : "MongoDB document save failed.",
    });
  });
}

async function ensureDocumentIndexes() {
  if (!documentIndexesPromise) {
    documentIndexesPromise = (async () => {
      const documents = await getCollection("documents");
      await documents?.createIndex({ userId: 1, documentId: 1 }, { unique: true }).catch(() => undefined);
      await documents?.createIndex({ userId: 1, updatedAt: -1 }).catch(() => undefined);
      await documents?.createIndex({ userId: 1, hospital: 1 }).catch(() => undefined);
      await documents?.createIndex({ userId: 1, doctor: 1 }).catch(() => undefined);
      await documents?.createIndex({ userId: 1, patientName: 1 }).catch(() => undefined);
      await documents?.createIndex({ userId: 1, category: 1 }).catch(() => undefined);
    })();
  }
  return documentIndexesPromise;
}

function appDocumentFromRecord(record: Record<string, unknown>) {
  const rawStatus = typeof record.status === "string" ? record.status : "ready";
  const status = rawStatus === "needs_review" ? "needs_reupload" : rawStatus;
  return {
    id: record.documentId,
    documentId: record.documentId,
    title: record.title || record.fileName || "Medical document",
    category: record.category || "others",
    date: record.visitDate || record.date || record.updatedAt || record.createdAt,
    uploadedAt: record.uploadedAt || record.createdAt || record.updatedAt,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    sortDate: record.updatedAt ? new Date(record.updatedAt as string).getTime() : Date.now(),
    doctor: record.doctor || "",
    hospital: record.hospital || "",
    patientName: record.patientName || "",
    tags: Array.isArray(record.tags) ? record.tags : [],
    pages: Array.isArray(record.pageLevelText) ? record.pageLevelText.length || 1 : 1,
    ocr: record.ocrText || "",
    structuredOcr: record.structuredOcr || null,
    summary: record.summary || "",
    clinicalSummary: record.clinicalSummary || "",
    importantFindings: Array.isArray(record.importantFindings) ? record.importantFindings : [],
    medicines: Array.isArray(record.medicines) ? record.medicines : [],
    tests: Array.isArray(record.tests) ? record.tests : [],
    status,
    needsReview: false,
    ocrConfidence: record.ocrConfidence,
    ocrProvider: record.ocrProvider,
    confidence: record.confidence,
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
    verifiedFacts: Array.isArray(record.verifiedFacts) ? record.verifiedFacts : [],
    rejectedFacts: Array.isArray(record.rejectedFacts) ? record.rejectedFacts : [],
    originalStorage: record.originalStorage || null,
    originalFiles: Array.isArray(record.originalFiles) ? record.originalFiles : [],
    fileName: record.fileName || "",
    mimeType: record.mimeType || "",
    batchId: record.batchId || "",
    batchIndex: typeof record.batchIndex === "number" ? record.batchIndex : 0,
    originalSaved: true,
  };
}

function authDocumentPatch(req: AuthenticatedRequest) {
  const batchId = typeof req.body?.batchId === "string" ? req.body.batchId.trim().slice(0, 120) : "";
  const batchIndex = Number(req.body?.batchIndex);
  return {
    userId: req.auth?.userId,
    phoneE164: req.auth?.phoneE164,
    ...(batchId ? { batchId } : {}),
    ...(Number.isFinite(batchIndex) ? { batchIndex } : {}),
  };
}

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = createWorker("eng");
  }
  return tesseractWorkerPromise;
}

function scoreOcrText(text: string) {
  const trimmed = text.trim();
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const usefulLines = getOcrLines(text).filter((line) => {
    const value = line.text.trim();
    return value.length >= 4 && /[a-zA-Z0-9]/.test(value);
  }).length;
  const noisyChars = (trimmed.match(/[^\w\s.,:;/+\-%()[\]]/g) || []).length;
  const medicalWords = (text.match(/report|patient|doctor|hospital|date|mg|ml|blood|test|scan|tablet|vaccine/gi) || []).length;
  return trimmed.length * 0.35 + letters * 0.9 + digits * 1.4 + usefulLines * 10 + medicalWords * 28 - noisyChars * 3;
}

function normalizeOcrConfidence(confidence: unknown, text: string) {
  const numeric = Number(confidence);
  if (Number.isFinite(numeric)) {
    if (numeric > 1) return Math.max(0, Math.min(1, numeric / 100));
    return Math.max(0, Math.min(1, numeric));
  }

  const trimmed = text.trim();
  if (!trimmed) return 0;
  const noisyChars = (trimmed.match(/[^\w\s.,:;/+\-%()[\]]/g) || []).length;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  const lineCount = getOcrLines(trimmed).length || 1;
  const densityScore = Math.min(1, trimmed.length / Math.max(120, lineCount * 18));
  const numericScore = digitCount ? 0.08 : 0;
  const noisePenalty = Math.min(0.22, noisyChars / Math.max(trimmed.length, 1));
  return Math.max(0.25, Math.min(0.92, 0.58 + densityScore * 0.22 + numericScore - noisePenalty));
}

function hasTableLikeContent(text: string) {
  return /\b(result|unit|reference|range|normal|high|low|value)\b/i.test(text)
    || /\b(g\/dL|mg\/dL|mmol\/L|IU\/L|uIU\/mL|cells\/|mmHg|%)\b/i.test(text)
    || /\b(hemoglobin|wbc|rbc|platelet|cholesterol|glucose|creatinine|tsh|hba1c)\b/i.test(text);
}

async function createOcrVariants(filePath: string) {
  const base = sharp(filePath).rotate().flatten({ background: "#fff" }).resize({ width: 2300, withoutEnlargement: true });
  const normalized = `${filePath}-normalized.png`;
  const threshold = `${filePath}-threshold.png`;
  const contrast = `${filePath}-contrast.png`;

  await base.clone().grayscale().normalize().sharpen({ sigma: 0.8 }).png().toFile(normalized);
  await base.clone().grayscale().normalize().linear(1.18, -12).sharpen({ sigma: 1 }).png().toFile(contrast);
  await base.clone().grayscale().normalize().threshold(168).median(1).png().toFile(threshold);

  return [
    { filePath: normalized, psm: PSM.AUTO },
    { filePath: contrast, psm: PSM.SINGLE_BLOCK },
    { filePath: threshold, psm: PSM.SPARSE_TEXT },
  ];
}

async function runImageOcr(filePath: string) {
  const worker = await getTesseractWorker();
  const variants = await createOcrVariants(filePath);
  const results: Array<{ filePath: string; text: string; score: number; confidence: number }> = [];

  try {
    for (const variant of variants) {
      await worker.setParameters({
        tessedit_pageseg_mode: variant.psm,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      const result = await worker.recognize(variant.filePath);
      const text = result.data.text || "";
      const confidence = normalizeOcrConfidence(result.data.confidence, text);
      results.push({
        filePath: variant.filePath,
        text,
        score: scoreOcrText(text) + confidence * 140,
        confidence,
      });
    }
  } finally {
    await Promise.all(variants.map((variant) => fs.unlink(variant.filePath).catch(() => undefined)));
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  return {
    text: best?.text?.trim() || "",
    confidence: best?.confidence || 0,
  };
}

function buildAzureOcrText(layout: Awaited<ReturnType<typeof analyzeDocumentWithAzureLayout>>) {
  const content = normalizeReportText(layout.content);
  if (content) return content;

  return normalizeReportText(layout.pages.map((page) => page.text).filter(Boolean).join("\n\n"));
}

async function runAzureLayoutOcr(filePath: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const layout = await analyzeDocumentWithAzureLayout(filePath);
      const text = buildAzureOcrText(layout);
      const pageLevelText = layout.pages.length
        ? layout.pages.map((page) => ({
          page: page.page,
          text: page.text || text,
          confidence: page.confidence || layout.confidence,
          lines: page.lines,
        }))
        : [{ page: 1, text, confidence: layout.confidence, lines: [] }];

      return {
        text,
        confidence: layout.confidence || normalizeOcrConfidence(undefined, text),
        pageLevelText,
        layout,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof AzureDocumentIntelligenceConfigurationError || attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }

  throw lastError;
}

function getOcrLines(ocrText: string) {
  return ocrText
    .split(/\r?\n/)
    .map((text, index) => ({ lineNumber: index + 1, text }))
    .filter((line) => line.text.trim().length > 0);
}

function normalizeReportText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function comparableText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function cleanReadableLine(value: string) {
  return value
    .replace(/^\s*\[\d+\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readableSectionTitle(value: string) {
  const title = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return "Extracted text";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function shouldSkipDisplayLine(value: string) {
  const clean = cleanReadableLine(value);
  return !clean || /^page\s+\d+$/i.test(clean);
}

function formatStructuredText(
  ocrText: string,
  sections: Array<{ title: string; lineNumbers: number[] }>
) {
  if (/^#{1,6}\s|\|.+\||<table|<tr|<td|<th|^\s*[-*]\s+/im.test(ocrText)) {
    return normalizeReportText(ocrText);
  }

  const linesByNumber = new Map(getOcrLines(ocrText).map((line) => [line.lineNumber, cleanReadableLine(line.text)]));
  const seen = new Set<string>();
  const chunks: string[] = [];

  for (const section of sections) {
    const sectionLines: string[] = [];

    for (const lineNumber of section.lineNumbers) {
      const line = linesByNumber.get(lineNumber) || "";
      if (shouldSkipDisplayLine(line)) continue;
      const key = comparableText(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sectionLines.push(line);
    }

    if (!sectionLines.length) continue;
    chunks.push(`## ${readableSectionTitle(section.title)}\n${sectionLines.join("\n")}`);
  }

  if (chunks.length) return chunks.join("\n\n");

  return getOcrLines(ocrText)
    .map((line) => cleanReadableLine(line.text))
    .filter((line, index, all) => {
      if (shouldSkipDisplayLine(line)) return false;
      const key = comparableText(line);
      return key && all.findIndex((item) => comparableText(item) === key) === index;
    })
    .join("\n");
}

function fallbackStructuredOcr(ocrText: string, warning?: string) {
  const lines = getOcrLines(ocrText);
  const sections = [
    {
      title: "Extracted text",
      lineNumbers: lines.map((line) => line.lineNumber),
    },
  ];

  return {
    status: "ready",
    rawText: ocrText,
    lineCount: lines.length,
    formattedText: normalizeReportText(formatStructuredText(ocrText, sections)),
    sections,
    keyValuePairs: [] as Array<{ label: string; value: string; lineNumbers: number[] }>,
    tables: [] as Array<{ title: string; lineNumbers: number[] }>,
    warnings: warning ? [warning] : ([] as string[]),
  };
}

type StructuredOcr = ReturnType<typeof fallbackStructuredOcr>;

type ImagePage = {
  page: number;
  mimeType: string;
  base64: string;
};

type ExtractionFact = {
  type: string;
  label: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  evidence: string;
  confidence: number;
  verified?: boolean;
  verificationReason?: string;
};

type VerificationResult = {
  status: string;
  requiresHumanReview: boolean;
  facts: Array<{ index: number; verified: boolean; reason: string }>;
  warnings: string[];
};

function normalizeImagePages(value: unknown): ImagePage[] {
  if (!Array.isArray(value)) return [];
  let totalChars = 0;
  const pages: ImagePage[] = [];

  for (const item of value.slice(0, MAX_AI_IMAGE_COUNT)) {
    const pageValue = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rawBase64 = typeof pageValue.base64 === "string" ? pageValue.base64 : "";
    const base64 = rawBase64.replace(/^data:[^;]+;base64,/, "");
    const mimeType = typeof pageValue.mimeType === "string" ? pageValue.mimeType : "image/jpeg";
    const page = Number(pageValue.page) || pages.length + 1;

    if (!base64 || !mimeType.startsWith("image/")) continue;
    if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(base64)) continue;

    totalChars += base64.length;
    if (totalChars > MAX_AI_IMAGE_CHARS) break;
    pages.push({ page, mimeType, base64 });
  }

  return pages;
}

function likelyVisionModel(model = "") {
  return /vision|llava|moondream|bakllava|gemma3|qwen2\.5vl|qwen-vl|pixtral/i.test(model);
}

function getVisionModel() {
  const visionModel = process.env.OLLAMA_VISION_MODEL;
  if (visionModel) return visionModel;
  const defaultModel = process.env.OLLAMA_MODEL || "";
  return likelyVisionModel(defaultModel) ? defaultModel : "";
}

function shouldUseVision({
  fileName,
  mimeType,
  ocrText,
  ocrConfidence,
  structuredOcr,
  imagePages,
}: {
  fileName: string;
  mimeType: string;
  ocrText: string;
  ocrConfidence?: number;
  structuredOcr: StructuredOcr;
  imagePages: ImagePage[];
}) {
  void fileName;
  void mimeType;
  void ocrText;
  void ocrConfidence;
  void structuredOcr;
  void imagePages;
  return false;
}

function extractionSystemPrompt(useVision: boolean) {
  return [
    "You are a medical document indexing engine for Heault, a personal medical document vault.",
    "Optimize for retrieval: what document is this, where did it come from, who issued it, and when was it created or visited.",
    "Use OCR text first. Use the image only to understand layout, tables, handwriting position, columns, and small numbers.",
    useVision ? "Images are supplied. Cross-check OCR against visible document content." : "No images are supplied. Use OCR and structured OCR only.",
    "Extract only visible facts. Do not diagnose. Do not add medical explanation. Do not infer missing hospital, doctor, date, test names, or results.",
    "Every saved fact must include an evidence quote from the OCR text or visible document text.",
    "No evidence means omit the fact or put it in unclear.",
    "Prioritize documentDate, patientName, hospital, doctor, document title, and category. Keep tests, medicines, vaccinations, findings, and facts short and only when explicitly written.",
    "Avoid duplicate facts. If the same value appears multiple times, keep the clearest one.",
    "Return JSON only with keys: primaryCategory, title, documentDate, patientName, hospital, doctor, tests, medicines, vaccinations, findings, facts, unclear, requiresHumanReview, confidence, warnings.",
    "primaryCategory must be one of: prescriptions, reports, scans, certificates, vaccinations, others.",
    "documentDate, patientName, hospital, doctor use {value,evidence,confidence}. Empty value if not found.",
    "tests use {name,value,unit,referenceRange,evidence,confidence}.",
    "medicines use {name,dosage,frequency,evidence,confidence}.",
    "vaccinations use {name,date,evidence,confidence}.",
    "findings and facts use {type,label,value,unit,referenceRange,evidence,confidence}.",
  ].join(" ");
}

function verificationSystemPrompt(useVision: boolean) {
  return [
    "You verify extracted medical document facts for Heault.",
    "Use only the supplied OCR text, structured OCR, extracted facts, and images when present.",
    useVision ? "Images are supplied. Verify facts against OCR and visible image text." : "No images are supplied. Verify against OCR and structured OCR only.",
    "Reject facts that are not directly supported by evidence.",
    "Reject diagnoses or explanations added by the AI.",
    "Return JSON only with keys: status, requiresHumanReview, facts, warnings.",
    "facts must be an array of {index,verified,reason}, where index matches the supplied facts array.",
  ].join(" ");
}

function summarySystemPrompt() {
  return [
    "You write retrieval summaries for Heault, a medical document vault.",
    "Use only the supplied verified facts and metadata.",
    "Do not diagnose. Do not add facts. Do not explain medical meaning unless the document states it.",
    "Return JSON only with keys: summary, clinicalSummary, importantFindings, tags.",
    "summary should be 2-4 plain sentences helping the patient find this document later.",
    "Prioritize category, hospital, doctor, patient, and date when verified facts provide them.",
    "If tests, vaccines, medicines, or procedures are explicitly verified, mention them briefly without interpretation.",
    "clinicalSummary should be a concise doctor-facing note based only on uploaded document data and verified source/date details. Do not interpret results.",
    "importantFindings should usually be an empty array. Include an item only when the document itself states a critical instruction, vaccine, medicine, or result and evidence is verified.",
    "tags must be short lowercase indexing tags using only verified source/type words.",
  ].join(" ");
}

function factFromField(type: string, label: string, value: unknown): ExtractionFact | null {
  const field = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fieldValue = typeof field.value === "string" ? field.value.trim() : "";
  const evidence = typeof field.evidence === "string" ? field.evidence.trim() : "";
  if (!fieldValue || !evidence) return null;
  const normalizedValue = type === "hospital" ? cleanHospitalCandidate(fieldValue) : fieldValue;
  if (type === "hospital" && !isLikelyHospitalName(normalizedValue) && !hasExplicitHospitalLabel(label) && !hasExplicitHospitalLabel(evidence)) return null;
  return {
    type,
    label,
    value: normalizedValue,
    evidence,
    confidence: typeof field.confidence === "number" ? Math.max(0, Math.min(1, field.confidence)) : 0.5,
  };
}

function normalizeFact(value: unknown, fallbackType = "fact"): ExtractionFact | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const label = typeof item.label === "string" && item.label.trim()
    ? item.label.trim().slice(0, 100)
    : typeof item.name === "string" && item.name.trim()
      ? item.name.trim().slice(0, 100)
      : fallbackType;
  const inferredType = typeof item.type === "string" && item.type.trim() ? item.type.trim().slice(0, 60) : fallbackType;
  const rawFactValue = typeof item.value === "string" && item.value.trim()
    ? item.value.trim().slice(0, 180)
    : [
      typeof item.name === "string" ? item.name.trim() : "",
      typeof item.dosage === "string" ? item.dosage.trim() : "",
      typeof item.frequency === "string" ? item.frequency.trim() : "",
      typeof item.date === "string" ? item.date.trim() : "",
    ].filter(Boolean).join(" ").slice(0, 180);
  const evidence = typeof item.evidence === "string" ? item.evidence.trim().slice(0, 260) : "";
  const factValue = inferredType === "hospital" ? cleanHospitalCandidate(rawFactValue) : rawFactValue;
  if (!factValue || !evidence) return null;
  if (inferredType === "hospital" && !isLikelyHospitalName(factValue) && !hasExplicitHospitalLabel(label) && !hasExplicitHospitalLabel(evidence)) return null;

  return {
    type: inferredType,
    label,
    value: factValue,
    unit: typeof item.unit === "string" ? item.unit.trim().slice(0, 40) : undefined,
    referenceRange: typeof item.referenceRange === "string" ? item.referenceRange.trim().slice(0, 80) : undefined,
    evidence,
    confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
  };
}

function normalizeExtractionFacts(extraction: Record<string, unknown>) {
  const facts: ExtractionFact[] = [];
  const metadataFields = [
    factFromField("date", "Document date", extraction.documentDate),
    factFromField("patient", "Patient name", extraction.patientName),
    factFromField("hospital", "Hospital", extraction.hospital),
    factFromField("doctor", "Doctor", extraction.doctor),
  ].filter(Boolean) as ExtractionFact[];
  facts.push(...metadataFields);

  const groups: Array<[string, unknown]> = [
    ["test", extraction.tests],
    ["medicine", extraction.medicines],
    ["vaccination", extraction.vaccinations],
    ["finding", extraction.findings],
    ["fact", extraction.facts],
  ];

  for (const [type, group] of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const fact = normalizeFact(item, type);
      if (fact) facts.push(fact);
    }
  }

  return facts.slice(0, 40);
}

function cleanOcrLineText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function inferFactTypeFromLine(line: string) {
  if (/\b(date|dated|collected|reported|visit)\b|(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.test(line)) return "date";
  if (/\b(dr\.?|doctor|consultant|physician)\b/i.test(line)) return "doctor";
  if (/\b(patient|name|age|sex|gender|dob|uhid|mrn)\b/i.test(line)) return "patient";
  if (hasExplicitHospitalLabel(line)) return "hospital";
  if (isLikelyHospitalName(line)) return "hospital";
  if (/\b(rx|tablet|capsule|syrup|injection|ointment|drops|mg|mcg|ml|dose|daily|twice)\b/i.test(line)) return "medicine";
  if (hasTableLikeContent(line) || /\b(test|result|unit|range|hemoglobin|wbc|rbc|platelet|glucose|creatinine|tsh|hba1c)\b/i.test(line)) return "test";
  if (/\b(impression|conclusion|finding|advice|recommendation|follow up|diagnosis)\b/i.test(line)) return "finding";
  return "ocr_line";
}

function labelAndValueFromOcrLine(line: string) {
  const cleanLine = cleanOcrLineText(line);
  const colonIndex = cleanLine.indexOf(":");

  if (colonIndex > 0 && colonIndex < 48) {
    const label = cleanLine.slice(0, colonIndex).trim();
    const value = cleanLine.slice(colonIndex + 1).trim();
    if (label && value) return { label: label.slice(0, 100), value: value.slice(0, 180) };
  }

  const knownLabel = cleanLine.match(/^(hemoglobin|wbc|rbc|platelets?|glucose|creatinine|tsh|hba1c|cholesterol|triglycerides?)\b/i)?.[0];
  if (knownLabel) return { label: knownLabel, value: cleanLine.slice(knownLabel.length).trim().slice(0, 180) || cleanLine.slice(0, 180) };

  return {
    label: inferFactTypeFromLine(cleanLine).replace(/_/g, " "),
    value: cleanLine.slice(0, 180),
  };
}

function lineTextForNumbers(structuredOcr: StructuredOcr, lineNumbers: number[]) {
  const byNumber = new Map(getOcrLines(structuredOcr.rawText).map((line) => [line.lineNumber, cleanOcrLineText(line.text)]));
  return lineNumbers.map((lineNumber) => byNumber.get(lineNumber)).filter(Boolean).join(" ");
}

function isUsefulFallbackLine(line: string) {
  const cleanLine = cleanOcrLineText(line);
  if (cleanLine.length < 4 || cleanLine.length > 180) return false;
  if (/^page\s+\d+$/i.test(cleanLine)) return false;
  const hasKeyword = /\b(patient|name|doctor|dr\.?|date|hospital|clinic|lab|report|test|result|unit|range|normal|tablet|capsule|rx|advice|recommendation|impression|diagnosis)\b/i.test(cleanLine);
  const hasMedicalNumber = /\d/.test(cleanLine) && (hasTableLikeContent(cleanLine) || /\b(mg|mcg|ml|g\/dL|mg\/dL|mmol\/L|%|bpm|mmHg)\b/i.test(cleanLine));
  const hasColon = cleanLine.includes(":") && /[A-Za-z]/.test(cleanLine);
  return hasKeyword || hasMedicalNumber || hasColon;
}

function fallbackFactsFromStructuredOcr(structuredOcr: StructuredOcr, ocrConfidence?: number) {
  const confidence = Math.max(0.32, Math.min(0.72, ocrConfidence || 0.45));
  const facts: ExtractionFact[] = [];

  for (const pair of structuredOcr.keyValuePairs.slice(0, 18)) {
    const evidence = lineTextForNumbers(structuredOcr, pair.lineNumbers) || cleanOcrLineText(pair.value);
    const label = cleanOcrLineText(pair.label);
    const value = cleanOcrLineText(pair.value);
    if (!label || !value || !evidence) continue;
    const type = inferFactTypeFromLine(`${label} ${value}`);
    if (type === "hospital" && !isLikelyHospitalName(value) && !hasExplicitHospitalLabel(label) && !hasExplicitHospitalLabel(evidence)) continue;
    facts.push({
      type,
      label: label.slice(0, 100),
      value: type === "hospital" ? cleanHospitalCandidate(value).slice(0, 180) : value.slice(0, 180),
      evidence: evidence.slice(0, 260),
      confidence,
    });
  }

  const candidateLines = getOcrLines(structuredOcr.rawText)
    .map((line) => cleanOcrLineText(line.text))
    .filter(isUsefulFallbackLine);
  const fallbackLines = candidateLines.length
    ? candidateLines
    : getOcrLines(structuredOcr.rawText).map((line) => cleanOcrLineText(line.text)).filter((line) => line.length >= 4).slice(0, 8);

  for (const line of fallbackLines.slice(0, 18)) {
    const { label, value } = labelAndValueFromOcrLine(line);
    const type = inferFactTypeFromLine(line);
    if (type === "hospital" && !isLikelyHospitalName(value) && !hasExplicitHospitalLabel(label) && !hasExplicitHospitalLabel(line)) continue;
    facts.push({
      type,
      label,
      value: type === "hospital" ? cleanHospitalCandidate(value) : value,
      evidence: line.slice(0, 260),
      confidence,
    });
  }

  return dedupeFacts(facts).slice(0, 24);
}

function normalizeExtractionResult(result: unknown) {
  return result && typeof result === "object" ? result as Record<string, unknown> : {};
}

function simpleText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function evidenceAppearsInOcr(evidence: string, ocrText: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const evidenceText = normalize(evidence);
  const ocr = normalize(ocrText);
  if (!evidenceText) return false;
  if (ocr.includes(evidenceText)) return true;
  const tokens = evidenceText.split(" ").filter((token) => token.length > 1);
  if (!tokens.length) return false;
  const matches = tokens.filter((token) => ocr.includes(token)).length;
  return matches / tokens.length >= 0.72;
}

function codeVerifyFacts(facts: ExtractionFact[], ocrText: string): VerificationResult {
  const results = facts.map((fact, index) => ({
    index,
    verified: Boolean(fact.evidence && evidenceAppearsInOcr(fact.evidence, ocrText)),
    reason: fact.evidence && evidenceAppearsInOcr(fact.evidence, ocrText)
      ? "Evidence appears in OCR text."
      : "Evidence was not found in OCR text.",
  }));
  const rejected = results.filter((item) => !item.verified).length;
  return {
    status: rejected ? "needs_reupload" : "verified",
    requiresHumanReview: rejected > 0,
    facts: results,
    warnings: rejected ? [`${rejected} extracted fact(s) could not be verified against OCR text.`] : [],
  };
}

function normalizeLineNumbers(value: unknown, maxLine: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= maxLine);
}

function normalizeStructuredOcr(result: unknown, ocrText: string): StructuredOcr {
  const fallback = fallbackStructuredOcr(ocrText);
  const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const maxLine = fallback.lineCount;

  const sections = Array.isArray(value.sections)
    ? value.sections.map((section) => {
      const sectionValue = section && typeof section === "object" ? section as Record<string, unknown> : {};
      return {
        title: typeof sectionValue.title === "string" && sectionValue.title.trim()
          ? sectionValue.title.trim().slice(0, 80)
          : "Section",
        lineNumbers: normalizeLineNumbers(sectionValue.lineNumbers, maxLine),
      };
    }).filter((section) => section.lineNumbers.length > 0)
    : fallback.sections;

  const keyValuePairs = Array.isArray(value.keyValuePairs)
    ? value.keyValuePairs.map((pair) => {
      const pairValue = pair && typeof pair === "object" ? pair as Record<string, unknown> : {};
      return {
        label: typeof pairValue.label === "string" ? pairValue.label.trim().slice(0, 60) : "",
        value: typeof pairValue.value === "string" ? pairValue.value.trim().slice(0, 160) : "",
        lineNumbers: normalizeLineNumbers(pairValue.lineNumbers, maxLine),
      };
    }).filter((pair) => pair.label && pair.value)
    : [];

  const tables = Array.isArray(value.tables)
    ? value.tables.map((table) => {
      const tableValue = table && typeof table === "object" ? table as Record<string, unknown> : {};
      return {
        title: typeof tableValue.title === "string" && tableValue.title.trim()
          ? tableValue.title.trim().slice(0, 80)
          : "Table",
        lineNumbers: normalizeLineNumbers(tableValue.lineNumbers, maxLine),
      };
    }).filter((table) => table.lineNumbers.length > 0)
    : [];

  const coveredLines = new Set(sections.flatMap((section) => section.lineNumbers));
  const missingLines = fallback.sections[0].lineNumbers.filter((lineNumber) => !coveredLines.has(lineNumber));
  const completeSections = missingLines.length
    ? [...sections, { title: "Other extracted text", lineNumbers: missingLines }]
    : sections;

  return {
    ...fallback,
    formattedText: formatStructuredText(ocrText, completeSections.length ? completeSections : fallback.sections),
    sections: completeSections.length ? completeSections : fallback.sections,
    keyValuePairs,
    tables,
    warnings: [],
  };
}

async function createStructuredOcr(ocrText: string): Promise<StructuredOcr> {
  return fallbackStructuredOcr(ocrText);
}

async function createEvidenceExtraction({
  documentId,
  fileName,
  mimeType,
  ocrText,
  ocrConfidence,
  structuredOcr,
  imagePages,
  useVision,
  visionModel,
}: {
  documentId: string;
  fileName: string;
  mimeType: string;
  ocrText: string;
  ocrConfidence?: number;
  structuredOcr: StructuredOcr;
  imagePages: ImagePage[];
  useVision: boolean;
  visionModel: string;
}) {
  const images = useVision ? imagePages.map((page) => page.base64) : undefined;

  return normalizeExtractionResult(await generateJsonWithOllamaCloud({
    systemPrompt: extractionSystemPrompt(useVision),
    schemaName: "HeaultEvidenceExtraction",
    model: useVision ? visionModel : undefined,
    images,
    userPrompt: JSON.stringify({
      documentId,
      fileName,
      mimeType,
      ocrConfidence,
      pageCount: structuredOcr.lineCount ? undefined : imagePages.length,
      ocrText,
      structuredOcr: {
        lineCount: structuredOcr.lineCount,
        formattedText: structuredOcr.formattedText,
        sections: structuredOcr.sections,
        keyValuePairs: structuredOcr.keyValuePairs,
        tables: structuredOcr.tables,
      },
      instruction: "Extract structured facts first. Summary will be generated later only from verified facts.",
    }),
  }));
}

async function verifyExtractionWithAi({
  ocrText,
  structuredOcr,
  facts,
  imagePages,
  useVision,
  visionModel,
}: {
  ocrText: string;
  structuredOcr: StructuredOcr;
  facts: ExtractionFact[];
  imagePages: ImagePage[];
  useVision: boolean;
  visionModel: string;
}): Promise<VerificationResult> {
  if (!facts.length) {
    return {
      status: "needs_reupload",
      requiresHumanReview: true,
      facts: [],
      warnings: ["No evidence-backed facts were extracted."],
    };
  }

  try {
    const result = await generateJsonWithOllamaCloud({
      systemPrompt: verificationSystemPrompt(useVision),
      schemaName: "HeaultFactVerification",
      model: useVision ? visionModel : undefined,
      images: useVision ? imagePages.map((page) => page.base64) : undefined,
      userPrompt: JSON.stringify({
        ocrText,
        structuredOcr: {
          formattedText: structuredOcr.formattedText,
          sections: structuredOcr.sections,
        },
        facts: facts.map((fact, index) => ({
          index,
          type: fact.type,
          label: fact.label,
          value: fact.value,
          unit: fact.unit,
          referenceRange: fact.referenceRange,
          evidence: fact.evidence,
        })),
      }),
    });
    const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
    const factResults = Array.isArray(value.facts)
      ? value.facts.map((item) => {
        const factValue = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          index: Number(factValue.index),
          verified: Boolean(factValue.verified),
          reason: simpleText(factValue.reason) || "Verifier did not provide a reason.",
        };
      }).filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < facts.length)
      : [];

    if (!factResults.length) return codeVerifyFacts(facts, ocrText);

    return {
      status: simpleText(value.status).replace("needs_review", "needs_reupload") || (factResults.some((item) => !item.verified) ? "needs_reupload" : "verified"),
      requiresHumanReview: Boolean(value.requiresHumanReview) || factResults.some((item) => !item.verified),
      facts: factResults,
      warnings: normalizeStringList(value.warnings, 8),
    };
  } catch {
    return codeVerifyFacts(facts, ocrText);
  }
}

function applyVerification(facts: ExtractionFact[], verification: VerificationResult, ocrText: string) {
  const byIndex = new Map(verification.facts.map((item) => [item.index, item]));
  return facts.map((fact, index) => {
    const verified = byIndex.get(index);
    return {
      ...fact,
      verified: verified ? verified.verified : evidenceAppearsInOcr(fact.evidence, ocrText),
      verificationReason: verified?.reason || "Verified by fallback evidence check.",
    };
  });
}

function dedupeFacts(facts: ExtractionFact[]) {
  const byKey = new Map<string, ExtractionFact>();
  const typeRank: Record<string, number> = {
    date: 5,
    patient: 5,
    hospital: 5,
    doctor: 5,
    test: 5,
    medicine: 5,
    vaccination: 5,
    finding: 4,
    recommendation: 4,
    result: 3,
    fact: 2,
  };

  for (const fact of facts) {
    const key = [
      fact.type.toLowerCase(),
      fact.label.toLowerCase(),
      fact.value.toLowerCase(),
      fact.unit?.toLowerCase() || "",
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, fact);
      continue;
    }
    const existingScore = (typeRank[existing.type] || 1) + existing.confidence;
    const nextScore = (typeRank[fact.type] || 1) + fact.confidence;
    if (nextScore > existingScore) byKey.set(key, fact);
  }

  return [...byKey.values()];
}

function categoryFromExtraction(rawCategory: unknown) {
  const category = typeof rawCategory === "string" ? rawCategory.toLowerCase() : "";
  const map: Record<string, string> = {
    lab_report: "reports",
    imaging_report: "scans",
    discharge_summary: "reports",
    consultation_note: "reports",
    prescription: "prescriptions",
    vaccine_record: "vaccinations",
    vaccination_record: "vaccinations",
  };
  const normalized = map[category] || category;
  return new Set(["prescriptions", "reports", "scans", "certificates", "vaccinations", "others"]).has(normalized)
    ? normalized
    : "others";
}

function inferCategoryFromOcrText(ocrText: string) {
  if (/\b(rx|prescription|tablet|capsule|syrup|injection|ointment|drops|dose)\b/i.test(ocrText)) return "prescriptions";
  if (/\b(vaccine|vaccination|immunization|immunisation)\b/i.test(ocrText)) return "vaccinations";
  if (/\b(ultrasound|x-ray|xray|mri|ct scan|scan|radiology|impression)\b/i.test(ocrText)) return "scans";
  if (/\b(certificate|certified|fitness|medical certificate)\b/i.test(ocrText)) return "certificates";
  if (/\b(report|laborator(?:y|ies)|labs?|test|result|unit|reference range|hemoglobin|wbc|platelet|glucose)\b/i.test(ocrText)) return "reports";
  return "others";
}

function factValueByType(facts: ExtractionFact[], type: string) {
  return facts.find((fact) => fact.verified && fact.type === type)?.value || "";
}

const HOSPITAL_FACILITY_RE = /\b(hospital|clinic|medical\s+(centre|center|college)?|health\s*care|healthcare|diagnostics?|labs?|laborator(?:y|ies)|pathology|imaging|radiology|nursing\s+home|dental|eye\s+care|care\s+(centre|center))\b/i;
const HOSPITAL_REJECT_RE = /^#|\b(laboratory\s+test\s+reports?|lab\s+reports?|test\s+reports?|medical\s+reports?|reports?|prescription|invoice|receipt|bill|patient|uhid|mrn|age|sex|gender|dob|sample|specimen|collection|collected|received|reported|printed|result|unit|range|reference|doctor|dr\.?|consultant|department|investigation)\b/i;
const ADDRESS_WORD_RE = /\b(road|rd\.?|street|st\.?|nagar|colony|layout|sector|phase|near|opp\.?|opposite|floor|building|complex|city|district|state|pin|pincode|phone|mobile|email|www)\b/i;
const EXPLICIT_HOSPITAL_LABEL_RE = /^\s*(hospital|clinic|facility|diagnostics)(\s+name)?\s*[:\-]?\s*$/i;

function hasExplicitHospitalLabel(value: string) {
  const clean = cleanReadableLine(value);
  if (EXPLICIT_HOSPITAL_LABEL_RE.test(clean)) return true;
  return /^\s*(hospital|clinic|facility|diagnostics)(\s+name)?\s*[:\-]/i.test(clean);
}

function cleanHospitalCandidate(value: string) {
  const text = cleanReadableLine(value)
    .replace(/^\s*#+\s*/, "")
    .replace(/^\s*(hospital|clinic|lab|laboratory|diagnostics|facility|name)\s*[:\-]\s*/i, "")
    .replace(/\b(laboratory\s+test\s+reports?|lab\s+reports?|test\s+reports?|medical\s+reports?|reports?|prescription|invoice|receipt|bill)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const firstComma = text.split(",")[0]?.trim();
  if (firstComma && HOSPITAL_FACILITY_RE.test(firstComma)) return firstComma;
  return text;
}

function hospitalCandidateScore(value: string, lineIndex = 99) {
  const label = cleanHospitalCandidate(value);
  if (!label || label.length < 3 || label.length > 90) return 0;
  if (HOSPITAL_REJECT_RE.test(label)) return 0;
  if (/^\d+[\d\s,./-]*$/.test(label)) return 0;

  const words = label.split(/\s+/).filter(Boolean);
  const hasFacility = HOSPITAL_FACILITY_RE.test(label);
  if (!hasFacility && (words.length < 2 || ADDRESS_WORD_RE.test(label))) return 0;

  let score = hasFacility ? 8 : 3;
  if (lineIndex < 8) score += 2;
  else if (lineIndex < 20) score += 1;
  if (/^[A-Z0-9 .,&'()-]+$/.test(label) || /\b[A-Z][a-z]{2,}\b/.test(label)) score += 1;
  if (ADDRESS_WORD_RE.test(label)) score -= hasFacility ? 2 : 5;
  if ((label.match(/\d/g) || []).length > 6) score -= 2;
  if ((label.match(/,/g) || []).length > 1) score -= 1;
  if (words.length > 8) score -= 1;
  return Math.max(0, score);
}

function isLikelyHospitalName(value: string) {
  return hospitalCandidateScore(value) >= 5;
}

function hospitalSegmentsFromLine(value: string) {
  const clean = cleanReadableLine(value);
  const parts = clean
    .split(/\s{2,}|\t|\||•/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set([clean, ...parts])];
}

function inferHospitalFromOcr(structuredOcr: StructuredOcr) {
  const candidates = getOcrLines(structuredOcr.rawText)
    .slice(0, 60)
    .flatMap((line, index) => hospitalSegmentsFromLine(line.text).map((value) => ({
      value: cleanHospitalCandidate(value),
      score: hospitalCandidateScore(value, index),
    })))
    .filter((candidate) => candidate.value && candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length);

  return candidates[0]?.value || "";
}

function bestHospitalName(verifiedFacts: ExtractionFact[], structuredOcr: StructuredOcr) {
  const factCandidates = verifiedFacts
    .filter((fact) => fact.verified && fact.type === "hospital")
    .map((fact) => ({
      value: cleanHospitalCandidate(fact.value),
      score: hospitalCandidateScore(fact.value, 12) + 1,
    }));
  const ocrCandidate = inferHospitalFromOcr(structuredOcr);
  const candidates = [
    ...factCandidates,
    ...(ocrCandidate ? [{ value: ocrCandidate, score: hospitalCandidateScore(ocrCandidate, 0) }] : []),
  ]
    .filter((candidate) => candidate.value && candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length);

  return candidates[0]?.value || "";
}

function firstMeaningfulOcrLine(structuredOcr: StructuredOcr) {
  return getOcrLines(structuredOcr.rawText)
    .map((line) => line.text.trim())
    .find((line) => line && !/^page\s+\d+$/i.test(line)) || "";
}

function categoryTitleLabel(category: string) {
  const labels: Record<string, string> = {
    prescriptions: "Prescription",
    reports: "Report",
    scans: "Scan",
    certificates: "Certificate",
    vaccinations: "Vaccination record",
    others: "Medical document",
  };
  return labels[category] || "Medical document";
}

function usefulDocumentTitle(value: string, fileName: string) {
  const title = cleanReadableLine(value).replace(/\.[a-z0-9]{2,5}$/i, "");
  const fileBase = fileName.replace(/\.[^.]+$/, "").trim();
  if (!title || title.length < 5) return "";
  if (title.toLowerCase() === fileBase.toLowerCase()) return "";
  if (/^(designed|original document|document|medical document|page \d+)$/i.test(title)) return "";
  if (/^[-\s]*\d+\s+of\s+\d+[-\s]*$/i.test(title)) return "";
  const sourceOrTypeWords = /\b(report|prescription|scan|certificate|vaccine|vaccination|hospital|clinic|lab|labs|diagnostics?|medical|health|care|consultation|discharge|summary|record|test|result|radiology|pathology|doctor|dr\.?)\b/i;
  if (title.split(/\s+/).length === 1 && !sourceOrTypeWords.test(title)) return "";
  return title.slice(0, 90);
}

function documentTitleFromExtraction(extraction: Record<string, unknown>, structuredOcr: StructuredOcr, fileName: string) {
  const rawTitle = simpleText(extraction.title);
  const fileBase = fileName.replace(/\.[^.]+$/, "");
  return usefulDocumentTitle(rawTitle, fileName)
    || usefulDocumentTitle(firstMeaningfulOcrLine(structuredOcr), fileName)
    || fileBase
    || "Medical document";
}

function documentTitleForVault({
  extraction,
  structuredOcr,
  fileName,
  category,
  verifiedFacts,
}: {
  extraction: Record<string, unknown>;
  structuredOcr: StructuredOcr;
  fileName: string;
  category: string;
  verifiedFacts: ExtractionFact[];
}) {
  const hospital = bestHospitalName(verifiedFacts, structuredOcr);
  const doctor = factValueByType(verifiedFacts, "doctor");
  const date = factValueByType(verifiedFacts, "date");
  const typeLabel = categoryTitleLabel(category);

  if (hospital) return `${hospital} ${typeLabel}${date ? ` - ${date}` : ""}`.slice(0, 110);
  if (doctor) return `${doctor} ${typeLabel}${date ? ` - ${date}` : ""}`.slice(0, 110);

  return documentTitleFromExtraction(extraction, structuredOcr, fileName);
}

function buildFallbackSummary(title: string, category: string, verifiedFacts: ExtractionFact[]) {
  const categoryLabel = category.replace(/_/g, " ");
  const hospital = cleanHospitalCandidate(factValueByType(verifiedFacts, "hospital"));
  const doctor = factValueByType(verifiedFacts, "doctor");
  const date = factValueByType(verifiedFacts, "date");
  const patient = factValueByType(verifiedFacts, "patient");
  const sourceParts = [
    hospital ? `from ${hospital}` : "",
    doctor ? `by ${doctor}` : "",
    date ? `dated ${date}` : "",
  ].filter(Boolean);
  const lead = `${title || "This document"} is saved as ${categoryLabel}${sourceParts.length ? ` ${sourceParts.join(", ")}` : ""}.`;
  const patientLine = patient ? `Patient name found: ${patient}.` : "";
  return [lead, patientLine || "Open the original document for full clinical details."].filter(Boolean).join(" ");
}

function buildOcrOnlyAnalysis({
  fileName,
  ocrText,
  structuredOcr,
  ocrConfidence,
  warning,
}: {
  fileName: string;
  ocrText: string;
  structuredOcr: StructuredOcr;
  ocrConfidence?: number;
  warning: string;
}) {
  const category = inferCategoryFromOcrText(ocrText);
  const fallbackFacts = fallbackFactsFromStructuredOcr(structuredOcr, ocrConfidence);
  const factsWithStatus = dedupeFacts(applyVerification(
    fallbackFacts,
    codeVerifyFacts(fallbackFacts, ocrText),
    ocrText
  ));
  const verifiedFacts = factsWithStatus.filter((fact) => fact.verified);
  const title = documentTitleForVault({
    extraction: { primaryCategory: category },
    structuredOcr,
    fileName,
    category,
    verifiedFacts,
  });
  const summary = buildFallbackSummary(title, category, verifiedFacts);

  return {
    status: "ready",
    title,
    category,
    summary,
    clinicalSummary: summary,
    importantFindings: [],
    medicines: verifiedFacts
      .filter((fact) => fact.type === "medicine")
      .map((fact) => `${fact.label}: ${fact.value}`)
      .slice(0, 10),
    tests: verifiedFacts
      .filter((fact) => fact.type === "test")
      .map((fact) => `${fact.label}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}${fact.referenceRange ? ` (${fact.referenceRange})` : ""}`)
      .slice(0, 10),
    hospital: bestHospitalName(verifiedFacts, structuredOcr),
    doctor: factValueByType(verifiedFacts, "doctor"),
    patientName: factValueByType(verifiedFacts, "patient"),
    visitDate: factValueByType(verifiedFacts, "date"),
    tags: [category],
    confidence: Math.max(0, Math.min(1, ocrConfidence || 0.65)),
    needsReview: false,
    needsReupload: false,
    warnings: [warning, "OCR text and original file were saved. AI summary can be retried later."],
    structuredOcr,
    ocrConfidence,
    extractionMode: "ocr_text",
    verifiedFacts,
    rejectedFacts: factsWithStatus.filter((fact) => !fact.verified),
    verification: {
      status: "ocr_only",
      requiresHumanReview: false,
    },
  };
}

async function createVerifiedSummary({
  title,
  category,
  verifiedFacts,
}: {
  title: string;
  category: string;
  verifiedFacts: ExtractionFact[];
}) {
  const fallback = buildFallbackSummary(title, category, verifiedFacts);
  try {
    const result = await generateJsonWithOllamaCloud({
      systemPrompt: summarySystemPrompt(),
      schemaName: "HeaultVerifiedSummary",
      userPrompt: JSON.stringify({
        title,
        category,
        verifiedFacts: verifiedFacts.map((fact) => ({
          type: fact.type,
          label: fact.label,
          value: fact.value,
          unit: fact.unit,
          referenceRange: fact.referenceRange,
          evidence: fact.evidence,
        })),
      }),
    });
    const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
    return {
      summary: simpleText(value.summary) || fallback,
      clinicalSummary: simpleText(value.clinicalSummary) || fallback,
      importantFindings: normalizeStringList(value.importantFindings, 8),
      tags: normalizeStringList(value.tags, 8).map((tag) => tag.toLowerCase()),
    };
  } catch {
    return {
      summary: fallback,
      clinicalSummary: fallback,
      importantFindings: [],
      tags: [category].filter(Boolean),
    };
  }
}

function analysisSystemPrompt() {
  return [
    "You are a medical document indexing assistant for Heault.",
    "Use only the OCR text and structured OCR supplied by the user.",
    "Do not diagnose. Do not invent facts.",
    "Write for document retrieval, not clinical interpretation.",
    "Prefer document type, hospital, doctor, date, patient name, and category over broad findings.",
    "Mention tests, medicines, findings, values, vaccines, and procedures only when explicitly stated and useful for identifying the document.",
    "summary should be clear, specific, and useful for finding this record later, but must not add advice or external medical knowledge.",
    "clinicalSummary should be a clean doctor-facing note based only on uploaded document data, source, date, and type details.",
    "importantFindings should usually be empty unless the document itself states a critical instruction, vaccine, medicine, or result.",
    "medicines should list stated medicines with dosage/frequency only when present.",
    "tests should list stated tests, scans, panels, vaccines, or procedures.",
    "If the OCR is unclear or incomplete, set needsReview true and explain in warnings.",
    "Classify into one of: prescriptions, reports, scans, certificates, vaccinations, others.",
    "Return JSON only with this exact shape:",
    "{\"status\":\"ready\",\"title\":\"string\",\"category\":\"prescriptions|reports|scans|certificates|vaccinations|others\",\"summary\":\"2-4 clear sentences\",\"clinicalSummary\":\"string\",\"importantFindings\":[\"string\"],\"medicines\":[\"string\"],\"tests\":[\"string\"],\"hospital\":\"string or empty\",\"doctor\":\"string or empty\",\"visitDate\":\"YYYY-MM-DD or empty\",\"tags\":[\"short lowercase tag\"],\"confidence\":0.0,\"needsReview\":false,\"warnings\":[\"short warning\"]}.",
  ].join(" ");
}

function specialistSystemPrompt() {
  return [
    "You prepare a concise doctor-visit brief from user-uploaded medical records.",
    "Use only the supplied verifiedFacts and saved summaries.",
    "Do not use raw OCR. Do not infer missing facts.",
    "Do not diagnose. Do not invent facts.",
    "Clearly list information not found in uploaded records when relevant.",
    "Return JSON with keys: status, specialist, visitSummary, relevantDocuments, keyFindings, questionsToAsk, missingInformation, needsReview.",
  ].join(" ");
}

function needsReview(reason: string) {
  return {
    status: "needs_reupload",
    needsReview: false,
    needsReupload: true,
    reason,
  };
}

function normalizeStringList(value: unknown, limit = 10) {
  return Array.isArray(value)
    ? value.map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const objectValue = item as Record<string, unknown>;
        return simpleText(objectValue.value)
          || simpleText(objectValue.text)
          || simpleText(objectValue.reason)
          || simpleText(objectValue.evidence);
      }
      return String(item || "").trim();
    }).filter(Boolean).slice(0, limit)
    : [];
}

function normalizeDocumentAnalysis(result: unknown, fileName: string, structuredOcr: StructuredOcr) {
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
      : "Document indexed from OCR text. Open the original document for full details.",
    clinicalSummary: typeof value.clinicalSummary === "string" ? value.clinicalSummary.trim() : "",
    importantFindings: normalizeStringList(value.importantFindings),
    medicines: normalizeStringList(value.medicines),
    tests: normalizeStringList(value.tests),
    hospital: typeof value.hospital === "string" ? value.hospital.trim() : "",
    doctor: typeof value.doctor === "string" ? value.doctor.trim() : "",
    patientName: typeof value.patientName === "string" ? value.patientName.trim() : "",
    visitDate: typeof value.visitDate === "string" ? value.visitDate.trim() : "",
    tags,
    confidence: typeof value.confidence === "number" ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    needsReview: false,
    warnings,
    structuredOcr,
  };
}

function normalizeHybridDocumentAnalysis({
  fileName,
  structuredOcr,
  ocrConfidence,
  extraction,
  verifiedFacts,
  allFacts,
  verification,
  summaryResult,
  extractionMode,
  warnings,
}: {
  fileName: string;
  structuredOcr: StructuredOcr;
  ocrConfidence: number | undefined;
  extraction: Record<string, unknown>;
  verifiedFacts: ExtractionFact[];
  allFacts: ExtractionFact[];
  verification: VerificationResult;
  summaryResult: Awaited<ReturnType<typeof createVerifiedSummary>>;
  extractionMode: "ocr_text" | "ocr_plus_image";
  warnings: string[];
}) {
  const category = categoryFromExtraction(extraction.primaryCategory);
  const title = documentTitleForVault({
    extraction,
    structuredOcr,
    fileName,
    category,
    verifiedFacts,
  });
  const confidenceValues = verifiedFacts.map((fact) => fact.confidence).filter((value) => Number.isFinite(value));
  const averageFactConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;
  const confidence = Math.max(0, Math.min(1, averageFactConfidence || Number(extraction.confidence) || ocrConfidence || 0.4));
  const noVerifiedFacts = verifiedFacts.length === 0;
  const lowOcr = typeof ocrConfidence === "number" && ocrConfidence > 0 && ocrConfidence < 0.6;
  const severeLowOcr = typeof ocrConfidence === "number" && ocrConfidence > 0 && ocrConfidence < 0.22;
  const rejectedCount = allFacts.filter((fact) => !fact.verified).length;
  const blockingReview = noVerifiedFacts || severeLowOcr || (verification.requiresHumanReview && verifiedFacts.length < 2);
  const combinedWarnings = [
    ...warnings,
    ...verification.warnings,
    ...normalizeStringList(extraction.warnings, 8),
    ...normalizeStringList(extraction.unclear, 8).map((item) => `Unclear: ${item}`),
    ...(rejectedCount ? [`${rejectedCount} extracted fact(s) were rejected during verification.`] : []),
    ...(lowOcr ? ["OCR confidence is low; reupload a clearer original document."] : []),
    ...(noVerifiedFacts ? ["Could not verify metadata against the original document."] : []),
  ].filter(Boolean).slice(0, 10);

  return {
    status: blockingReview ? "needs_reupload" : "ready",
    title,
    category,
    summary: summaryResult.summary,
    clinicalSummary: summaryResult.clinicalSummary,
    importantFindings: summaryResult.importantFindings,
    medicines: verifiedFacts
      .filter((fact) => fact.type === "medicine")
      .map((fact) => `${fact.label}: ${fact.value}`)
      .slice(0, 10),
    tests: verifiedFacts
      .filter((fact) => fact.type === "test")
      .map((fact) => `${fact.label}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}${fact.referenceRange ? ` (${fact.referenceRange})` : ""}`)
      .slice(0, 10),
    hospital: bestHospitalName(verifiedFacts, structuredOcr),
    doctor: factValueByType(verifiedFacts, "doctor"),
    patientName: factValueByType(verifiedFacts, "patient"),
    visitDate: factValueByType(verifiedFacts, "date"),
    tags: summaryResult.tags.length ? summaryResult.tags : [category],
    confidence,
    needsReview: false,
    needsReupload: blockingReview,
    warnings: combinedWarnings,
    structuredOcr,
    ocrConfidence,
    extractionMode,
    verifiedFacts,
    rejectedFacts: allFacts.filter((fact) => !fact.verified),
    verification: {
      status: verification.status,
      requiresHumanReview: verification.requiresHumanReview,
    },
  };
}

function sanitizeDocumentsForSpecialist(documents: unknown[]) {
  return documents.map((item) => {
    const doc = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const verifiedFacts = Array.isArray(doc.verifiedFacts)
      ? doc.verifiedFacts.map((fact) => {
        const factValue = fact && typeof fact === "object" ? fact as Record<string, unknown> : {};
        return {
          type: simpleText(factValue.type),
          label: simpleText(factValue.label),
          value: simpleText(factValue.value),
          unit: simpleText(factValue.unit),
          referenceRange: simpleText(factValue.referenceRange),
          evidence: simpleText(factValue.evidence),
        };
      }).filter((fact) => fact.value && fact.evidence).slice(0, 30)
      : [];

    return {
      title: simpleText(doc.title),
      category: simpleText(doc.category),
      date: simpleText(doc.date),
      hospital: simpleText(doc.hospital),
      doctor: simpleText(doc.doctor),
      summary: simpleText(doc.summary),
      clinicalSummary: simpleText(doc.clinicalSummary),
      verifiedFacts,
      warnings: normalizeStringList(doc.warnings, 6),
      needsReview: Boolean(doc.needsReview),
    };
  }).filter((doc) => doc.verifiedFacts.length || doc.summary || doc.clinicalSummary);
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

router.get("/documents", requireAuth, async (req: AuthenticatedRequest, res) => {
  const documents = await getCollection("documents");
  if (!documents) {
    res.json({ documents: [] });
    return;
  }

  const records = await documents
    .find({
      userId: req.auth?.userId,
      deletedAt: { $exists: false },
    })
    .sort({ updatedAt: -1 })
    .limit(500)
    .toArray();
  res.json({ documents: records.map((record) => appDocumentFromRecord(record as Record<string, unknown>)) });
});

router.get("/storage/status", requireAuth, (_req: AuthenticatedRequest, res) => {
  const status = storageStatus();
  res.json({
    provider: status.provider,
    azureBlobConfigured: status.azureBlobConfigured,
    azureContainer: status.azureContainer,
  });
});

router.get("/documents/:documentId/originals/:index", requireAuth, async (req: AuthenticatedRequest, res) => {
  const documents = await getCollection("documents");
  if (!documents) {
    res.status(404).json({ error: "Document storage is not available." });
    return;
  }

  const record = await documents.findOne({
    documentId: req.params.documentId,
    userId: req.auth?.userId,
    deletedAt: { $exists: false },
  });

  if (!record) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  const originals = Array.isArray(record.originalFiles) && record.originalFiles.length
    ? record.originalFiles
    : record.originalStorage
      ? [record.originalStorage]
      : [];
  const index = Number.parseInt(String(req.params.index), 10);
  const original = originals[index] as StoredOriginal | undefined;

  if (!original) {
    res.status(404).json({ error: "Original file not found." });
    return;
  }

  try {
    const readable = await readStoredOriginal(original);
    res.setHeader("Content-Type", readable.mimeType);
    if (readable.size) res.setHeader("Content-Length", String(readable.size));
    res.setHeader("Content-Disposition", `inline; filename="${String(readable.fileName).replace(/"/g, "")}"`);
    readable.stream.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "Could not read original file." });
      else res.end();
    });
    readable.stream.pipe(res);
  } catch (error) {
    logEvent("original_stream_failed", {
      documentId: req.params.documentId,
      index,
      provider: original.provider,
      error: error instanceof Error ? error.message : "Could not stream original file.",
    });
    res.status(404).json({ error: "Original file could not be opened." });
  }
});

router.patch("/documents/:documentId", requireAuth, async (req: AuthenticatedRequest, res) => {
  const documents = await getCollection("documents");
  if (!documents) {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }

  const allowed = ["title", "category", "hospital", "doctor", "patientName", "visitDate", "tags", "summary", "structuredOcr"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) patch[key] = req.body[key];
  }
  await documents.updateOne(
    { documentId: req.params.documentId, userId: req.auth?.userId },
    { $set: { ...patch, updatedAt: new Date() } }
  );
  const record = await documents.findOne({ documentId: req.params.documentId, userId: req.auth?.userId });
  res.json({ document: record ? appDocumentFromRecord(record as Record<string, unknown>) : null });
});

router.delete("/documents/:documentId", requireAuth, async (req: AuthenticatedRequest, res) => {
  const documents = await getCollection("documents");
  if (documents) {
    await documents.updateOne(
      { documentId: req.params.documentId, userId: req.auth?.userId },
      { $set: { deletedAt: new Date(), updatedAt: new Date(), status: "deleted" } }
    );
  }
  res.json({ status: "deleted" });
});

router.post("/ocr", requireAuth, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  const file = req.file;
  const startedAt = Date.now();
  const documentId = typeof req.body?.documentId === "string" ? req.body.documentId : undefined;
  let storedOriginal: Awaited<ReturnType<typeof saveOriginalFile>> | undefined;

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

    storedOriginal = await saveOriginalFile({
      sourcePath: file.path,
      fileName: file.originalname,
      mimeType: file.mimetype,
      documentId,
    });

    if (isAzureDocumentIntelligenceConfigured() && (isImage(file.mimetype) || isPdf(file.mimetype, file.originalname))) {
      try {
        const azure = await runAzureLayoutOcr(file.path);
        const validation = validateOcrForUpload({
          text: azure.text,
          confidence: azure.confidence,
          provider: "azure_document_intelligence",
        });
        if (!validation.ok) {
          logEvent("ocr_rejected", {
            provider: "azure_document_intelligence",
            mimeType: file.mimetype,
            durationMs: Date.now() - startedAt,
            code: validation.code,
            confidence: azure.confidence,
            medicalScore: validation.medicalScore,
          });
          await upsertDocumentRecord(documentId, {
            ...authDocumentPatch(req),
            status: "needs_reupload",
            rejectionCode: validation.code,
            rejectionReason: validation.reason,
            fileName: file.originalname,
            mimeType: file.mimetype,
            ocrProvider: "azure_document_intelligence",
            ocrConfidence: azure.confidence,
            medicalScore: validation.medicalScore,
            originalStorage: storedOriginal,
          });
          res.status(validation.httpStatus).json(validationRejectedBody(validation, {
            provider: "azure_document_intelligence",
            fileName: file.originalname,
            mimeType: file.mimetype,
            ocrConfidence: azure.confidence,
            originalStorage: storedOriginal,
          }));
          return;
        }
        logEvent("ocr_finished", {
          provider: "azure_document_intelligence",
          mimeType: file.mimetype,
          durationMs: Date.now() - startedAt,
          textLength: azure.text.length,
          confidence: azure.confidence,
          pageCount: azure.pageLevelText.length,
          tableCount: azure.layout.tables.length,
        });
        await upsertDocumentRecord(documentId, {
          ...authDocumentPatch(req),
          status: "ocr_complete",
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrProvider: "azure_document_intelligence",
          ocrText: azure.text,
          ocrConfidence: azure.confidence,
          pageLevelText: azure.pageLevelText,
          medicalScore: validation.medicalScore,
          layout: {
            modelId: azure.layout.modelId,
            apiVersion: azure.layout.apiVersion,
            tables: azure.layout.tables,
            keyValuePairs: azure.layout.keyValuePairs,
          },
          originalStorage: storedOriginal,
        });
        res.json({
          status: "ok",
          provider: "azure_document_intelligence",
          fileName: file.originalname,
          mimeType: file.mimetype,
          rawOcrText: azure.text,
          cleanedOcrText: azure.text,
          ocrText: azure.text,
          ocrConfidence: azure.confidence,
          medicalScore: validation.medicalScore,
          minOcrConfidence: validation.minConfidence,
          pageLevelText: azure.pageLevelText,
          layout: {
            modelId: azure.layout.modelId,
            apiVersion: azure.layout.apiVersion,
            tables: azure.layout.tables,
            keyValuePairs: azure.layout.keyValuePairs,
          },
          originalStorage: storedOriginal,
        });
        return;
      } catch (error) {
        logEvent("ocr_provider_failed", {
          provider: "azure_document_intelligence",
          mimeType: file.mimetype,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : "Azure OCR failed",
        });

        if (error instanceof AzureDocumentIntelligenceConfigurationError) {
          throw error;
        }
        await upsertDocumentRecord(documentId, {
          ...authDocumentPatch(req),
          status: "retry_later",
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrProvider: "azure_document_intelligence",
          originalStorage: storedOriginal,
        });
        res.status(azureRetryStatus(error)).json({
          status: "retry_later",
          code: "AZURE_OCR_UNAVAILABLE",
          error: "Azure Document Intelligence is temporarily unavailable. Please retry in a minute.",
          reason: "Azure Document Intelligence is temporarily unavailable. Please retry in a minute.",
          provider: "azure_document_intelligence",
          originalStorage: storedOriginal,
        });
        return;
      }
    }

    if (isImage(file.mimetype)) {
      const ocr = await runImageOcr(file.path);
      const text = ocr.text;
      const validation = validateOcrForUpload({
        text,
        confidence: ocr.confidence,
        provider: "tesseract",
      });
      if (!validation.ok) {
        logEvent("ocr_rejected", {
          provider: "tesseract",
          mimeType: file.mimetype,
          durationMs: Date.now() - startedAt,
          code: validation.code,
          confidence: ocr.confidence,
          medicalScore: validation.medicalScore,
        });
        await upsertDocumentRecord(documentId, {
          ...authDocumentPatch(req),
          status: "needs_reupload",
          rejectionCode: validation.code,
          rejectionReason: validation.reason,
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrProvider: "tesseract",
          ocrConfidence: ocr.confidence,
          medicalScore: validation.medicalScore,
          originalStorage: storedOriginal,
        });
        res.status(validation.httpStatus).json(validationRejectedBody(validation, {
          provider: "tesseract",
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrConfidence: ocr.confidence,
          originalStorage: storedOriginal,
        }));
        return;
      }
      logEvent("ocr_finished", {
        provider: "tesseract",
        mimeType: file.mimetype,
        durationMs: Date.now() - startedAt,
        textLength: text.length,
        confidence: ocr.confidence,
      });
      res.json({
        status: "ok",
        provider: "tesseract",
        fileName: file.originalname,
        mimeType: file.mimetype,
        rawOcrText: text,
        cleanedOcrText: text,
        ocrText: text,
        ocrConfidence: ocr.confidence,
        medicalScore: validation.medicalScore,
        minOcrConfidence: validation.minConfidence,
        pageLevelText: [{ page: 1, text, confidence: ocr.confidence }],
        originalStorage: storedOriginal,
      });
      await upsertDocumentRecord(documentId, {
        ...authDocumentPatch(req),
        status: "ocr_complete",
        fileName: file.originalname,
        mimeType: file.mimetype,
        ocrProvider: "tesseract",
        ocrText: text,
        ocrConfidence: ocr.confidence,
        pageLevelText: [{ page: 1, text, confidence: ocr.confidence }],
        medicalScore: validation.medicalScore,
        originalStorage: storedOriginal,
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
        await upsertDocumentRecord(documentId, {
          ...authDocumentPatch(req),
          status: "needs_reupload",
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrProvider: "pdf_parse",
          rejectionCode: "SCANNED_PDF_UNSUPPORTED",
          originalStorage: storedOriginal,
        });
        res.status(422).json({
          status: "needs_reupload",
          error: "Scanned PDF OCR is not supported yet.",
          reason: "Scanned PDF OCR is not supported yet. Reupload clear images or a text-based PDF.",
          ocrText: "",
          pageLevelText: [],
        });
        return;
      }

      const validation = validateOcrForUpload({
        text,
        confidence: 0.98,
        provider: "pdf_parse",
      });
      if (!validation.ok) {
        logEvent("ocr_rejected", {
          provider: "pdf_parse",
          mimeType: file.mimetype,
          durationMs: Date.now() - startedAt,
          code: validation.code,
          confidence: 0.98,
          medicalScore: validation.medicalScore,
        });
        await upsertDocumentRecord(documentId, {
          ...authDocumentPatch(req),
          status: "needs_reupload",
          rejectionCode: validation.code,
          rejectionReason: validation.reason,
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrProvider: "pdf_parse",
          ocrConfidence: 0.98,
          medicalScore: validation.medicalScore,
          originalStorage: storedOriginal,
        });
        res.status(validation.httpStatus).json(validationRejectedBody(validation, {
          provider: "pdf_parse",
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrConfidence: 0.98,
          originalStorage: storedOriginal,
        }));
        return;
      }

      logEvent("ocr_finished", {
        provider: "pdf_parse",
        mimeType: file.mimetype,
        durationMs: Date.now() - startedAt,
        textLength: text.length,
        confidence: 0.98,
      });
      res.json({
        status: "ok",
        provider: "pdf_parse",
        fileName: file.originalname,
        mimeType: file.mimetype,
        rawOcrText: text,
        cleanedOcrText: text,
        ocrText: text,
        ocrConfidence: 0.98,
        medicalScore: validation.medicalScore,
        minOcrConfidence: validation.minConfidence,
        pageLevelText: [{ page: 1, text, confidence: 0.98 }],
        originalStorage: storedOriginal,
      });
      await upsertDocumentRecord(documentId, {
        ...authDocumentPatch(req),
        status: "ocr_complete",
        fileName: file.originalname,
        mimeType: file.mimetype,
        ocrProvider: "pdf_parse",
        ocrText: text,
        ocrConfidence: 0.98,
        pageLevelText: [{ page: 1, text, confidence: 0.98 }],
        medicalScore: validation.medicalScore,
        originalStorage: storedOriginal,
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
      status: "needs_reupload",
      error: "OCR failed.",
      reason: "OCR failed. Reupload a clearer medical document.",
      ocrText: "",
      pageLevelText: [],
    });
  } finally {
    await fs.unlink(file.path).catch(() => undefined);
  }
});

router.post("/analyze-document", requireAuth, async (req: AuthenticatedRequest, res) => {
  const { documentId, fileName, mimeType, ocrText, ocrConfidence, imagePages } = req.body || {};
  const startedAt = Date.now();
  let structuredOcr: StructuredOcr | undefined;
  const parsedOcrConfidence = Number.isFinite(Number(ocrConfidence))
    ? Math.max(0, Math.min(1, Number(ocrConfidence)))
    : undefined;

  if (!documentId || !fileName || !mimeType || typeof ocrText !== "string") {
    res.status(400).json({ error: "documentId, fileName, mimeType, and ocrText are required." });
    return;
  }

  if (!ocrText.trim()) {
    res.status(422).json(needsReview("OCR text is empty."));
    return;
  }

  try {
    const normalizedImagePages = normalizeImagePages(imagePages);
    logEvent("ai_analysis_started", {
      documentId,
      fileName,
      mimeType,
      ocrLength: ocrText.length,
      ocrConfidence: parsedOcrConfidence,
      imagePageCount: normalizedImagePages.length,
    });
    // TODO: Production must include explicit user consent before sending medical documents or OCR text to cloud AI.
    structuredOcr = await createStructuredOcr(ocrText);
    logEvent("structured_ocr_finished", {
      documentId,
      durationMs: Date.now() - startedAt,
      lineCount: structuredOcr.lineCount,
      warningCount: structuredOcr.warnings.length,
    });

    const visionModel = getVisionModel();
    const visionRecommended = shouldUseVision({
      fileName,
      mimeType,
      ocrText,
      ocrConfidence: parsedOcrConfidence,
      structuredOcr,
      imagePages: normalizedImagePages,
    });
    const useVision = Boolean(visionRecommended && visionModel);
    const routeWarnings: string[] = [];

    logEvent("ai_extraction_started", {
      documentId,
      mode: useVision ? "ocr_plus_image" : "ocr_text",
      visionRecommended,
    });

    let extractionUsedVision = useVision;
    let extraction = await createEvidenceExtraction({
      documentId,
      fileName,
      mimeType,
      ocrText,
      ocrConfidence: parsedOcrConfidence,
      structuredOcr,
      imagePages: normalizedImagePages,
      useVision,
      visionModel,
    }).catch(async (error) => {
      if (!useVision) throw error;
      extractionUsedVision = false;
      routeWarnings.push("Vision extraction failed. Retried with OCR text only.");
      return createEvidenceExtraction({
        documentId,
        fileName,
        mimeType,
        ocrText,
        ocrConfidence: parsedOcrConfidence,
        structuredOcr: structuredOcr as StructuredOcr,
        imagePages: [],
        useVision: false,
        visionModel: "",
      });
    });
    extraction = normalizeExtractionResult(extraction);
    if (!simpleText(extraction.primaryCategory)) {
      extraction.primaryCategory = inferCategoryFromOcrText(ocrText);
    }
    let facts = normalizeExtractionFacts(extraction);
    let usedFallbackFacts = false;
    if (!facts.length) {
      facts = fallbackFactsFromStructuredOcr(structuredOcr, parsedOcrConfidence);
      if (facts.length) {
        usedFallbackFacts = true;
        routeWarnings.push("Structured extraction was limited, so Heault saved exact OCR-backed lines.");
        if (categoryFromExtraction(extraction.primaryCategory) === "others") {
          extraction.primaryCategory = inferCategoryFromOcrText(ocrText);
        }
      }
    }
    const verification = codeVerifyFacts(facts, ocrText);
    const verifiedFactsWithStatus = dedupeFacts(applyVerification(facts, verification, ocrText));
    const verifiedFacts = verifiedFactsWithStatus.filter((fact) => fact.verified);
    verification.warnings = verification.warnings.filter((warning) => !/duplicate/i.test(warning));
    const category = categoryFromExtraction(extraction.primaryCategory);
    const documentTitle = documentTitleForVault({
      extraction,
      structuredOcr,
      fileName,
      category,
      verifiedFacts,
    });
    const summaryResult = await createVerifiedSummary({
      title: documentTitle,
      category,
      verifiedFacts,
    });
    const normalized = normalizeHybridDocumentAnalysis({
      fileName,
      structuredOcr,
      ocrConfidence: parsedOcrConfidence,
      extraction,
      verifiedFacts,
      allFacts: verifiedFactsWithStatus,
      verification,
      summaryResult,
      extractionMode: extractionUsedVision ? "ocr_plus_image" : "ocr_text",
      warnings: routeWarnings,
    });
    logEvent("ai_analysis_finished", {
      documentId,
      durationMs: Date.now() - startedAt,
      category: normalized.category,
      needsReview: normalized.needsReview,
      mode: normalized.extractionMode,
      verifiedFactCount: normalized.verifiedFacts.length,
    });
    await upsertDocumentRecord(documentId, {
      ...authDocumentPatch(req),
      status: normalized.status,
      title: normalized.title,
      category: normalized.category,
      hospital: normalized.hospital,
      doctor: normalized.doctor,
      patientName: normalized.patientName,
      visitDate: normalized.visitDate,
      summary: normalized.summary,
      clinicalSummary: normalized.clinicalSummary,
      tags: normalized.tags,
      structuredOcr: normalized.structuredOcr,
      verifiedFacts: normalized.verifiedFacts,
      rejectedFacts: normalized.rejectedFacts,
      confidence: normalized.confidence,
      warnings: normalized.warnings,
      needsReview: normalized.needsReview,
    });
    res.json(normalized);
  } catch (error) {
    logEvent("ai_analysis_failed", {
      documentId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown AI error",
    });
    if (structuredOcr) {
      const fallback = buildOcrOnlyAnalysis({
        fileName,
        ocrText,
        structuredOcr,
        ocrConfidence: parsedOcrConfidence,
        warning: error instanceof OllamaUnavailableError
          ? "Ollama Cloud is temporarily unreachable."
          : error instanceof OllamaInvalidJsonError
            ? "AI returned an invalid response."
            : error instanceof OllamaConfigurationError
              ? "AI configuration is incomplete."
              : "AI analysis failed.",
      });
      await upsertDocumentRecord(documentId, {
        ...authDocumentPatch(req),
        status: fallback.status,
        title: fallback.title,
        category: fallback.category,
        hospital: fallback.hospital,
        doctor: fallback.doctor,
        patientName: fallback.patientName,
        visitDate: fallback.visitDate,
        summary: fallback.summary,
        clinicalSummary: fallback.clinicalSummary,
        tags: fallback.tags,
        structuredOcr: fallback.structuredOcr,
        verifiedFacts: fallback.verifiedFacts,
        rejectedFacts: fallback.rejectedFacts,
        confidence: fallback.confidence,
        warnings: fallback.warnings,
        needsReview: false,
      });
      res.json(fallback);
      return;
    }
    const mapped = mapAiError(error);
    await upsertDocumentRecord(documentId, {
      ...authDocumentPatch(req),
      status: "needs_reupload",
      analysisError: mapped.body.reason,
      structuredOcr: structuredOcr || fallbackStructuredOcr(ocrText, "Structured OCR was saved, but AI analysis failed."),
    });
    res.status(mapped.httpStatus).json({
      ...mapped.body,
      structuredOcr: structuredOcr || fallbackStructuredOcr(ocrText, "Structured OCR was saved, but AI analysis failed."),
    });
  }
});

router.post("/specialist-summary", requireAuth, async (_req: AuthenticatedRequest, res) => {
  const req = _req;
  const { specialist, documents } = req.body || {};

  if (!specialist || !Array.isArray(documents)) {
    res.status(400).json({ error: "specialist and saved document data are required." });
    return;
  }

  try {
    const safeDocuments = sanitizeDocumentsForSpecialist(documents);
    // TODO: Production must include explicit user consent before sending medical documents or OCR text to cloud AI.
    const result = await generateJsonWithOllamaCloud({
      systemPrompt: specialistSystemPrompt(),
      schemaName: "HeaultSpecialistSummary",
      userPrompt: JSON.stringify({
        specialist,
        documents: safeDocuments,
        instruction: "Generate the visit brief only from verifiedFacts and saved summaries. Do not use raw OCR.",
      }),
    });
    res.json(result);
  } catch (error) {
    const mapped = mapAiError(error);
    res.status(mapped.httpStatus).json(mapped.body);
  }
});

export default router;
