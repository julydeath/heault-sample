export type OcrValidationInput = {
  text: string;
  confidence?: number;
  provider: string;
};

export type OcrValidationResult =
  | { ok: true; medicalScore: number; minConfidence: number }
  | { ok: false; code: string; reason: string; httpStatus: number; medicalScore: number; minConfidence: number };

const MEDICAL_PATTERNS = [
  /\b(hospital|clinic|medical|healthcare|health care|nursing home)\b/i,
  /\b(dr\.?|doctor|physician|consultant|surgeon|dentist|specialist)\b/i,
  /\b(patient|uhid|mrn|opd|ipd|dob|age|sex|gender)\b/i,
  /\b(prescription|rx|tablet|capsule|syrup|injection|dose|dosage)\b/i,
  /\b(lab|laborator(?:y|ies)|diagnostics?|pathology|radiology)\b/i,
  /\b(report|test|result|reference range|unit|specimen|sample|collected|reported)\b/i,
  /\b(x[-\s]?ray|mri|ct scan|ultrasound|scan|imaging|impression)\b/i,
  /\b(vaccine|vaccination|immuni[sz]ation|booster)\b/i,
  /\b(hemoglobin|wbc|rbc|platelets?|glucose|creatinine|cholesterol|tsh|hba1c|bilirubin)\b/i,
  /\b(mg\/dL|g\/dL|mmol\/L|IU\/L|uIU\/mL|mmHg|bpm|cells\/|%|mg|mcg|ml)\b/i,
  /\b(diagnosis|diagnostic|symptoms?|treatment|advice|follow[-\s]?up|procedure)\b/i,
];

export function minOcrConfidence() {
  const value = Number(process.env.MIN_OCR_CONFIDENCE || 0.95);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.95;
}

export function medicalDocumentScore(text: string) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return 0;

  const keywordScore = MEDICAL_PATTERNS.reduce((score, pattern) => score + (pattern.test(normalized) ? 1 : 0), 0);
  const tableSignal = /\b(result|unit|range|normal|high|low)\b/i.test(normalized) && /\d/.test(normalized) ? 1 : 0;
  const sourceSignal = /\b(hospital|clinic|doctor|patient|lab|diagnostics?)\b/i.test(normalized) ? 1 : 0;
  return keywordScore + tableSignal + sourceSignal;
}

export function validateOcrForUpload({ text, confidence, provider }: OcrValidationInput): OcrValidationResult {
  const minConfidence = minOcrConfidence();
  const parsedConfidence = Number(confidence);
  const usableConfidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0;
  const medicalScore = medicalDocumentScore(text);

  if (!String(text || "").trim()) {
    return {
      ok: false,
      code: "EMPTY_OCR_TEXT",
      reason: "We could not read text from this file. Please reupload a clearer medical document.",
      httpStatus: 422,
      medicalScore,
      minConfidence,
    };
  }

  if (usableConfidence < minConfidence) {
    return {
      ok: false,
      code: "LOW_OCR_CONFIDENCE",
      reason: `OCR confidence is below ${Math.round(minConfidence * 100)}%. Please retake or reupload a clearer medical document.`,
      httpStatus: 422,
      medicalScore,
      minConfidence,
    };
  }

  if (medicalScore < 2) {
    return {
      ok: false,
      code: "NOT_MEDICAL_DOCUMENT",
      reason: "This does not look like a medical document. Please upload a hospital, doctor, lab, scan, prescription, certificate, or vaccination record.",
      httpStatus: 422,
      medicalScore,
      minConfidence,
    };
  }

  return { ok: true, medicalScore, minConfidence };
}
