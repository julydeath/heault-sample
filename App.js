import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import {
  BadgeCheck,
  BatteryFull,
  Building2,
  Calendar,
  CalendarClock,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crop,
  Download,
  Edit3,
  Eye,
  FileCheck2,
  Files,
  FileText,
  Filter,
  FolderOpen,
  Globe,
  Heart,
  HelpCircle,
  Home,
  Image as ImageIcon,
  Info,
  Lock,
  Maximize2,
  MoreHorizontal,
  Phone,
  Pill,
  Plus,
  RefreshCcw,
  RotateCw,
  ScanLine,
  Search,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  SignalHigh,
  SortAsc,
  Sparkles,
  Stethoscope,
  Syringe,
  Tags,
  Trash2,
  Type,
  User,
  UserRound,
  Wifi,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";

const C = {
  bg: "#F7F8FA",
  bg2: "#FBFCFD",
  surface: "#FFFFFF",
  surface2: "#F2F4F7",
  cream: "#F8F3EA",
  blush: "#F7E8EE",
  blushStrong: "#FA8DB1",
  primary: "#741636",
  primary2: "#9B3C5A",
  primary3: "#C76886",
  ink: "#24121B",
  text: "#44303A",
  muted: "#8F737D",
  line: "#F1DAE1",
  line2: "#EADFE0",
  green: "#5DA977",
  greenSoft: "#E8F8EC",
  blue: "#4E7DD9",
  blueSoft: "#EDF4FF",
  amber: "#B96B32",
  amberSoft: "#FFF1DF",
  red: "#C24654",
  redSoft: "#FFE8EC",
};

const MAX_ANALYSIS_IMAGE_COUNT = 3;
const MAX_ANALYSIS_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_ANALYSIS_IMAGE_CHARS = 12_000_000;

function normalizeApiBaseUrl(value) {
  const fallback = Platform.OS === "android" ? "http://127.0.0.1:4000" : "http://localhost:4000";
  const raw = String(value || fallback).trim().replace(/\/+$/, "");
  return raw.replace(/^https:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i, "http://$1$2");
}

const API_BASE_URL = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_HEAULT_API_URL);

const VAULT_DIR = `${FileSystem.documentDirectory || ""}heault-originals/`;
const STATE_FILE = `${FileSystem.documentDirectory || ""}heault-state.json`;

function normalizeServerUser(user = {}) {
  const phone = user.phoneE164 || user.phone || "";
  return {
    id: user.id || phone || "local-user",
    name: user.name || (phone ? "Heault User" : ""),
    phone,
    dob: user.dob || "",
    gender: user.gender || "",
    blood: user.blood || "",
    photo: user.photo || "",
    lastDoctorVisit: {
      doctor: "",
      hospital: "",
      date: "-",
      reason: "",
    },
    vaccineRecord: {
      total: 0,
      latest: "",
      next: "",
    },
  };
}

async function readSavedState() {
  try {
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(STATE_FILE));
  } catch {
    return null;
  }
}

async function writeSavedState(state) {
  if (!FileSystem.documentDirectory) return;
  await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(state));
}

async function clearSavedState() {
  await FileSystem.deleteAsync(STATE_FILE, { idempotent: true }).catch(() => undefined);
}

async function apiRequest(path, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.reason || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requestOtpStart(countryCode, phone, mode = "login") {
  return apiRequest("/api/auth/start", { method: "POST", body: { countryCode, phone, mode } });
}

async function requestOtpVerify({ countryCode, phone, phoneE164, code, mode = "login" }) {
  return apiRequest("/api/auth/verify", { method: "POST", body: { countryCode, phone, phoneE164, code, mode } });
}

async function requestMe(token) {
  return apiRequest("/api/me", { token });
}

async function requestProfileUpdate(token, profile) {
  return apiRequest("/api/me", { method: "PATCH", token, body: profile });
}

async function requestDocuments(token) {
  return apiRequest("/api/documents", { token });
}

async function requestDeleteDocument(token, documentId) {
  return apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, { method: "DELETE", token });
}

async function requestUpdateDocument(token, documentId, patch) {
  return apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, { method: "PATCH", token, body: patch });
}

async function requestLogout(token) {
  if (!token) return;
  await apiRequest("/api/auth/logout", { method: "POST", token }).catch(() => undefined);
}

const initialUser = {
  name: "",
  phone: "",
  dob: "",
  gender: "",
  blood: "",
  photo: "",
  lastDoctorVisit: {
    doctor: "",
    hospital: "",
    date: "-",
    reason: "",
  },
  vaccineRecord: {
    total: 0,
    latest: "",
    next: "",
  },
};

const CATEGORIES = [
  { id: "prescriptions", label: "Prescriptions", icon: FileText, tint: C.blush, color: C.primary },
  { id: "reports", label: "Reports", icon: FileCheck2, tint: C.blueSoft, color: C.blue },
  { id: "scans", label: "Scans", icon: ScanLine, tint: C.amberSoft, color: C.amber },
  { id: "certificates", label: "Certificates", icon: BadgeCheck, tint: C.greenSoft, color: C.green },
  { id: "vaccinations", label: "Vaccinations", icon: Syringe, tint: "#F3EAFE", color: "#7E4CC2" },
  { id: "others", label: "Others", icon: FolderOpen, tint: "#F3ECEE", color: C.text },
];

const RECORD_CARD_GRADS = {
  prescriptions: ["#FF7CA5", "#7A123A"],
  reports: ["#3D82FF", "#071846"],
  scans: ["#E8A15A", "#6D281F"],
  certificates: ["#79D994", "#1F5532"],
  vaccinations: ["#8BD84D", "#18380F"],
  others: ["#B48B7F", "#321B21"],
};

const DECK_CARD_HEIGHT = 248;
const DECK_STEP = 58;

const initialDocs = [
  {
    id: "d1",
    title: "CBC Lab Report",
    category: "reports",
    date: "9 Jul 2026",
    sortDate: 1783555200000,
    doctor: "Dr. Rhea Kapoor",
    hospital: "MediCare Labs",
    tags: ["cbc", "blood", "annual"],
    pages: 2,
    ocr: "Complete blood count, hemoglobin 13.2, WBC normal, platelet count normal, reviewed by Dr. Rhea Kapoor.",
  },
  {
    id: "d2",
    title: "Dental Prescription",
    category: "prescriptions",
    date: "2 Jul 2026",
    sortDate: 1782950400000,
    doctor: "Dr. Nikhil Varma",
    hospital: "Pearl Dental Care",
    tags: ["dental", "rx"],
    pages: 1,
    ocr: "Amoxicillin course, mouth rinse, dental pain follow up after 5 days.",
  },
  {
    id: "d3",
    title: "Chest X-Ray Scan",
    category: "scans",
    date: "17 Jun 2026",
    sortDate: 1781654400000,
    doctor: "Dr. Shanaya Mehta",
    hospital: "City Imaging Center",
    tags: ["xray", "chest"],
    pages: 1,
    ocr: "Chest radiograph. Lung fields clear. No acute cardiopulmonary abnormality.",
  },
  {
    id: "d4",
    title: "Fitness Certificate",
    category: "certificates",
    date: "8 Jun 2026",
    sortDate: 1780876800000,
    doctor: "Dr. Rhea Kapoor",
    hospital: "MediCare Clinic",
    tags: ["certificate", "fitness"],
    pages: 1,
    ocr: "Certified medically fit for travel and general activity.",
  },
  {
    id: "d5",
    title: "Vaccination Record",
    category: "vaccinations",
    date: "18 May 2026",
    sortDate: 1779062400000,
    doctor: "Public Health Center",
    hospital: "Community Health Clinic",
    tags: ["vaccine", "influenza"],
    pages: 3,
    ocr: "Influenza vaccine administered. Booster due in October 2026.",
  },
  {
    id: "d6",
    title: "Insurance Medical Form",
    category: "others",
    date: "30 Apr 2026",
    sortDate: 1777507200000,
    doctor: "Admin Desk",
    hospital: "LifeCare Insurance",
    tags: ["insurance", "form"],
    pages: 4,
    ocr: "Medical declaration form and policy health questionnaire.",
  },
];

function categoryFor(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function docMatches(doc, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const group = recordGroupForDoc(doc);
  return [doc.title, doc.category, doc.hospital, doc.doctor, doc.patientName, group.label, group.helper, doc.ocr, ...(doc.tags || [])]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function formatDate(value = new Date()) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${value.getDate()} ${months[value.getMonth()]} ${value.getFullYear()}`;
}

function safeFileName(name = "medical-document") {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 90) || "medical-document";
}

function titleFromFileName(name = "Medical Document") {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Medical Document";
}

function extensionFromAsset(asset) {
  const fromName = asset.name || asset.fileName || "";
  const nameMatch = fromName.match(/\.([a-zA-Z0-9]+)$/);
  if (nameMatch) return nameMatch[1].toLowerCase();
  const uriMatch = String(asset.uri || "").match(/\.([a-zA-Z0-9]+)(\?|$)/);
  if (uriMatch) return uriMatch[1].toLowerCase();
  if ((asset.mimeType || "").includes("pdf")) return "pdf";
  if ((asset.mimeType || "").includes("png")) return "png";
  return "jpg";
}

function inferMimeType(asset) {
  if (asset.mimeType) return asset.mimeType;
  const ext = extensionFromAsset(asset);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function statusCopy(status) {
  const map = {
    queued: ["Queued", C.amber, C.amberSoft],
    processing: ["Processing", C.blue, C.blueSoft],
    ocr_complete: ["OCR ready", C.blue, C.blueSoft],
    ready: ["Ready", C.green, C.greenSoft],
    needs_review: ["Reupload", C.red, C.redSoft],
    needs_reupload: ["Reupload", C.red, C.redSoft],
  };
  return map[status] || map.ready;
}

function isKnownCategory(category) {
  return CATEGORIES.some((item) => item.id === category);
}

function isProcessingStatus(status) {
  return ["queued", "processing", "ocr_complete"].includes(status);
}

function isReuploadStatus(status) {
  return ["needs_review", "needs_reupload"].includes(status);
}

function normalizeGroupName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:a\s+)?unit\s+of\b.*$/g, "")
    .replace(/\b(the|and|of|hospital|hospitals|clinic|clinics|medical|centre|center|healthcare|health|care|labs?|laborator(?:y|ies)|diagnostics?|pvt|private|ltd|limited|llp|inc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTokens(value = "") {
  return normalizeGroupName(value).split(" ").filter(Boolean);
}

function shouldMergeGroupNames(a = "", b = "", sameBatch = false) {
  const aTokens = normalizedTokens(a);
  const bTokens = normalizedTokens(b);
  if (!aTokens.length || !bTokens.length) return false;
  const aNorm = aTokens.join(" ");
  const bNorm = bTokens.join(" ");
  if (aNorm === bNorm) return true;

  const shorter = aNorm.length <= bNorm.length ? aNorm : bNorm;
  const longer = aNorm.length > bNorm.length ? aNorm : bNorm;
  if (shorter.length >= 5 && longer.includes(shorter)) return true;

  const common = aTokens.filter((token) => bTokens.includes(token));
  const overlap = common.length / Math.min(aTokens.length, bTokens.length);
  if (Math.min(aTokens.length, bTokens.length) >= 2 && overlap >= 0.75) return true;
  if (aTokens[0] === bTokens[0] && /\d/.test(aTokens[0]) && Math.min(aTokens.length, bTokens.length) === 1) return true;

  return sameBatch && aTokens[0] === bTokens[0] && (common.length >= 2 || Math.min(aTokens.length, bTokens.length) === 1);
}

function findCompatibleGroup(map, group, doc) {
  if (!["hospital", "doctor", "patient"].includes(group.type)) return null;
  for (const existing of map.values()) {
    if (existing.type !== group.type) continue;
    const sameBatch = Boolean(doc.batchId && existing.docs.some((item) => item.batchId === doc.batchId));
    if (shouldMergeGroupNames(existing.label, group.label, sameBatch)) return existing;
  }
  return null;
}

function periodFromDate(value = "") {
  const text = String(value || "").trim();
  if (!text) return "Unsorted documents";
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  }
  const match = text.match(/\b([A-Za-z]{3,9})\s+(\d{4})\b/);
  return match ? `${match[1].slice(0, 3)} ${match[2]}` : text;
}

function groupLabelForMode(mode) {
  const labels = {
    hospital: "Hospital",
    doctor: "Doctor",
    patient: "Patient",
    period: "Period",
  };
  return labels[mode] || "File";
}

function recordGroupForDoc(doc = {}, mode = "hospital") {
  const hospital = String(doc.hospital || "").trim();
  const doctor = String(doc.doctor || "").trim();
  const patient = String(doc.patientName || doc.patient || "").trim();
  const period = periodFromDate(doc.date);

  if (mode === "doctor") {
    if (doctor) {
      return {
        type: "doctor",
        label: doctor,
        key: `doctor:${normalizeGroupName(doctor) || doctor.toLowerCase()}`,
        helper: hospital ? `${hospital} - ${period}` : period,
      };
    }
    return {
      type: "period",
      label: period,
      key: `doctor-missing:${normalizeGroupName(period) || "unsorted"}`,
      helper: hospital ? `No doctor found - ${hospital}` : "No doctor found",
    };
  }

  if (mode === "patient") {
    if (patient) {
      return {
        type: "patient",
        label: patient,
        key: `patient:${normalizeGroupName(patient) || patient.toLowerCase()}`,
        helper: [hospital || doctor, period].filter(Boolean).join(" - "),
      };
    }
    return {
      type: "period",
      label: period,
      key: `patient-missing:${normalizeGroupName(period) || "unsorted"}`,
      helper: "No patient name found",
    };
  }

  if (hospital) {
    return {
      type: "hospital",
      label: hospital,
      key: `hospital:${normalizeGroupName(hospital) || hospital.toLowerCase()}`,
      helper: doctor ? `${doctor} - ${period}` : period,
    };
  }

  if (doctor) {
    return {
      type: "doctor",
      label: doctor,
      key: `doctor:${normalizeGroupName(doctor) || doctor.toLowerCase()}`,
      helper: period,
    };
  }

  return {
    type: "period",
    label: period,
    key: `period:${normalizeGroupName(period) || "unsorted"}`,
    helper: "Hospital or doctor not found",
  };
}

function groupingValueForMode(doc = {}, mode = "hospital") {
  if (mode === "doctor") return String(doc.doctor || "").trim();
  if (mode === "patient") return String(doc.patientName || doc.patient || "").trim();
  return String(doc.hospital || "").trim();
}

function buildGroupingFallbacks(docs = [], mode = "hospital") {
  const byBatch = new Map();
  for (const doc of docs) {
    if (!doc.batchId) continue;
    const value = groupingValueForMode(doc, mode);
    if (value && !byBatch.has(doc.batchId)) byBatch.set(doc.batchId, value);
  }
  return { byBatch };
}

function applyGroupingFallback(doc, docs, mode, fallbacks) {
  if (groupingValueForMode(doc, mode)) return doc;
  const fromBatch = doc.batchId ? fallbacks.byBatch.get(doc.batchId) : "";
  let value = fromBatch;

  if (!value && (isReuploadStatus(doc.status) || isProcessingStatus(doc.status))) {
    const docTime = doc.sortDate || 0;
    const nearby = docs
      .filter((item) => item.id !== doc.id && groupingValueForMode(item, mode))
      .map((item) => ({ item, distance: Math.abs((item.sortDate || 0) - docTime) }))
      .filter((item) => item.distance <= 10 * 60 * 1000)
      .sort((a, b) => a.distance - b.distance)[0]?.item;
    value = groupingValueForMode(nearby, mode);
  }

  if (!value) return doc;
  if (mode === "doctor") return { ...doc, doctor: value, helperFallback: "Grouped with same upload" };
  if (mode === "patient") return { ...doc, patientName: value, helperFallback: "Grouped with same upload" };
  return { ...doc, hospital: value, helperFallback: "Grouped with same upload" };
}

function withRecordGroup(doc) {
  const group = recordGroupForDoc(doc);
  return {
    ...doc,
    groupType: group.type,
    groupLabel: group.label,
    groupKey: group.key,
  };
}

function openDocument(nav, doc) {
  if (!doc) return;
  if (isProcessingStatus(doc.status)) {
    nav.push("analysis", { method: doc.uploadSource || "gallery", docId: doc.id });
    return;
  }
  if (isReuploadStatus(doc.status)) {
    nav.push("analysis", { method: doc.uploadSource || "gallery", docId: doc.id });
    return;
  }
  nav.push("document", { docId: doc.id });
}

async function ensureVaultDirectory() {
  if (!FileSystem.documentDirectory) return;
  await FileSystem.makeDirectoryAsync(VAULT_DIR, { intermediates: true }).catch(() => undefined);
}

async function copyAssetsToVault(assets, method) {
  await ensureVaultDirectory();
  const stamp = Date.now();

  return Promise.all(
    assets.map(async (asset, index) => {
      const ext = extensionFromAsset(asset);
      const sourceName = asset.name || asset.fileName || `${method}-document-${index + 1}.${ext}`;
      const name = safeFileName(sourceName.includes(".") ? sourceName : `${sourceName}.${ext}`);
      const localUri = FileSystem.documentDirectory
        ? `${VAULT_DIR}${stamp}-${index + 1}-${name}`
        : asset.uri;

      if (FileSystem.documentDirectory) {
        await FileSystem.copyAsync({ from: asset.uri, to: localUri });
      }

      return {
        uri: localUri,
        originalUri: asset.uri,
        name,
        mimeType: inferMimeType(asset),
        size: asset.size,
      };
    })
  );
}

async function pickUploadAssets(method) {
  if (method === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Camera permission is required to scan documents.");
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
    });

    if (result.canceled) return null;
    return result.assets;
  }

  if (method === "gallery") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Gallery permission is required to upload document images.");
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.9,
    });

    if (result.canceled) return null;
    return result.assets;
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;
  return result.assets;
}

function createDraftDocument(method, localFiles, batchIndex = 0, batchId = "") {
  const primary = localFiles[0];
  const now = new Date();
  const id = `doc-${now.getTime()}-${batchIndex}-${Math.random().toString(36).slice(2, 8)}`;

  return withRecordGroup({
    id,
    title: titleFromFileName(primary?.name || "Medical Document"),
    category: "others",
    date: formatDate(now),
    sortDate: now.getTime(),
    doctor: "",
    hospital: "",
    tags: [],
    pages: localFiles.length || 1,
    ocr: "",
    summary: "Original file saved. OCR has not started yet.",
    status: "queued",
    needsReview: false,
    uploadSource: method,
    fileName: primary?.name || "medical-document",
    mimeType: primary?.mimeType || "application/octet-stream",
    localUri: primary?.uri,
    localFiles,
    batchId,
    originalSaved: true,
  });
}

async function requestOcr(localFile, documentId, token, batchId) {
  const upload = await FileSystem.uploadAsync(`${API_BASE_URL}/api/ocr`, localFile.uri, {
    fieldName: "file",
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    mimeType: localFile.mimeType || "application/octet-stream",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    parameters: {
      fileName: localFile.name || "medical-document",
      documentId: documentId || "",
      batchId: batchId || "",
    },
  });
  const data = (() => {
    try {
      return JSON.parse(upload.body || "{}");
    } catch {
      return {};
    }
  })();

  if (upload.status < 200 || upload.status >= 300) {
    const message = data.reason || data.error || "OCR failed.";
    const error = new Error(message);
    error.status = upload.status;
    error.code = data.code;
    error.needsReupload = data.status === "needs_reupload";
    error.retryLater = data.status === "retry_later";
    error.ocrConfidence = data.ocrConfidence;
    error.originalStorage = data.originalStorage;
    throw error;
  }

  return data;
}

async function buildAnalysisImagePages(files = []) {
  const imageFiles = files.filter((file) => file?.mimeType?.startsWith("image/")).slice(0, MAX_ANALYSIS_IMAGE_COUNT);
  const imagePages = [];
  let totalChars = 0;

  for (let i = 0; i < imageFiles.length; i += 1) {
    const file = imageFiles[i];
    try {
      const info = await FileSystem.getInfoAsync(file.uri, { size: true });
      if (info?.size && info.size > MAX_ANALYSIS_IMAGE_BYTES) continue;
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType?.Base64 || "base64",
      });
      if (!base64) continue;
      totalChars += base64.length;
      if (totalChars > MAX_ANALYSIS_IMAGE_CHARS) break;
      imagePages.push({
        page: i + 1,
        mimeType: file.mimeType || "image/jpeg",
        base64,
      });
    } catch {
      // Keep analysis moving even if one local image cannot be encoded for optional vision extraction.
    }
  }

  return imagePages;
}

async function requestDocumentAnalysis(doc, ocrText, pageTexts = [], files = [], token) {
  const imagePages = await buildAnalysisImagePages(files);
  const response = await fetch(`${API_BASE_URL}/api/analyze-document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      documentId: doc.id,
      batchId: doc.batchId,
      fileName: doc.fileName || doc.title,
      mimeType: doc.mimeType || "application/octet-stream",
      ocrText,
      ocrConfidence: doc.ocrConfidence,
      pages: pageTexts.map((page) => ({
        page: page.page,
        confidence: page.confidence,
      })),
      imagePages,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok && !isReuploadStatus(data.status)) {
    throw new Error(data.error || data.reason || "AI analysis failed.");
  }

  return data;
}

function applyAnalysisToDoc(doc, analysis, ocrText) {
  const structuredOcr = analysis?.structuredOcr || doc.structuredOcr || null;
  const category = isKnownCategory(analysis?.category) ? analysis.category : doc.category || "others";
  const tags = Array.isArray(analysis?.tags) ? analysis.tags.filter(Boolean).slice(0, 8) : doc.tags || [];
  const warnings = Array.isArray(analysis?.warnings) ? analysis.warnings : doc.warnings || [];
  const reuploadMessage = analysis?.reason || warnings[0] || "Reupload a clearer medical document.";

  if (!analysis || isReuploadStatus(analysis.status)) {
    return withRecordGroup({
      ...doc,
      title: analysis?.title || doc.title,
      category,
      hospital: analysis?.hospital || doc.hospital,
      doctor: analysis?.doctor || doc.doctor,
      patientName: analysis?.patientName || doc.patientName,
      date: analysis?.visitDate || doc.date,
      tags,
      ocr: ocrText,
      structuredOcr,
      summary: analysis?.summary || analysis?.clinicalSummary || (analysis?.verifiedFacts?.length
        ? "Some facts were extracted, but this page still needs a clearer replacement."
        : "OCR finished, but the result was not reliable enough. Reupload this page."),
      clinicalSummary: analysis?.clinicalSummary || "",
      importantFindings: Array.isArray(analysis?.importantFindings) ? analysis.importantFindings : [],
      medicines: Array.isArray(analysis?.medicines) ? analysis.medicines : [],
      tests: Array.isArray(analysis?.tests) ? analysis.tests : [],
      status: "needs_reupload",
      needsReview: false,
      aiError: reuploadMessage,
      warnings,
      ocrConfidence: typeof analysis?.ocrConfidence === "number" ? analysis.ocrConfidence : doc.ocrConfidence,
      ocrProvider: doc.ocrProvider,
      originalStorage: doc.originalStorage,
      extractionMode: analysis?.extractionMode || doc.extractionMode || "ocr_text",
      verifiedFacts: Array.isArray(analysis?.verifiedFacts) ? analysis.verifiedFacts : doc.verifiedFacts || [],
      rejectedFacts: Array.isArray(analysis?.rejectedFacts) ? analysis.rejectedFacts : doc.rejectedFacts || [],
      verification: analysis?.verification || doc.verification,
    });
  }

  return withRecordGroup({
    ...doc,
    title: analysis.title || doc.title,
    category,
    hospital: analysis.hospital || doc.hospital,
    doctor: analysis.doctor || doc.doctor,
    patientName: analysis.patientName || doc.patientName,
    date: analysis.visitDate || doc.date,
    tags,
    ocr: ocrText,
    structuredOcr,
    summary: analysis.summary || doc.summary,
    clinicalSummary: analysis.clinicalSummary || "",
    importantFindings: Array.isArray(analysis.importantFindings) ? analysis.importantFindings : [],
    medicines: Array.isArray(analysis.medicines) ? analysis.medicines : [],
    tests: Array.isArray(analysis.tests) ? analysis.tests : [],
    ocrConfidence: typeof analysis.ocrConfidence === "number" ? analysis.ocrConfidence : doc.ocrConfidence,
    ocrProvider: doc.ocrProvider,
    originalStorage: doc.originalStorage,
    extractionMode: analysis.extractionMode || doc.extractionMode || "ocr_text",
    verifiedFacts: Array.isArray(analysis.verifiedFacts) ? analysis.verifiedFacts : [],
    rejectedFacts: Array.isArray(analysis.rejectedFacts) ? analysis.rejectedFacts : [],
    verification: analysis.verification,
    confidence: analysis.confidence,
    warnings: Array.isArray(analysis.warnings) ? analysis.warnings : [],
    status: analysis.needsReview ? "needs_reupload" : "ready",
    needsReview: false,
    aiError: analysis.needsReview ? "Reupload a clearer medical document." : "",
  });
}

function textFromOcrResponse(ocr) {
  return cleanReadableText(ocr?.ocrText || ocr?.cleanedOcrText || ocr?.rawOcrText || "");
}

async function runDocumentPipeline(doc, app, callbacks = {}) {
  const isActive = callbacks.isActive || (() => true);
  const setStage = callbacks.setStage || (() => undefined);
  const setProgress = callbacks.setProgress || (() => undefined);
  const files = doc.localFiles?.length
    ? doc.localFiles
    : doc.localUri
      ? [{ uri: doc.localUri, name: doc.fileName, mimeType: doc.mimeType }]
      : [];

  if (!files.length) {
    throw new Error("Original file is missing from local storage.");
  }

  app.updateDocPatch(doc.id, { status: "processing", summary: "Original file saved. OCR and AI summary are running in the background." });

  const pageTexts = [];
  const fileTexts = [];

  for (let i = 0; i < files.length; i += 1) {
    if (!isActive()) return null;
    setStage(`Running OCR on file ${i + 1} of ${files.length}`);
    setProgress(Math.min(70, 22 + Math.round((i / files.length) * 42)));

    const ocr = await requestOcr(files[i], doc.id, app.authToken, doc.batchId);
    const responseText = textFromOcrResponse(ocr);
    const returnedPages = ocr.pageLevelText?.length
      ? ocr.pageLevelText
      : [{ text: responseText, confidence: ocr.ocrConfidence }];

    fileTexts.push({
      sourceName: files[i].name,
      text: responseText || cleanReadableText(returnedPages.map((page) => page.text || "").join("\n\n")),
      provider: ocr.provider,
      confidence: ocr.ocrConfidence,
      originalStorage: ocr.originalStorage,
    });

    pageTexts.push(...returnedPages.map((page, pageIndex) => ({
      ...page,
      page: pageTexts.length + pageIndex + 1,
      sourceName: files[i].name,
      provider: ocr.provider,
      confidence: typeof page.confidence === "number" ? page.confidence : ocr.ocrConfidence,
    })));
  }

  const combinedText = cleanReadableText(fileTexts
    .map((file, index) => {
      const heading = files.length > 1 ? `## ${file.sourceName || `Document ${index + 1}`}` : "";
      return [heading, file.text].filter(Boolean).join("\n\n");
    })
    .join("\n\n---\n\n"));
  const confidenceValues = fileTexts.map((file) => file.confidence).filter((value) => typeof value === "number");
  const ocrConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : undefined;
  const ocrProvider = fileTexts.find((file) => file.provider)?.provider;
  const originalStorage = fileTexts.find((file) => file.originalStorage)?.originalStorage || doc.originalStorage;

  app.updateDocPatch(doc.id, {
    ocr: combinedText,
    pageLevelText: pageTexts,
    ocrConfidence,
    ocrProvider,
    originalStorage,
    status: "ocr_complete",
    summary: "OCR complete. AI summary and grouping are running in the background.",
  });

  if (!isActive()) return null;
  setStage("Writing summary and grouping record");
  setProgress(82);

  const analysisInput = { ...doc, ocr: combinedText, pageLevelText: pageTexts, ocrConfidence, ocrProvider, originalStorage };
  const analysis = await requestDocumentAnalysis(analysisInput, combinedText, pageTexts, files, app.authToken);
  const updated = applyAnalysisToDoc(analysisInput, analysis, combinedText);
  app.updateDoc(updated);
  setProgress(100);
  setStage(updated.status === "ready" ? "Analysis complete" : "Reupload needed");
  return updated;
}

function structuredTextForDoc(doc) {
  return cleanReadableText(doc?.structuredOcr?.formattedText || doc?.ocr || "");
}

function cleanReadableText(value = "") {
  const seen = new Set();
  const lines = String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*\[\d+\]\s*/, "").replace(/[ \t]+$/g, ""));
  const output = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^page\s+\d+$/i.test(trimmed)) continue;

    if (!trimmed) {
      if (output.length && output[output.length - 1] !== "") output.push("");
      continue;
    }

    const isStructureLine = /^#{1,6}\s|^\s*[-*]\s+|^\s*\d+\.\s+|^\s*\|.*\|\s*$|^\s*<\/?(table|thead|tbody|tr|td|th)/i.test(line);
    const key = trimmed.toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim();
    if (!isStructureLine && key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function documentShareText(doc) {
  const lines = [
    doc?.title || "Medical document",
    doc?.hospital ? `Hospital: ${doc.hospital}` : "",
    doc?.doctor ? `Doctor: ${doc.doctor}` : "",
    doc?.date ? `Visit date: ${doc.date}` : "",
    doc?.summary ? `Summary: ${doc.summary}` : "",
    structuredTextForDoc(doc) ? `\nExtracted text:\n${structuredTextForDoc(doc)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

async function shareDocument(doc) {
  try {
    await Share.share({
      title: doc?.title || "Heault document",
      message: documentShareText(doc),
    });
  } catch (error) {
    Alert.alert("Share failed", error?.message || "Could not share this document.");
  }
}

function processingErrorMessage(error) {
  if (error?.needsReupload) {
    return error.message || "Please reupload a clearer medical document.";
  }
  if (error?.retryLater) {
    return error.message || "OCR service is busy. Please retry in a minute.";
  }
  if (error?.message === "Network request failed") {
    return "Network unavailable. Original file is saved. Try again or reupload when connected.";
  }
  return error?.message || "Processing failed. Original file is saved. Reupload this page if the image is unclear.";
}

function processingFailurePatch(error) {
  const message = processingErrorMessage(error);
  return {
    status: "needs_reupload",
    needsReview: false,
    aiError: message,
    ocrConfidence: typeof error?.ocrConfidence === "number" ? error.ocrConfidence : undefined,
    originalStorage: error?.originalStorage,
    summary: error?.needsReupload
      ? "Original file saved. Please reupload a clearer medical document before OCR and AI can continue."
      : error?.retryLater
        ? "Original file saved. OCR service is temporarily unavailable; retry processing shortly."
        : "Original file saved. Reupload this page if processing fails again.",
  };
}

function percentLabel(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "-";
}

function providerLabel(value) {
  const labels = {
    azure_document_intelligence: "Azure Document Intelligence",
    tesseract: "Local OCR",
    pdf_parse: "PDF text",
  };
  return labels[value] || value || "-";
}

function normalizeRemoteDocument(doc = {}, localDoc = {}) {
  const date = doc.date ? new Date(doc.date) : null;
  const sortDate = Number.isFinite(doc.sortDate)
    ? doc.sortDate
    : date && !Number.isNaN(date.getTime())
      ? date.getTime()
      : localDoc.sortDate || Date.now();
  return withRecordGroup({
    ...localDoc,
    ...doc,
    id: doc.id || doc.documentId || localDoc.id,
    documentId: doc.documentId || doc.id || localDoc.documentId || localDoc.id,
    title: doc.title || localDoc.title || "Medical document",
    category: isKnownCategory(doc.category) ? doc.category : localDoc.category || "others",
    date: typeof doc.date === "string" && doc.date.includes("T") ? formatDate(new Date(doc.date)) : doc.date || localDoc.date || formatDate(new Date()),
    sortDate,
    tags: Array.isArray(doc.tags) ? doc.tags : localDoc.tags || [],
    pages: doc.pages || localDoc.pages || 1,
    localFiles: localDoc.localFiles,
    localUri: localDoc.localUri,
    originalSaved: true,
  });
}

function mergeRemoteDocuments(localDocs = [], remoteDocs = []) {
  const byId = new Map(localDocs.map((doc) => [doc.documentId || doc.id, doc]));
  const merged = remoteDocs.map((remote) => normalizeRemoteDocument(remote, byId.get(remote.documentId || remote.id) || {}));
  const remoteIds = new Set(merged.map((doc) => doc.documentId || doc.id));
  const localOnly = localDocs.filter((doc) => !remoteIds.has(doc.documentId || doc.id));
  return [...merged, ...localOnly].sort((a, b) => (b.sortDate || 0) - (a.sortDate || 0));
}

function Screen({ children, scroll = true, bottomPad = 24 }) {
  if (!scroll) {
    return <View style={styles.screen}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, { paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function IconButton({ icon: Icon, onPress, label = "Action", active = false, style }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.78}
      onPress={onPress}
      style={[styles.iconButton, active && styles.iconButtonActive, style]}
    >
      <Icon size={18} color={active ? "#fff" : C.primary} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

function AppButton({ children, icon: Icon, onPress, tone = "primary", disabled = false, style }) {
  const content = (
    <View style={styles.buttonInner}>
      {Icon && <Icon size={17} color={tone === "primary" && !disabled ? "#fff" : tone === "danger" ? C.red : C.primary} />}
      <Text style={[
        styles.buttonText,
        tone !== "primary" && { color: tone === "danger" ? C.red : C.primary },
        disabled && { color: C.muted },
      ]}>
        {children}
      </Text>
    </View>
  );

  if (tone === "primary") {
    return (
      <TouchableOpacity disabled={disabled} activeOpacity={0.82} onPress={onPress} style={[styles.buttonTouch, style]}>
        <LinearGradient colors={disabled ? ["#E9E0E3", "#E9E0E3"] : [C.primary, C.primary2, C.primary3]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
          {content}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      disabled={disabled}
      activeOpacity={0.82}
      onPress={onPress}
      style={[
        styles.button,
        tone === "danger" ? styles.dangerButton : styles.softButton,
        disabled && { backgroundColor: "#E9E0E3" },
        style,
      ]}
    >
      {content}
    </TouchableOpacity>
  );
}

function MedicalCross({ size = 64, color = C.primary, animated = false }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) return undefined;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [animated, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const Wrap = animated ? Animated.View : View;

  return (
    <Wrap style={{ width: size, height: size, transform: animated ? [{ rotate }] : undefined }}>
      <View style={[styles.crossBarVertical, { backgroundColor: color, borderRadius: size * 0.09, left: size * 0.36, top: size * 0.09, width: size * 0.28, height: size * 0.82 }]} />
      <View style={[styles.crossBarHorizontal, { backgroundColor: color, borderRadius: size * 0.09, left: size * 0.09, top: size * 0.36, width: size * 0.82, height: size * 0.28 }]} />
    </Wrap>
  );
}

function Header({ nav, app, title = "Heault", back = false, right }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {back ? (
          <IconButton icon={ChevronLeft} label="Back" onPress={nav.pop} style={styles.smallIconButton} />
        ) : (
          <TouchableOpacity activeOpacity={0.78} onPress={() => nav.push("profile")} style={styles.avatarButton}>
            {app?.user?.photo ? <Image source={{ uri: app.user.photo }} style={styles.avatarImage} /> : <Text style={styles.avatarInitial}>{app?.user?.name?.[0] || "H"}</Text>}
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      {right || <IconButton icon={Settings} label="Settings" onPress={() => nav.push("settings")} style={styles.smallIconButton} />}
    </View>
  );
}

function NativeStatus({ light = false }) {
  return (
    <View pointerEvents="none" style={styles.nativeStatus}>
      <Text style={[styles.statusTime, light && { color: "#fff" }]}>9:41</Text>
      <View style={styles.statusIcons}>
        <SignalHigh size={14} color={light ? "#fff" : C.ink} />
        <Wifi size={14} color={light ? "#fff" : C.ink} />
        <BatteryFull size={16} color={light ? "#fff" : C.ink} />
      </View>
    </View>
  );
}

function SearchBox({ value, onChangeText, onFocus, placeholder = "Search medical records, labs..." }) {
  return (
    <View style={styles.searchBox}>
      <Search size={18} color={C.muted} style={styles.searchIcon} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        style={styles.searchInput}
        returnKeyType="search"
      />
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, icon: Icon, multiline = false, keyboardType }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldBox, multiline && styles.textAreaBox]}>
        {Icon && <Icon size={17} color={C.muted} style={styles.fieldIcon} />}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.muted}
          keyboardType={keyboardType}
          multiline={multiline}
          textAlignVertical={multiline ? "top" : "center"}
          style={[styles.fieldInput, Icon && { paddingLeft: 40 }, multiline && styles.textAreaInput]}
        />
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, tone = "pink" }) {
  const map = {
    pink: [C.blush, C.primary],
    green: [C.greenSoft, C.green],
    amber: [C.amberSoft, C.amber],
    blue: [C.blueSoft, C.blue],
  };
  const [bg, fg] = map[tone] || map.pink;
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={[styles.chip, { backgroundColor: active ? fg : bg, borderColor: active ? fg : C.line }]}>
      <Text style={[styles.chipText, { color: active ? "#fff" : fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Toggle({ on, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={[styles.toggle, { backgroundColor: on ? C.primary : "#E9DDE1", alignItems: on ? "flex-end" : "flex-start" }]}>
      <View style={styles.toggleThumb} />
    </TouchableOpacity>
  );
}

function SectionTitle({ text, action, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{text}</Text>
      {action && (
        <TouchableOpacity activeOpacity={0.72} onPress={onAction}>
          <Text style={styles.textButton}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function DocumentMock({ compact = false }) {
  const w = compact ? 132 : 190;
  const h = compact ? 176 : 252;
  return (
    <View style={[styles.documentMock, { width: w, height: h, padding: compact ? 12 : 17 }]}>
      <View style={styles.mockHeader}>
        <View style={[styles.mockLogo, { width: compact ? 16 : 24, height: compact ? 16 : 24 }]}>
          <MedicalCross size={compact ? 11 : 15} color={C.blue} />
        </View>
        <View>
          <View style={[styles.mockLineStrong, { width: compact ? 48 : 70 }]} />
          <View style={[styles.mockLine, { width: compact ? 34 : 52, marginTop: 4 }]} />
        </View>
      </View>
      <View style={styles.mockDivider} />
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={styles.mockGrid}>
          {[0, 1, 2].map((cell) => (
            <View key={cell} style={[styles.mockCell, { backgroundColor: row % 2 === 0 && cell === 0 ? "#B7D4DD" : "#E7EEF1" }]} />
          ))}
        </View>
      ))}
      <View style={[styles.mockBars, { height: compact ? 32 : 46 }]}>
        {[18, 28, 22, 36, 27].map((bar, i) => (
          <View key={i} style={{ width: compact ? 9 : 13, height: compact ? bar * 0.7 : bar, borderRadius: 3, backgroundColor: i % 2 ? C.blue : "#90C3D2" }} />
        ))}
      </View>
      <View style={styles.mockAccentLine} />
      <View style={styles.mockFooter}>
        <View style={styles.mockCell} />
        <View style={styles.mockCell} />
      </View>
    </View>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Icon size={28} color={C.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

function DocumentRow({ doc, onPress, right }) {
  const cat = categoryFor(doc.category);
  const Icon = cat.icon;
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={styles.docRow}>
      <View style={[styles.docIcon, { backgroundColor: cat.tint }]}>
        <Icon size={20} color={cat.color} />
      </View>
      <View style={styles.docTextWrap}>
        <Text style={styles.docTitle} numberOfLines={1}>{doc.title}</Text>
        <Text style={styles.docSubtitle} numberOfLines={1}>{cat.label} - {doc.hospital}</Text>
      </View>
      {right || <ChevronRight size={18} color={C.muted} />}
    </TouchableOpacity>
  );
}

function Splash() {
  return (
    <View style={styles.splash}>
      <View style={styles.splashGlow} />
      <View style={styles.splashMark}>
        <MedicalCross size={70} animated />
      </View>
      <Text style={styles.splashName}>Heault</Text>
      <Text style={styles.splashTag}>Medical documents, secured</Text>
    </View>
  );
}

function Welcome({ nav }) {
  return (
    <Screen scroll={false}>
      <View style={styles.welcome}>
        <View style={styles.brandRow}>
          <MedicalCross size={45} />
          <View>
            <Text style={styles.brandName}>Heault</Text>
            <Text style={styles.brandTag}>Capture. Organize. Retrieve.</Text>
          </View>
        </View>
        <LinearGradient colors={[C.primary, C.primary2, C.primary3]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.welcomeCard}>
          <ShieldCheck size={24} color="#fff" />
          <Text style={styles.welcomeTitle}>Your medical vault is ready.</Text>
          <Text style={styles.welcomeBody}>Create a secure vault or login with your existing mobile number.</Text>
        </LinearGradient>
        <View style={styles.flexFill} />
        <AppButton icon={UserRound} onPress={() => nav.push("phone", { mode: "signup" })} style={styles.fullWidth}>Create account</AppButton>
        <AppButton tone="soft" icon={Phone} onPress={() => nav.push("phone", { mode: "login" })} style={[styles.fullWidth, { marginTop: 12 }]}>Login</AppButton>
      </View>
    </Screen>
  );
}

function PhoneEntry({ nav, params }) {
  const [num, setNum] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [loading, setLoading] = useState(false);
  const mode = params?.mode === "signup" ? "signup" : "login";
  const isSignup = mode === "signup";
  const continueWithOtp = async () => {
    try {
      setLoading(true);
      const data = await requestOtpStart(countryCode, num, mode);
      nav.push("otp", { countryCode, phone: num, phoneE164: data.phoneE164, bypass: data.bypass, mode });
    } catch (error) {
      Alert.alert("OTP failed", error?.message || "Could not send OTP.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false}>
      <Header nav={nav} app={{}} title="" back right={<View style={styles.smallIconButton} />} />
      <View style={styles.authBody}>
        <Text style={styles.authTitle}>{isSignup ? "Create account" : "Login"}</Text>
        <Text style={styles.authSubtitle}>{isSignup ? "Enter a new mobile number. If this number already has an account, use Login instead." : "Enter your registered mobile number. New users should create an account first."}</Text>
        <View style={styles.phoneRow}>
          <View style={styles.countryBox}>
            <TextInput
              value={countryCode}
              onChangeText={(value) => setCountryCode(`+${value.replace(/\D/g, "").slice(0, 4)}`)}
              keyboardType="phone-pad"
              style={styles.countryInput}
            />
          </View>
          <TextInput
            value={num}
            onChangeText={(value) => setNum(value.replace(/\D/g, "").slice(0, 10))}
            keyboardType="number-pad"
            placeholder="98480 12345"
            placeholderTextColor={C.muted}
            style={styles.phoneInput}
          />
        </View>
      </View>
      <View style={styles.flexFill} />
      <View style={styles.bottomAction}><AppButton disabled={num.length < 7 || loading} onPress={continueWithOtp} style={styles.fullWidth}>{loading ? "Sending..." : "Send OTP"}</AppButton></View>
    </Screen>
  );
}

function OTP({ nav, app, params }) {
  const [code, setCode] = useState(["", "", "", ""]);
  const [timer, setTimer] = useState(28);
  const [loading, setLoading] = useState(false);
  const refs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const mode = params?.mode === "signup" ? "signup" : "login";

  useEffect(() => {
    const t = setInterval(() => setTimer((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const done = code.every(Boolean);
  const submit = async () => {
    try {
      setLoading(true);
      const data = await requestOtpVerify({
        countryCode: params?.countryCode || "+91",
        phone: params?.phone || "",
        phoneE164: params?.phoneE164,
        code: code.join(""),
        mode,
      });
      await app?.finishAuth?.({ token: data.token, user: data.user });
      if (mode === "signup") {
        nav.push("onboarding");
      } else {
        nav.go("home");
      }
    } catch (error) {
      Alert.alert("Invalid OTP", error?.message || "Could not verify OTP.");
    } finally {
      setLoading(false);
    }
  };
  const resend = async () => {
    try {
      await requestOtpStart(params?.countryCode || "+91", params?.phone || "", mode);
      setTimer(28);
    } catch (error) {
      Alert.alert("OTP failed", error?.message || "Could not resend OTP.");
    }
  };

  return (
    <Screen scroll={false}>
      <Header nav={nav} app={{}} title="" back right={<View style={styles.smallIconButton} />} />
      <View style={styles.authBody}>
        <Text style={styles.authTitle}>Verify OTP</Text>
        <Text style={styles.authSubtitle}>Sent to {params?.phoneE164 || "your mobile number"}{params?.bypass ? ". Dev OTP is 1234." : ""}</Text>
        <View style={styles.otpRow}>
          {code.map((digit, i) => (
            <TextInput
              key={i}
              ref={refs[i]}
              value={digit}
              maxLength={1}
              keyboardType="number-pad"
              onChangeText={(value) => {
                const v = value.replace(/\D/g, "");
                const next = [...code];
                next[i] = v;
                setCode(next);
                if (v && i < 3) refs[i + 1].current?.focus();
              }}
              style={[styles.otpInput, digit && styles.otpInputActive]}
            />
          ))}
        </View>
        <TouchableOpacity disabled={timer > 0} onPress={resend} style={{ alignSelf: "flex-start", marginTop: 18 }}>
          <Text style={[styles.textButton, timer > 0 && { color: C.muted }]}>{timer > 0 ? `Resend in 0:${String(timer).padStart(2, "0")}` : "Resend code"}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.flexFill} />
      <View style={styles.bottomAction}><AppButton disabled={!done || loading} onPress={submit} style={styles.fullWidth}>{loading ? "Verifying..." : "Verify"}</AppButton></View>
    </Screen>
  );
}

function Onboarding({ nav, app }) {
  const [form, setForm] = useState({ name: "", dob: "", gender: "", blood: "", photo: "" });
  const canSave = form.name.trim().length > 1 && form.dob.trim().length > 3 && form.gender;
  const bloodGroups = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
  const save = async () => {
    await app.saveUserProfile?.({
      ...app.user,
      name: form.name || app.user.name,
      dob: form.dob || app.user.dob,
      gender: form.gender || app.user.gender,
      blood: form.blood || app.user.blood,
      photo: form.photo || app.user.photo,
    });
    nav.go("home");
  };

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Profile Setup" back />
      <Card style={styles.onboardingCard}>
        <View style={styles.profileSetupHeader}>
          <View style={styles.profilePreview}>
            {form.photo ? <Image source={{ uri: form.photo }} style={styles.avatarImage} /> : <User size={28} color={C.primary} />}
          </View>
          <View style={styles.flexFill}>
            <Text style={styles.cardTitle}>Basic information</Text>
            <TouchableOpacity onPress={() => setForm({ ...form, photo: initialUser.photo })}>
              <Text style={[styles.textButton, { marginTop: 5 }]}>Add profile picture</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Field label="Full name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Alex Morgan" icon={User} />
        <Field label="Date of birth" value={form.dob} onChangeText={(dob) => setForm({ ...form, dob })} placeholder="DD / MM / YYYY" icon={Calendar} />
        <Text style={styles.fieldLabel}>Gender</Text>
        <View style={styles.segmentGrid3}>
          {["Female", "Male", "Other"].map((gender) => (
            <SegmentButton key={gender} active={form.gender === gender} label={gender} onPress={() => setForm({ ...form, gender })} />
          ))}
        </View>
        <Text style={[styles.fieldLabel, { marginTop: 15 }]}>Blood group (optional)</Text>
        <View style={styles.bloodGrid}>
          {bloodGroups.map((blood) => (
            <SegmentButton key={blood} active={form.blood === blood} label={blood} onPress={() => setForm({ ...form, blood })} />
          ))}
        </View>
      </Card>
      <AppButton disabled={!canSave} icon={ShieldCheck} onPress={save} style={[styles.fullWidth, { marginTop: 18 }]}>Create secure vault</AppButton>
    </Screen>
  );
}

function SegmentButton({ label, active, onPress, icon: Icon }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={[styles.segmentButton, active && styles.segmentActive]}>
      {Icon && <Icon size={15} color={active ? "#fff" : C.text} />}
      <Text style={[styles.segmentText, active && { color: "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function HomeScreen({ nav, app }) {
  const readyCount = app.docs.filter((doc) => doc.status === "ready" || !doc.status).length;
  const reuploadCount = app.docs.filter((doc) => isReuploadStatus(doc.status)).length;
  const firstName = app.user.name?.trim()?.split(" ")[0] || "there";
  return (
    <Screen bottomPad={122}>
      <Header nav={nav} app={app} />
      <View style={styles.pageBody}>
        <LinearGradient colors={["#FFF7FA", "#FFE1EC", "#FA8DB1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.homeHeroCard}>
          <View style={styles.homeHeroTop}>
            <View style={styles.homeHeroMark}>
              <MedicalCross size={34} color={C.primary} />
            </View>
            <View style={styles.flexFill}>
              <Text style={styles.homeHeroEyebrow}>Heault vault</Text>
              <Text style={styles.homeHeroTitle}>Good morning, {firstName}</Text>
            </View>
          </View>
          <Text style={styles.homeHeroText}>Capture medical papers, organize them by hospital, and retrieve them when you visit again.</Text>
          <View style={styles.homeHeroStats}>
            <View>
              <Text style={styles.homeHeroNumber}>{app.docs.length}</Text>
              <Text style={styles.homeHeroLabel}>Documents</Text>
            </View>
            <View style={styles.homeHeroDivider} />
            <View>
              <Text style={styles.homeHeroNumber}>{readyCount}</Text>
              <Text style={styles.homeHeroLabel}>Ready</Text>
            </View>
            <View style={styles.homeHeroDivider} />
            <View>
              <Text style={styles.homeHeroNumber}>{reuploadCount}</Text>
              <Text style={styles.homeHeroLabel}>Reupload</Text>
            </View>
          </View>
          <TouchableOpacity activeOpacity={0.84} onPress={() => app.startUpload?.("gallery")} style={styles.homeHeroAction}>
            <Plus size={18} color="#fff" />
            <Text style={styles.homeHeroActionText}>Add medical document</Text>
          </TouchableOpacity>
        </LinearGradient>

        <View style={styles.infoGrid}>
          <Card style={styles.infoCard}>
            <Stethoscope size={20} color={C.primary} />
            <Text style={styles.infoLabel}>Last doctor visit</Text>
            <Text style={styles.infoValue}>{app.user.lastDoctorVisit.date}</Text>
          </Card>
          <Card style={styles.infoCard}>
            <Syringe size={20} color={C.green} />
            <Text style={styles.infoLabel}>Vaccinations</Text>
            <Text style={styles.infoValue}>{app.user.vaccineRecord.total}</Text>
          </Card>
        </View>

        <SectionTitle text="Categories" action="View All" onAction={() => nav.go("records")} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          {CATEGORIES.map((category) => {
            const Icon = category.icon;
            return (
              <TouchableOpacity key={category.id} activeOpacity={0.76} style={styles.categoryTile} onPress={() => nav.go("records", { category: category.id })}>
                <View style={[styles.categoryIcon, { backgroundColor: category.tint }]}>
                  <Icon size={23} color={category.color} />
                </View>
                <Text style={styles.categoryLabel} numberOfLines={1}>{category.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <SectionTitle text="Recently uploaded" action="See all" onAction={() => nav.go("records")} />
        <View style={styles.stackGap}>
          {app.docs.slice(0, 3).map((doc) => <DocumentRow key={doc.id} doc={doc} onPress={() => openDocument(nav, doc)} />)}
        </View>
      </View>
    </Screen>
  );
}

function SimpleStat({ icon: Icon, label, value }) {
  return (
    <Card style={styles.simpleStat}>
      <Icon size={18} color={C.primary} />
      <Text style={styles.simpleStatValue}>{value}</Text>
      <Text style={styles.simpleStatLabel}>{label}</Text>
    </Card>
  );
}

function RecordsScreen({ nav, app, params }) {
  const [viewMode, setViewMode] = useState("hospital");

  const results = useMemo(() => {
    return [...app.docs].sort((a, b) => (b.sortDate || 0) - (a.sortDate || 0));
  }, [app.docs]);
  const groups = useMemo(() => groupRecords(results, "latest", viewMode), [results, viewMode]);

  const readyCount = app.docs.filter((doc) => doc.status === "ready" || !doc.status).length;
  const reuploadCount = app.docs.filter((doc) => isReuploadStatus(doc.status)).length;

  return (
    <Screen bottomPad={122}>
      <Header nav={nav} app={app} title="Records" />
      <View style={styles.pageBody}>
        <View style={styles.simplePageHeader}>
          <Text style={styles.simplePageTitle}>Medical records</Text>
          <Text style={styles.simplePageSubtitle}>Open your saved files by hospital, doctor, or patient.</Text>
        </View>

        <View style={styles.recordsModeTabs}>
          <DrawerModeButton label="Hospital" icon={Building2} active={viewMode === "hospital"} onPress={() => setViewMode("hospital")} />
          <DrawerModeButton label="Doctor" icon={Stethoscope} active={viewMode === "doctor"} onPress={() => setViewMode("doctor")} />
          <DrawerModeButton label="Patient" icon={UserRound} active={viewMode === "patient"} onPress={() => setViewMode("patient")} />
        </View>

        <View style={styles.recordsStatsGrid}>
          <RecordsStat icon={Files} label="Total files" value={app.docs.length} tone="blue" />
          <RecordsStat icon={ShieldCheck} label="Ready" value={readyCount} tone="green" />
          <RecordsStat icon={RefreshCcw} label="Reupload" value={reuploadCount} tone="amber" />
        </View>

        <SectionTitle text={`${groups.length} ${viewMode} file${groups.length === 1 ? "" : "s"}`} action="Upload" onAction={() => app.startUpload?.("gallery")} />
        {results.length === 0 ? (
          <EmptyState icon={Files} title={`No ${viewMode} records yet`} subtitle="Upload medical documents to build your records drawer." />
        ) : (
          <View style={styles.recordsList}>
            {groups.map((group) => (
              <RecordGroupCard key={group.key} group={group} nav={nav} mode={viewMode} />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

function DrawerModeButton({ label, icon: Icon, active, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={[styles.drawerModeButton, active && styles.drawerModeButtonActive]}>
      <Icon size={15} color={active ? C.primary : C.muted} />
      <Text style={[styles.drawerModeText, active && { color: C.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function groupRecords(docs, sort = "latest", mode = "hospital") {
  const map = new Map();
  const fallbacks = buildGroupingFallbacks(docs, mode);

  for (const sourceDoc of docs) {
    const doc = applyGroupingFallback(sourceDoc, docs, mode, fallbacks);
    const rawGroup = recordGroupForDoc(doc, mode);
    const compatible = findCompatibleGroup(map, rawGroup, doc);
    const group = compatible || rawGroup;
    const existing = map.get(group.key) || {
      ...group,
      docs: [],
      latestSortDate: 0,
      oldestSortDate: Number.MAX_SAFE_INTEGER,
      categories: new Set(),
      pageCount: 0,
    };
    existing.docs.push(doc);
    existing.latestSortDate = Math.max(existing.latestSortDate, doc.sortDate || 0);
    existing.oldestSortDate = Math.min(existing.oldestSortDate, doc.sortDate || 0);
    existing.categories.add(categoryFor(doc.category).label);
    existing.pageCount += Number(doc.pages || 1);
    map.set(group.key, existing);
  }

  const groups = [...map.values()].map((group) => ({
    ...group,
    docs: group.docs.sort((a, b) => (b.sortDate || 0) - (a.sortDate || 0)),
    categoryLabels: [...group.categories].slice(0, 3),
  }));

  return groups.sort((a, b) => {
    if (sort === "alpha") return a.label.localeCompare(b.label);
    if (sort === "oldest") return (a.latestSortDate || 0) - (b.latestSortDate || 0);
    return (b.latestSortDate || 0) - (a.latestSortDate || 0);
  });
}

function RecordGroupCard({ group, nav, mode }) {
  const typeIcon = {
    hospital: Building2,
    doctor: Stethoscope,
    patient: UserRound,
    period: CalendarClock,
  };
  const Icon = typeIcon[group.type] || FolderOpen;
  const processing = group.docs.filter((doc) => isProcessingStatus(doc.status)).length;
  const reuploadCount = group.docs.filter((doc) => isReuploadStatus(doc.status)).length;
  const latestDoc = group.docs[0];
  const openGroup = () => nav.push("recordGroup", { groupKey: group.key, mode });

  return (
    <View style={styles.recordGroupCard}>
      <View style={styles.folderTab}>
        <Icon size={14} color={C.primary} />
        <Text style={styles.folderTabText}>{groupLabelForMode(group.type)}</Text>
      </View>
      <TouchableOpacity activeOpacity={0.82} onPress={openGroup} style={styles.recordGroupHeader}>
        <View style={styles.recordGroupIcon}>
          <Icon size={21} color={C.primary} />
        </View>
        <View style={styles.flexFill}>
          <Text style={styles.recordGroupTitle} numberOfLines={1}>{group.label}</Text>
          <Text style={styles.recordGroupSub} numberOfLines={1}>
            {group.helper || `Latest ${latestDoc?.date || "-"}`}
          </Text>
        </View>
        {!!processing && <StatusPill status="processing" />}
        {!processing && <ChevronRight size={18} color={C.primary} />}
      </TouchableOpacity>
      <View style={styles.recordGroupMetaRow}>
        <View style={styles.recordGroupMetric}>
          <Files size={14} color={C.primary} />
          <Text style={styles.recordGroupMeta}>{group.docs.length} document{group.docs.length === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.recordGroupMetric}>
          <FileText size={14} color={C.primary} />
          <Text style={styles.recordGroupMeta}>{group.pageCount} page{group.pageCount === 1 ? "" : "s"}</Text>
        </View>
        {!!reuploadCount && (
          <View style={[styles.recordGroupMetric, styles.recordGroupReviewMetric]}>
            <RefreshCcw size={14} color={C.amber} />
            <Text style={[styles.recordGroupMeta, { color: C.amber }]}>{reuploadCount} reupload</Text>
          </View>
        )}
      </View>
      <View style={styles.drawerFileStack}>
        {group.docs.slice(0, 3).map((doc, index) => (
          <TouchableOpacity key={doc.id} activeOpacity={0.78} onPress={() => openDocument(nav, doc)} style={[styles.drawerFileRow, index > 0 && styles.drawerFileRowOverlap]}>
            <View style={[styles.drawerFileStripe, { backgroundColor: categoryFor(doc.category).color }]} />
            <View style={styles.flexFill}>
              <Text style={styles.drawerFileTitle} numberOfLines={1}>{doc.title}</Text>
              <Text style={styles.drawerFileMeta} numberOfLines={1}>{categoryFor(doc.category).label} - {doc.date || "Date not found"}</Text>
            </View>
            <StatusPill status={doc.status || "ready"} />
          </TouchableOpacity>
        ))}
        {group.docs.length > 3 && (
          <TouchableOpacity activeOpacity={0.78} onPress={openGroup} style={styles.drawerMoreRow}>
            <Files size={15} color={C.primary} />
            <Text style={styles.drawerMoreText}>{group.docs.length - 3} more document{group.docs.length - 3 === 1 ? "" : "s"}</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity activeOpacity={0.78} onPress={openGroup} style={styles.recordGroupOpenRow}>
        <Text style={styles.recordGroupOpenText}>Open {groupLabelForMode(group.type).toLowerCase()} file</Text>
        <ChevronRight size={16} color={C.primary} />
      </TouchableOpacity>
    </View>
  );
}

function originalPagesForDocs(docs = []) {
  return docs.flatMap((doc) => {
    const files = doc.localFiles?.length
      ? doc.localFiles
      : doc.localUri
        ? [{ uri: doc.localUri, name: doc.fileName, mimeType: doc.mimeType }]
        : [];
    return files.map((file, index) => ({ doc, file, index }));
  });
}

function RecordGroupDetail({ nav, app, params }) {
  const mode = params?.mode || "hospital";
  const group = useMemo(() => groupRecords(app.docs, "latest", mode).find((item) => item.key === params?.groupKey), [app.docs, mode, params?.groupKey]);
  const originals = useMemo(() => originalPagesForDocs(group?.docs || []), [group]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const selected = originals[Math.min(selectedIndex, Math.max(0, originals.length - 1))];
  const selectedDoc = selected?.doc;
  const selectedIsImage = selected?.file?.mimeType?.startsWith("image/");
  const selectedNeedsReupload = isReuploadStatus(selectedDoc?.status);

  useEffect(() => {
    if (selectedIndex >= originals.length) setSelectedIndex(Math.max(0, originals.length - 1));
  }, [originals.length, selectedIndex]);

  if (!group) {
    return (
      <Screen bottomPad={34}>
        <Header nav={nav} app={app} title="Record file" back />
        <EmptyState icon={FolderOpen} title="File not found" subtitle="This record group may have moved after metadata changed." />
      </Screen>
    );
  }

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Record file" back />
      <View style={styles.pageBody}>
        <View style={styles.groupDetailHeader}>
          <View style={styles.recordGroupIcon}>
            {(group.type === "doctor" ? <Stethoscope size={22} color={C.primary} /> : group.type === "patient" ? <UserRound size={22} color={C.primary} /> : <Building2 size={22} color={C.primary} />)}
          </View>
          <View style={styles.flexFill}>
            <Text style={styles.simplePageTitle} numberOfLines={2}>{group.label}</Text>
            <Text style={styles.simplePageSubtitle}>{group.docs.length} documents - {group.pageCount} pages</Text>
          </View>
        </View>

        {!!originals.length && (
          <Card style={styles.groupOriginalViewer}>
            <View style={styles.groupViewerTop}>
              <Text style={styles.groupViewerTitle}>Uploaded files</Text>
              <Text style={styles.groupViewerCount}>{Math.min(selectedIndex + 1, originals.length)} / {originals.length}</Text>
            </View>
            <View style={styles.groupPreviewStage}>
              <Animated.View style={{ transform: [{ scale: zoom }, { rotate: `${rotation}deg` }] }}>
                {selectedIsImage ? (
                  <Image source={{ uri: selected.file.uri }} style={styles.groupPreviewImage} resizeMode="contain" />
                ) : (
                  <View style={styles.groupPdfPreview}>
                    <FileText size={36} color={C.primary} />
                    <Text style={styles.groupPdfTitle} numberOfLines={2}>{selected?.file?.name || selected?.doc?.fileName || "PDF document"}</Text>
                  </View>
                )}
              </Animated.View>
            </View>
            {!!selectedDoc && (
              <View style={styles.groupSelectedMeta}>
                <View style={styles.flexFill}>
                  <Text style={styles.groupSelectedTitle} numberOfLines={1}>{selectedDoc.title || selectedDoc.fileName || "Uploaded file"}</Text>
                  <Text style={styles.groupSelectedSub} numberOfLines={1}>{selected?.file?.name || selectedDoc.fileName || "Original saved locally"}</Text>
                </View>
                <StatusPill status={selectedDoc.status || "ready"} />
              </View>
            )}
            <View style={styles.viewerTools}>
              <ViewerTool icon={ChevronLeft} onPress={() => setSelectedIndex((index) => Math.max(0, index - 1))} />
              <ViewerTool icon={ChevronRight} onPress={() => setSelectedIndex((index) => Math.min(originals.length - 1, index + 1))} />
              <ViewerTool icon={ZoomOut} onPress={() => setZoom((z) => Math.max(0.8, z - 0.1))} />
              <ViewerTool icon={ZoomIn} onPress={() => setZoom((z) => Math.min(1.45, z + 0.1))} />
              <ViewerTool icon={RotateCw} onPress={() => setRotation((r) => r + 90)} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupThumbRow}>
              {originals.map((item, index) => {
                const isImage = item.file?.mimeType?.startsWith("image/");
                return (
                  <TouchableOpacity key={`${item.doc.id}-${index}`} activeOpacity={0.78} onPress={() => setSelectedIndex(index)} style={[styles.groupThumb, selectedIndex === index && styles.groupThumbActive]}>
                    {isImage ? <Image source={{ uri: item.file.uri }} style={styles.groupThumbImage} resizeMode="cover" /> : <FileText size={24} color={C.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {selectedNeedsReupload && (
              <AppButton icon={RefreshCcw} onPress={() => app.reuploadDoc?.(selectedDoc.id)} style={[styles.fullWidth, { marginTop: 14 }]}>
                Reupload this file
              </AppButton>
            )}
          </Card>
        )}

        <Card style={styles.infoPanel}>
          <View style={styles.insightPanelHeader}>
            <FolderOpen size={17} color={C.primary} />
            <Text style={styles.ocrTitle}>File details</Text>
          </View>
          <InfoRow label="Grouped by" value={groupLabelForMode(group.type)} />
          <InfoRow label="Latest upload" value={group.docs[0]?.date} />
          <InfoRow label="Categories" value={group.categoryLabels.join(", ")} />
          <InfoRow label="Status" value={group.docs.some((doc) => isReuploadStatus(doc.status)) ? "Reupload needed" : group.docs.some((doc) => isProcessingStatus(doc.status)) ? "Processing" : "Ready"} />
        </Card>

        <SectionTitle text="Documents" />
        <View style={styles.groupDocsList}>
          {group.docs.map((doc) => (
            <EnterpriseRecordCard key={doc.id} doc={doc} onPress={() => openDocument(nav, doc)} />
          ))}
        </View>
      </View>
    </Screen>
  );
}

function RecordsStat({ icon: Icon, label, value, tone }) {
  const colors = {
    blue: [C.blueSoft, C.blue],
    green: [C.greenSoft, C.green],
    amber: [C.amberSoft, C.amber],
  };
  const [bg, fg] = colors[tone] || colors.blue;
  return (
    <Card style={styles.recordsStatCard}>
      <View style={[styles.recordsStatIcon, { backgroundColor: bg }]}>
        <Icon size={17} color={fg} />
      </View>
      <Text style={styles.recordsStatValue}>{value}</Text>
      <Text style={styles.recordsStatLabel}>{label}</Text>
    </Card>
  );
}

function StatusPill({ status }) {
  const [label, color, bg] = statusCopy(status);
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusPillText, { color }]}>{label}</Text>
    </View>
  );
}

function EnterpriseRecordCard({ doc, onPress, compact = false }) {
  const cat = categoryFor(doc.category);
  const Icon = cat.icon;
  const summary = doc.summary || doc.ocr || "Original file saved in the vault.";
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={[styles.enterpriseRecordCard, compact && styles.enterpriseRecordCardCompact]}>
      <View style={styles.recordCardTop}>
        <View style={[styles.recordCategoryIcon, { backgroundColor: cat.tint }]}>
          <Icon size={20} color={cat.color} />
        </View>
        <View style={styles.flexFill}>
          <Text style={styles.recordCardTitle} numberOfLines={1}>{doc.title}</Text>
          <Text style={styles.recordCardMeta} numberOfLines={1}>{cat.label} - {doc.date}</Text>
        </View>
        <StatusPill status={doc.status || "ready"} />
      </View>
      {!compact && <Text style={styles.recordCardSummary} numberOfLines={2}>{summary}</Text>}
      <View style={styles.recordMetaGrid}>
        <View style={styles.recordMetaItem}>
          <Building2 size={14} color={C.muted} />
          <Text style={styles.recordMetaText} numberOfLines={1}>{doc.hospital || "Hospital not set"}</Text>
        </View>
        <View style={styles.recordMetaItem}>
          <Stethoscope size={14} color={C.muted} />
          <Text style={styles.recordMetaText} numberOfLines={1}>{doc.doctor || "Doctor not set"}</Text>
        </View>
      </View>
      {!compact && <View style={styles.recordCardFooter}>
        <View style={styles.recordTagRow}>
          {(doc.tags || []).slice(0, 3).map((tag) => (
            <Text key={tag} style={styles.recordTag}>{tag}</Text>
          ))}
          {doc.originalSaved && <Text style={styles.recordTag}>original saved</Text>}
        </View>
        <ChevronRight size={18} color={C.primary} />
      </View>}
    </TouchableOpacity>
  );
}

function RecordsDots() {
  const dots = [];
  for (let row = 0; row < 18; row += 1) {
    for (let col = 0; col < 16; col += 1) {
      dots.push(<View key={`${row}-${col}`} style={[styles.recordsDot, { left: col * 22 + 12, top: row * 20 + 8 }]} />);
    }
  }
  return <View pointerEvents="none" style={styles.recordsDots}>{dots}</View>;
}

function DeckChip({ label, active, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={[styles.deckChip, active && styles.deckChipActive]}>
      <Text style={[styles.deckChipText, active && { color: C.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DeckSortButton({ icon: Icon, label, active, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={[styles.deckSortButton, active && styles.deckSortActive]}>
      <Icon size={14} color={active ? C.ink : "rgba(255,255,255,0.7)"} />
      <Text style={[styles.deckSortText, active && { color: C.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RecordDeckCard({ doc, index, total, scrollY, onPress }) {
  const cat = categoryFor(doc.category);
  const Icon = cat.icon;
  const colors = RECORD_CARD_GRADS[doc.category] || RECORD_CARD_GRADS.others;
  const isLast = index === total - 1;
  const cardTop = index * DECK_STEP;
  const detailOpacity = scrollY.interpolate({
    inputRange: [cardTop - 265, cardTop - 150, cardTop - 62],
    outputRange: [1, 0.42, 0],
    extrapolate: "clamp",
  });
  const detailTranslateY = detailOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  const cardScale = scrollY.interpolate({
    inputRange: [cardTop - 260, cardTop - 80, cardTop + 90],
    outputRange: [1, 0.985, 0.955],
    extrapolate: "clamp",
  });
  const cardTranslateY = scrollY.interpolate({
    inputRange: [cardTop - 240, cardTop - 90, cardTop + 120],
    outputRange: [0, -4, -18],
    extrapolate: "clamp",
  });
  const cardOpacity = scrollY.interpolate({
    inputRange: [cardTop - 320, cardTop + 70, cardTop + 190],
    outputRange: [1, 1, 0.68],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      style={[
        styles.deckCardMotion,
        {
          top: cardTop,
          zIndex: index + 1,
          elevation: index + 6,
          opacity: cardOpacity,
          transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
        },
      ]}
    >
      <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.deckCardTouch}>
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.deckCard, isLast && styles.deckCardLast]}
        >
          <View style={styles.deckCardGlow} />
          <View style={styles.deckCardHeader}>
            <View style={styles.deckCardTitleWrap}>
              <Text style={styles.deckCardCategory}>{cat.label}</Text>
              <Text style={styles.deckCardTitle} numberOfLines={1}>{doc.title}</Text>
            </View>
            <View style={styles.deckCardIcon}>
              <Icon size={20} color="#fff" />
            </View>
          </View>
          <Animated.View style={[styles.deckDetails, { opacity: detailOpacity, transform: [{ translateY: detailTranslateY }] }]}>
            <View style={styles.deckCardBody}>
              <View style={styles.deckMetric}>
                <Text style={styles.deckMetricValue}>{String(doc.pages).padStart(2, "0")}</Text>
                <Text style={styles.deckMetricLabel}>Pages</Text>
              </View>
              <View style={styles.deckCardLine}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((tick) => <View key={tick} style={[styles.deckTick, tick === 4 && styles.deckTickActive]} />)}
              </View>
              <View style={styles.deckDatePill}>
                <Calendar size={13} color="#fff" />
                <Text style={styles.deckDateText}>{doc.date}</Text>
              </View>
            </View>
            <View style={styles.deckCardFooter}>
              <Text style={styles.deckDoctor} numberOfLines={1}>{doc.doctor}</Text>
              <View style={styles.deckOpen}>
                <Text style={styles.deckOpenText}>Open</Text>
                <ChevronRight size={16} color="#fff" />
              </View>
            </View>
          </Animated.View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

function SearchScreen({ nav, app }) {
  const [query, setQuery] = useState("");
  const results = app.docs.filter((doc) => docMatches(doc, query));
  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Search" back />
      <View style={styles.pageBody}>
        <SearchBox value={query} onChangeText={setQuery} placeholder="Search document names, OCR, doctors..." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {["reports", "prescriptions", "vaccinations", "Dr. Rhea", "MediCare"].map((term) => (
            <Chip key={term} label={term} active={query === term} onPress={() => setQuery(term)} />
          ))}
        </ScrollView>
        {!query ? (
          <EmptyState icon={Search} title="Search your vault" subtitle="Find documents by title, extracted text, category, hospital, doctor, or tag." />
        ) : results.length === 0 ? (
          <EmptyState icon={Search} title="No search results found" subtitle="Try another spelling or a broader term." />
        ) : (
          <View style={[styles.stackGap, { marginTop: 18 }]}>{results.map((doc) => <DocumentRow key={doc.id} doc={doc} onPress={() => openDocument(nav, doc)} />)}</View>
        )}
      </View>
    </Screen>
  );
}

function UploadPreview({ nav, app, params }) {
  const method = params?.method || "camera";
  const doc = app.docs.find((item) => item.id === params?.docId);
  const [enhanced, setEnhanced] = useState(true);
  const copy = {
    camera: ["Scan with Camera", "Captured document"],
    gallery: ["Upload from Gallery", `${doc?.localFiles?.length || 1} image${(doc?.localFiles?.length || 1) > 1 ? "s" : ""} selected`],
    pdf: ["Upload PDF", "PDF selected"],
  }[method];
  const isImageDoc = doc?.mimeType?.startsWith("image/");

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title={copy[0]} back />
      <View style={styles.pageBody}>
        <Card style={styles.uploadStatusCard}>
          <View style={styles.uploadStatusIcon}>
            <ShieldCheck size={20} color={C.green} />
          </View>
          <View style={styles.flexFill}>
            <Text style={styles.uploadStatusTitle}>Original file saved locally</Text>
            <Text style={styles.uploadStatusText} numberOfLines={2}>{doc?.fileName || "The selected file is protected before OCR starts."}</Text>
          </View>
          <StatusPill status={doc?.status || "queued"} />
        </Card>

        <Card style={[styles.previewCard, method === "camera" && { backgroundColor: "#171316" }]}>
          {doc && isImageDoc ? (
            <Image source={{ uri: doc.localUri }} style={styles.originalImagePreview} resizeMode="contain" />
          ) : method === "pdf" ? (
            <View style={styles.pdfPreviewPanel}>
              <FileText size={42} color={C.primary} />
              <Text style={styles.pdfPreviewTitle} numberOfLines={2}>{doc?.fileName || "PDF document"}</Text>
              <Text style={styles.pdfPreviewSub}>Embedded text will be extracted when available.</Text>
            </View>
          ) : (
            <View>
              <DocumentMock />
              {method === "camera" && <View style={styles.scanLine} />}
            </View>
          )}
        </Card>
        <View style={styles.toolGrid}>
          <ToolButton icon={RefreshCcw} label={method === "camera" ? "Retake" : "Replace"} />
          <ToolButton icon={Crop} label="Crop" />
          <ToolButton icon={RotateCw} label="Rotate" />
          <ToolButton icon={Sparkles} label="Enhance" active={enhanced} onPress={() => setEnhanced(!enhanced)} />
        </View>
        <Card style={[styles.readyCard, { backgroundColor: C.greenSoft }]}>
          <Check size={18} color={C.green} />
          <View style={styles.flexFill}>
            <Text style={styles.readyTitle}>{copy[1]}</Text>
            <Text style={styles.readySubtitle}>Ready for backend OCR and AI categorization</Text>
          </View>
        </Card>
        <AppButton disabled={!doc} icon={Sparkles} onPress={() => nav.push("analysis", { method, docId: doc?.id })} style={[styles.fullWidth, { marginTop: 18 }]}>Run OCR + AI</AppButton>
      </View>
    </Screen>
  );
}

function ToolButton({ icon: Icon, label, active, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={[styles.toolButton, active && styles.toolButtonActive]}>
      <Icon size={18} color={active ? C.primary : C.text} />
      <Text style={[styles.toolLabel, active && { color: C.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AnalysisScreen({ nav, app, params }) {
  const doc = app.docs.find((item) => item.id === params?.docId);
  const [progress, setProgress] = useState(doc?.status === "ready" ? 100 : 12);
  const [stage, setStage] = useState(doc?.status === "ready" ? "Analysis complete" : "Preparing document");
  const [error, setError] = useState("");
  const [runId, setRunId] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!doc || startedRef.current) return undefined;

    if (doc.status === "ready" || isReuploadStatus(doc.status)) {
      setProgress(100);
      setStage(doc.status === "ready" ? "Analysis complete" : "Reupload needed");
      setError(doc.aiError || "");
      return undefined;
    }

    if (doc.status === "processing" || doc.status === "ocr_complete") {
      setProgress(doc.status === "ocr_complete" ? 82 : 48);
      setStage(doc.status === "ocr_complete" ? "Writing summary and grouping record" : "Processing in background");
      setError("");
      return undefined;
    }

    startedRef.current = true;
    let active = true;

    const runPipeline = async () => {
      try {
        const updated = await runDocumentPipeline(doc, app, {
          isActive: () => active,
          setStage,
          setProgress,
        });

        if (!active) return;
        setError(updated?.aiError || "");
        setStage(updated?.status === "ready" ? "Analysis complete" : "Reupload needed");
        setProgress(100);
      } catch (caught) {
        const patch = processingFailurePatch(caught);
        const message = patch.aiError;
        app.updateDocPatch(doc.id, patch);
        if (active) {
          setError(message);
          setStage("Reupload needed");
          setProgress(100);
        }
      }
    };

    runPipeline();
    return () => {
      active = false;
    };
  }, [doc?.id, runId]);

  const currentDoc = app.docs.find((item) => item.id === params?.docId) || doc;
  const done = currentDoc?.status === "ready" || isReuploadStatus(currentDoc?.status) || progress >= 100;
  const needsReupload = isReuploadStatus(currentDoc?.status);
  const isImageDoc = currentDoc?.mimeType?.startsWith("image/");
  const retryProcessing = () => {
    if (!currentDoc) return;
    startedRef.current = false;
    setError("");
    setProgress(12);
    setStage("Preparing document");
    app.updateDocPatch(currentDoc.id, {
      status: "queued",
      needsReview: false,
      aiError: "",
      summary: "Retrying OCR and AI analysis.",
    });
    setRunId((value) => value + 1);
  };

  useEffect(() => {
    if (!currentDoc || done) return undefined;
    const max = stage.includes("Summarizing") || stage.includes("Structuring") ? 94 : 76;
    const timer = setInterval(() => {
      setProgress((value) => (value < max ? Math.min(max, value + 1) : value));
    }, 520);
    return () => clearInterval(timer);
  }, [currentDoc, done, stage]);

  if (!currentDoc) {
    return (
      <Screen bottomPad={34}>
        <Header nav={nav} app={app} title="Analyze" back />
        <View style={styles.pageBody}>
          <EmptyState icon={FileText} title="No document selected" subtitle="Choose a file from Upload to run OCR and AI." />
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Processing" back />
      <View style={styles.pageBody}>
        <View style={styles.simplePageHeader}>
          <Text style={styles.simplePageTitle}>Extract document data</Text>
          <Text style={styles.simplePageSubtitle}>OCR reads the file first. AI then summarizes and categorizes it.</Text>
        </View>
        <Card style={styles.analysisHeroCard}>
          <View style={styles.analysisHeroTop}>
            <View style={styles.analysisCrossWrap}>
              {done ? <Check size={34} color={currentDoc.status === "ready" ? C.green : C.red} /> : <MedicalCross size={48} color={C.primary} animated />}
            </View>
            <View style={styles.flexFill}>
              <Text style={styles.analysisTitle}>{stage}</Text>
              <Text style={styles.analysisBody} numberOfLines={2}>{currentDoc.title}</Text>
            </View>
            {!done && <ActivityIndicator color={C.primary} />}
          </View>
          <ExtractionAnimation active={!done} progress={progress} />
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
          <View style={styles.analysisSteps}>
            <AnalysisStep label="Original saved" done />
            <AnalysisStep label="OCR" done={progress >= 70 || !!currentDoc.ocr} active={progress < 78 && !done} />
            <AnalysisStep label="Structured text" done={!!currentDoc.structuredOcr || currentDoc.status === "ready"} active={progress >= 78 && progress < 92 && !done} />
            <AnalysisStep label="AI summary" done={currentDoc.status === "ready"} active={progress >= 92 && !done} />
            <AnalysisStep label={needsReupload ? "Reupload" : "Result"} done={done} active={needsReupload} />
          </View>
          {!!error && <Text style={styles.analysisError}>{error}</Text>}
        </Card>

        <Card style={styles.originalCard}>
          <View style={styles.originalHeader}>
            <Text style={styles.originalTitle}>ORIGINAL DOCUMENT</Text>
            <View style={styles.originalTools}>
              <IconButton icon={ZoomIn} label="Zoom" style={styles.tinyIconButton} />
              <IconButton icon={Maximize2} label="Full screen" style={styles.tinyIconButton} />
            </View>
          </View>
          <View style={styles.originalPreview}>
            {isImageDoc ? <Image source={{ uri: currentDoc.localUri }} style={styles.originalImagePreview} resizeMode="contain" /> : <DocumentMock />}
          </View>
        </Card>

        <View style={styles.insightGrid}>
          <MiniInsight icon={FileCheck2} label="Category" value={categoryFor(currentDoc.category).label} tone="blue" />
          <MiniInsight icon={Building2} label="Hospital" value={currentDoc.hospital || "Not found yet"} tone="green" />
        </View>
        {needsReupload ? (
          <View style={styles.twoCol}>
            <AppButton tone="soft" icon={RefreshCcw} onPress={retryProcessing} style={styles.flexFill}>Retry</AppButton>
            <AppButton icon={RefreshCcw} onPress={() => app.reuploadDoc?.(currentDoc.id)} style={styles.flexFill}>Reupload</AppButton>
          </View>
        ) : (
          <AppButton disabled={!done} icon={FolderOpen} onPress={() => nav.go("records")} style={[styles.fullWidth, { marginTop: 18 }]}>
            {done ? "Open records" : "Processing..."}
          </AppButton>
        )}
      </View>
    </Screen>
  );
}

function ExtractionAnimation({ active, progress }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      sweep.stopAnimation();
      pulse.stopAnimation();
      return undefined;
    }

    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1300,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 680, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 680, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    sweepLoop.start();
    pulseLoop.start();
    return () => {
      sweepLoop.stop();
      pulseLoop.stop();
    };
  }, [active, pulse, sweep]);

  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [-14, 118] });
  const packetOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const packetTranslate = pulse.interpolate({ inputRange: [0, 1], outputRange: [8, -6] });

  return (
    <View style={styles.extractorPanel}>
      <View style={styles.extractorDocument}>
        <View style={styles.extractorDocHeader}>
          <View style={styles.extractorDocMark} />
          <View style={styles.extractorDocTitleLines}>
            <View style={[styles.extractorLine, { width: 74 }]} />
            <View style={[styles.extractorLineSoft, { width: 48 }]} />
          </View>
        </View>
        {[0, 1, 2, 3].map((row) => (
          <View key={row} style={styles.extractorTextRow}>
            <View style={[styles.extractorTextCell, { flex: row === 2 ? 0.52 : 0.7 }]} />
            <View style={[styles.extractorTextCell, { flex: row === 1 ? 0.46 : 0.3 }]} />
          </View>
        ))}
        {active && <Animated.View style={[styles.extractorBeam, { transform: [{ translateY }] }]} />}
      </View>
      <Animated.View style={[styles.extractorPackets, { opacity: active ? packetOpacity : 1, transform: [{ translateY: active ? packetTranslate : 0 }] }]}>
        <View style={styles.packetRow}>
          <Sparkles size={14} color={C.primary} />
          <Text style={styles.packetText}>OCR text</Text>
        </View>
        <View style={styles.packetRow}>
          <Tags size={14} color={C.blue} />
          <Text style={styles.packetText}>Category</Text>
        </View>
        <View style={styles.packetRow}>
          <ShieldCheck size={14} color={C.green} />
          <Text style={styles.packetText}>{progress >= 82 ? "AI summary" : "Indexing"}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

function AnalysisStep({ label, done, active }) {
  return (
    <View style={styles.analysisStep}>
      <View style={[styles.analysisStepDot, done && styles.analysisStepDone, active && styles.analysisStepActive]}>
        {done && <Check size={10} color="#fff" />}
      </View>
      <Text style={[styles.analysisStepText, active && { color: C.primary }]}>{label}</Text>
    </View>
  );
}

function MiniInsight({ icon: Icon, label, value, tone }) {
  const map = { blue: [C.blueSoft, C.blue], green: [C.greenSoft, C.green] };
  const [bg, fg] = map[tone] || [C.blush, C.primary];
  return (
    <Card style={[styles.miniInsight, { backgroundColor: bg }]}>
      <Icon size={18} color={fg} />
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue} numberOfLines={1}>{value}</Text>
    </Card>
  );
}

function OCRReview({ nav, app, params }) {
  const incoming = params?.docId ? app.docs.find((doc) => doc.id === params.docId) : params?.doc;
  const [form, setForm] = useState({
    title: incoming?.title || "Medical document",
    category: incoming?.category || "others",
    tags: incoming?.tags?.join(", ") || "",
    hospital: incoming?.hospital || "",
    doctor: incoming?.doctor || "",
    visitDate: incoming?.date || "",
    ocr: incoming?.ocr || "",
    structuredText: structuredTextForDoc(incoming) || "",
    summary: incoming?.summary || "",
  });

  const save = async () => {
    const nextDoc = {
      ...incoming,
      id: incoming?.id || `d${Date.now()}`,
      title: form.title,
      category: form.category,
      date: form.visitDate,
      sortDate: incoming?.sortDate || Date.now(),
      doctor: form.doctor,
      hospital: form.hospital,
      tags: form.tags.split(",").map((x) => x.trim()).filter(Boolean),
      pages: incoming?.pages || 2,
      ocr: form.ocr,
      structuredOcr: incoming?.structuredOcr
        ? { ...incoming.structuredOcr, formattedText: form.structuredText }
        : {
          status: "ready",
          rawText: form.ocr,
          lineCount: form.structuredText.split(/\r?\n/).filter((line) => line.trim()).length,
          formattedText: form.structuredText,
          sections: [{ title: "Extracted text", lineNumbers: [] }],
          keyValuePairs: [],
          tables: [],
          warnings: [],
        },
      summary: form.summary || "Saved after edit.",
      clinicalSummary: incoming?.clinicalSummary || "",
      importantFindings: [],
      medicines: incoming?.medicines || [],
      tests: incoming?.tests || [],
      ocrConfidence: incoming?.ocrConfidence,
      extractionMode: incoming?.extractionMode,
      verifiedFacts: incoming?.verifiedFacts || [],
      rejectedFacts: incoming?.rejectedFacts || [],
      verification: incoming?.verification,
      status: "ready",
      needsReview: false,
      aiError: "",
    };
    if (incoming) {
      if (app.authToken) {
        await requestUpdateDocument(app.authToken, nextDoc.documentId || nextDoc.id, {
          title: nextDoc.title,
          category: nextDoc.category,
          hospital: nextDoc.hospital,
          doctor: nextDoc.doctor,
          visitDate: nextDoc.date,
          tags: nextDoc.tags,
          summary: nextDoc.summary,
          structuredOcr: nextDoc.structuredOcr,
        }).catch(() => undefined);
      }
      app.updateDoc(nextDoc);
      nav.go("records", { category: nextDoc.category });
    } else {
      app.addDoc(nextDoc);
      nav.go("records");
    }
  };

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Save Document" back />
      <View style={styles.pageBody}>
        <Card style={[styles.ocrBanner, { backgroundColor: isReuploadStatus(incoming?.status) ? C.redSoft : C.greenSoft }]}>
          <Sparkles size={18} color={isReuploadStatus(incoming?.status) ? C.red : C.green} />
          <Text style={styles.ocrBannerText}>{isReuploadStatus(incoming?.status) ? "Reupload needed. Original file is saved." : "OCR text and metadata are ready for correction."}</Text>
        </Card>
        <Field label="Rename document" value={form.title} onChangeText={(title) => setForm({ ...form, title })} icon={FileText} />
        <Text style={styles.fieldLabel}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, { marginTop: 8 }]}>
          {CATEGORIES.map((cat) => <Chip key={cat.id} label={cat.label} active={form.category === cat.id} onPress={() => setForm({ ...form, category: cat.id })} />)}
        </ScrollView>
        <Field label="AI summary" value={form.summary} onChangeText={(summary) => setForm({ ...form, summary })} icon={Sparkles} multiline />
        <Field label="Tags" value={form.tags} onChangeText={(tags) => setForm({ ...form, tags })} icon={Tags} />
        <Field label="Hospital name" value={form.hospital} onChangeText={(hospital) => setForm({ ...form, hospital })} icon={Building2} />
        <Field label="Doctor name" value={form.doctor} onChangeText={(doctor) => setForm({ ...form, doctor })} icon={Stethoscope} />
        <Field label="Visit date" value={form.visitDate} onChangeText={(visitDate) => setForm({ ...form, visitDate })} icon={CalendarClock} />
        <Field label="Clean extracted text" value={form.structuredText} onChangeText={(structuredText) => setForm({ ...form, structuredText })} icon={FileCheck2} multiline />
        <Field label="Raw OCR text" value={form.ocr} onChangeText={(ocr) => setForm({ ...form, ocr })} icon={FileText} multiline />
        <AppButton icon={ShieldCheck} onPress={save} style={styles.fullWidth}>{incoming ? "Save changes" : "Save document"}</AppButton>
      </View>
    </Screen>
  );
}

function DocumentDetail({ nav, app, params }) {
  const doc = params?.docId ? app.docs.find((item) => item.id === params.docId) : params?.doc || app.docs[0];
  const cat = categoryFor(doc.category);
  const Icon = cat.icon;
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [full, setFull] = useState(false);
  const isImageDoc = doc?.mimeType?.startsWith("image/");
  const summaryText = doc?.summary || doc?.clinicalSummary || "";
  const structuredText = structuredTextForDoc(doc);

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Document" back right={<IconButton icon={MoreHorizontal} label="More" />} />
      <View style={styles.pageBody}>
        <Card style={styles.documentViewer}>
          <Animated.View style={{ transform: [{ scale: zoom }, { rotate: `${rotation}deg` }] }}>
            {isImageDoc ? <Image source={{ uri: doc.localUri }} style={styles.viewerImagePreview} resizeMode="contain" /> : <DocumentMock />}
          </Animated.View>
        </Card>
        <View style={styles.viewerTools}>
          <ViewerTool icon={ZoomOut} onPress={() => setZoom((z) => Math.max(0.8, z - 0.1))} />
          <ViewerTool icon={ZoomIn} onPress={() => setZoom((z) => Math.min(1.35, z + 0.1))} />
          <ViewerTool icon={RotateCw} onPress={() => setRotation((r) => r + 90)} />
          <ViewerTool icon={Maximize2} onPress={() => setFull(true)} />
          <ViewerTool icon={Download} />
        </View>
        <View style={styles.docDetailHeader}>
          <View style={[styles.docIcon, { backgroundColor: cat.tint }]}>
            <Icon size={20} color={cat.color} />
          </View>
          <View style={styles.flexFill}>
            <Text style={styles.detailTitle} numberOfLines={1}>{doc.title}</Text>
            <Text style={styles.detailSubtitle}>{cat.label} - {doc.pages} pages</Text>
          </View>
          <StatusPill status={doc.status || "ready"} />
        </View>
        <Card style={styles.infoPanel}>
          <View style={styles.insightPanelHeader}>
            <FileCheck2 size={17} color={C.primary} />
            <Text style={styles.ocrTitle}>Document details</Text>
          </View>
          <InfoRow label="Category" value={cat.label} />
          <InfoRow label="Patient" value={doc.patientName} />
          <InfoRow label="Doctor" value={doc.doctor} />
          <InfoRow label="Hospital" value={doc.hospital} />
          <InfoRow label="Visit date" value={doc.date} />
          <InfoRow label="Tags" value={(doc.tags || []).join(", ")} />
          <InfoRow label="OCR provider" value={providerLabel(doc.ocrProvider)} />
          <InfoRow label="OCR confidence" value={percentLabel(doc.ocrConfidence)} />
        </Card>
        {!!summaryText && (
          <Card style={[styles.infoPanel, { backgroundColor: C.greenSoft }]}>
            <View style={styles.insightPanelHeader}>
              <Sparkles size={17} color={C.green} />
              <Text style={styles.ocrTitle}>AI summary</Text>
            </View>
            <Text style={styles.ocrText}>{summaryText}</Text>
          </Card>
        )}
        {!!structuredText && (
          <Card style={styles.infoPanel}>
            <View style={styles.insightPanelHeader}>
              <FileText size={17} color={C.blue} />
              <Text style={styles.ocrTitle}>Clean extracted text</Text>
            </View>
            <ReportText text={structuredText} />
          </Card>
        )}
        <View style={styles.twoCol}>
          <AppButton tone="soft" icon={Edit3} onPress={() => nav.push("ocrReview", { docId: doc.id })} style={styles.flexFill}>Edit metadata</AppButton>
          <AppButton tone="soft" icon={Share2} onPress={() => shareDocument(doc)} style={styles.flexFill}>Share</AppButton>
        </View>
        <AppButton tone="danger" icon={Trash2} onPress={() => { app.deleteDoc(doc.id); nav.go("records"); }} style={[styles.fullWidth, { marginTop: 10 }]}>Delete document</AppButton>
      </View>
      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={styles.fullPreview}>
          <TouchableOpacity activeOpacity={0.8} onPress={() => setFull(false)} style={styles.fullClose}><X size={20} color={C.primary} /></TouchableOpacity>
          {isImageDoc ? <Image source={{ uri: doc.localUri }} style={styles.fullPreviewImage} resizeMode="contain" /> : <DocumentMock />}
        </View>
      </Modal>
    </Screen>
  );
}

function stripInlineHtml(value = "") {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlTableRows(block = "") {
  const rows = [...String(block).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.map((row) => {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    return cells.map((cell) => stripInlineHtml(cell[1])).filter(Boolean);
  }).filter((row) => row.length);
}

function markdownTableRows(lines = []) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell && !/^:?-{2,}:?$/.test(cell)));
}

function ReportTable({ rows }) {
  if (!rows?.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reportTableScroll}>
      <View style={styles.reportTable}>
        {rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={[styles.reportTableRow, rowIndex === 0 && styles.reportTableHeaderRow]}>
            {row.map((cell, cellIndex) => (
              <Text key={`cell-${rowIndex}-${cellIndex}`} style={[styles.reportTableCell, rowIndex === 0 && styles.reportTableHeaderCell]}>
                {cell || "-"}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function ReportText({ text }) {
  const blocks = cleanReadableText(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return null;

  return (
    <View style={styles.reportTextWrap}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter(Boolean);
        if (/<table/i.test(block)) {
          return <ReportTable key={`block-${blockIndex}`} rows={htmlTableRows(block)} />;
        }
        if (lines.length > 1 && lines.every((line) => line.includes("|"))) {
          return <ReportTable key={`block-${blockIndex}`} rows={markdownTableRows(lines)} />;
        }

        return (
          <View key={`block-${blockIndex}`} style={styles.reportBlock}>
            {lines.map((line, lineIndex) => {
              const heading = line.match(/^(#{1,6})\s+(.+)/);
              if (heading) {
                return <Text key={`line-${lineIndex}`} style={styles.reportHeading}>{heading[2]}</Text>;
              }
              const bullet = line.match(/^\s*[-*]\s+(.+)/);
              if (bullet) {
                return (
                  <View key={`line-${lineIndex}`} style={styles.reportBulletRow}>
                    <View style={styles.reportBulletDot} />
                    <Text style={styles.reportText}>{bullet[1]}</Text>
                  </View>
                );
              }
              return <Text key={`line-${lineIndex}`} style={styles.reportText}>{stripInlineHtml(line)}</Text>;
            })}
          </View>
        );
      })}
    </View>
  );
}

function InsightList({ title, items, icon: Icon, tone = "pink" }) {
  const cleanItems = Array.isArray(items) ? items.map((item) => String(item).trim()).filter(Boolean) : [];
  if (!cleanItems.length) return null;
  const map = {
    pink: [C.blush, C.primary],
    blue: [C.blueSoft, C.blue],
    green: [C.greenSoft, C.green],
  };
  const [bg, fg] = map[tone] || map.pink;

  return (
    <Card style={[styles.infoPanel, { backgroundColor: bg }]}>
      <View style={styles.insightPanelHeader}>
        <Icon size={17} color={fg} />
        <Text style={styles.ocrTitle}>{title}</Text>
      </View>
      {cleanItems.map((item, index) => (
        <View key={`${title}-${index}`} style={styles.insightItem}>
          <View style={[styles.insightDot, { backgroundColor: fg }]} />
          <Text style={styles.insightItemText}>{item}</Text>
        </View>
      ))}
    </Card>
  );
}

function VerifiedFactsPanel({ facts }) {
  const cleanFacts = Array.isArray(facts) ? facts.filter((fact) => fact?.value && fact?.evidence).slice(0, 6) : [];
  if (!cleanFacts.length) return null;

  return (
    <Card style={styles.infoPanel}>
      <View style={styles.insightPanelHeader}>
        <BadgeCheck size={17} color={C.green} />
        <Text style={styles.ocrTitle}>Verified facts</Text>
      </View>
      {cleanFacts.map((fact, index) => (
        <View key={`${fact.label || fact.type}-${index}`} style={styles.verifiedFactItem}>
          <Text style={styles.verifiedFactText}>{fact.label || fact.type}: {fact.value}{fact.unit ? ` ${fact.unit}` : ""}</Text>
          <Text style={styles.verifiedEvidence} numberOfLines={2}>Evidence: {fact.evidence}</Text>
        </View>
      ))}
    </Card>
  );
}

function ViewerTool({ icon: Icon, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={styles.viewerTool}>
      <Icon size={17} color={C.primary} />
    </TouchableOpacity>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue} numberOfLines={2}>{value || "-"}</Text>
    </View>
  );
}

function ProfileScreen({ nav, app }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(app.user);
  const save = async () => {
    await app.saveUserProfile?.(form);
    setEditing(false);
  };
  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Profile" back />
      <View style={styles.pageBody}>
        <Card style={styles.profileCard}>
          <View style={styles.profilePhoto}>
            {form.photo ? <Image source={{ uri: form.photo }} style={styles.avatarImage} /> : <User size={34} color={C.primary} />}
          </View>
          <Text style={styles.profileName}>{app.user.name}</Text>
          <Text style={styles.profilePhone}>{app.user.phone}</Text>
          <AppButton tone="soft" icon={Edit3} onPress={() => setEditing(!editing)} style={{ marginTop: 15 }}>{editing ? "Cancel editing" : "Edit profile"}</AppButton>
        </Card>
        {editing ? (
          <Card style={styles.editCard}>
            <AppButton tone="soft" icon={UserRound} onPress={() => setForm({ ...form, photo: initialUser.photo })} style={[styles.fullWidth, { marginBottom: 14 }]}>Update profile picture</AppButton>
            <Field label="Full name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} icon={User} />
            <Field label="Date of birth" value={form.dob} onChangeText={(dob) => setForm({ ...form, dob })} icon={Calendar} />
            <Field label="Gender" value={form.gender} onChangeText={(gender) => setForm({ ...form, gender })} icon={UserRound} />
            <Field label="Blood group" value={form.blood} onChangeText={(blood) => setForm({ ...form, blood })} icon={Shield} />
            <AppButton icon={Check} onPress={save} style={styles.fullWidth}>Save profile</AppButton>
          </Card>
        ) : (
          <>
            <SectionTitle text="Basic information" />
            <Card style={styles.infoPanel}>
              <InfoRow label="Date of birth" value={app.user.dob} />
              <InfoRow label="Gender" value={app.user.gender} />
              <InfoRow label="Blood group" value={app.user.blood} />
            </Card>
            <SectionTitle text="Account" />
            <ListAction icon={Lock} title="Secure session" subtitle="Mobile OTP verified" />
            <ListAction icon={Download} title="Export documents" subtitle="Encrypted archive" />
            <ListAction icon={X} title="Logout" subtitle="End this secure session" onPress={app.logout} />
            <ListAction icon={Trash2} title="Delete account" subtitle="Remove vault and metadata" danger onPress={() => nav.go("welcome")} />
          </>
        )}
      </View>
    </Screen>
  );
}

function SettingsScreen({ nav, app }) {
  const [largeText, setLargeText] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [offline, setOffline] = useState(true);
  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Settings" back />
      <View style={styles.pageBody}>
        <SectionTitle text="Accessibility" />
        <Card style={styles.infoPanel}>
          <ToggleRow icon={Type} label="Dynamic font sizes" on={largeText} onPress={() => setLargeText(!largeText)} />
          <ToggleRow icon={Eye} label="High contrast mode" on={contrast} onPress={() => setContrast(!contrast)} />
          <ToggleRow icon={ShieldCheck} label="Screen reader labels" on />
        </Card>
        <SectionTitle text="Offline and security" />
        <Card style={styles.infoPanel}>
          <ToggleRow icon={WifiOff} label="Offline metadata cache" on={offline} onPress={() => setOffline(!offline)} />
          <ListAction icon={Lock} title="Encrypted storage" subtitle="Local file protection enabled" />
          <ListAction icon={Globe} title="Secure API communication" subtitle="HTTPS only" />
        </Card>
        <SectionTitle text="Support" />
        <ListAction icon={HelpCircle} title="Help and support" />
        <ListAction icon={Info} title="About Heault" subtitle="Lightweight medical document vault" />
      </View>
    </Screen>
  );
}

function ToggleRow({ icon: Icon, label, on, onPress }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleIcon}><Icon size={18} color={C.primary} /></View>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Toggle on={on} onPress={onPress} />
    </View>
  );
}

function ListAction({ icon: Icon, title, subtitle, danger, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={[styles.docRow, { marginTop: 10 }]}>
      <View style={[styles.docIcon, { backgroundColor: danger ? C.redSoft : C.surface2 }]}>
        <Icon size={19} color={danger ? C.red : C.primary} />
      </View>
      <View style={styles.docTextWrap}>
        <Text style={[styles.docTitle, danger && { color: C.red }]}>{title}</Text>
        {!!subtitle && <Text style={styles.docSubtitle}>{subtitle}</Text>}
      </View>
      <ChevronRight size={18} color={C.muted} />
    </TouchableOpacity>
  );
}

function BottomNav({ current, nav, fabOpen, setFabOpen, onUpload }) {
  const options = [
    { id: "camera", icon: Camera, label: "Scan with Camera", sub: "Convert physical papers to digital data", tone: C.primary },
    { id: "pdf", icon: FileText, label: "Upload PDF", sub: "Direct import from medical portals", tone: C.primary2 },
    { id: "gallery", icon: ImageIcon, label: "Upload from Gallery", sub: "Select existing document images", tone: C.green },
  ];
  const openUpload = async (method) => {
    setFabOpen(false);
    await onUpload?.(method);
  };
  return (
    <>
      <Modal visible={fabOpen} transparent animationType="fade" onRequestClose={() => setFabOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setFabOpen(false)} style={styles.sheetScrim}>
          <TouchableOpacity activeOpacity={1} style={styles.uploadSheet}>
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetTitle}>Add New Record</Text>
            <Text style={styles.sheetSubtitle}>Choose how you would like to import your medical documents.</Text>
            <View style={styles.sheetOptions}>
              {options.map((item, index) => {
                const Icon = item.icon;
                const primary = index === 0;
                return (
                  <TouchableOpacity key={item.id} activeOpacity={0.82} onPress={() => openUpload(item.id)} style={[styles.uploadOption, primary && { backgroundColor: C.primary }]}>
                    <View style={[styles.uploadOptionIcon, { backgroundColor: primary ? "rgba(255,255,255,0.14)" : `${item.tone}18` }]}>
                      <Icon size={22} color={primary ? "#fff" : item.tone} />
                    </View>
                    <View style={styles.flexFill}>
                      <Text style={[styles.uploadOptionTitle, primary && { color: "#fff" }]}>{item.label}</Text>
                      <Text style={[styles.uploadOptionSub, primary && { color: "rgba(255,255,255,0.72)" }]}>{item.sub}</Text>
                    </View>
                    <ChevronRight size={19} color={primary ? "rgba(255,255,255,.65)" : C.muted} />
                  </TouchableOpacity>
                );
              })}
            </View>
            <AppButton tone="danger" onPress={() => setFabOpen(false)} style={[styles.fullWidth, { marginTop: 22 }]}>Cancel</AppButton>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      <View style={styles.bottomNav}>
        <NavItem icon={Home} label="Home" active={current === "home"} onPress={() => { setFabOpen(false); nav.go("home"); }} />
        <TouchableOpacity accessibilityLabel="Upload" activeOpacity={0.82} onPress={() => setFabOpen(!fabOpen)} style={styles.navFab}>
          <Plus size={30} color="#fff" style={{ transform: [{ rotate: fabOpen ? "45deg" : "0deg" }] }} />
        </TouchableOpacity>
        <NavItem icon={FolderOpen} label="Records" active={current === "records"} onPress={() => { setFabOpen(false); nav.go("records"); }} />
      </View>
    </>
  );
}

function NavItem({ icon: Icon, label, active, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={styles.navItem}>
      <Icon size={20} color={active ? C.primary : C.muted} />
      <View style={active ? styles.navActivePill : null}>
        <Text style={[styles.navLabel, active && { color: C.primary }]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

const ROOT_SCREENS = ["home", "records"];

export default function App() {
  const [stack, setStack] = useState([{ screen: "splash" }]);
  const [fabOpen, setFabOpen] = useState(false);
  const [user, setUser] = useState(initialUser);
  const [docs, setDocs] = useState([]);
  const [authToken, setAuthToken] = useState("");
  const [bootstrapped, setBootstrapped] = useState(false);
  const processingIdsRef = useRef(new Set());

  useEffect(() => {
    if (Platform.OS === "android") {
      NativeStatusBar.setHidden(true, "fade");
      NativeStatusBar.setTranslucent(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const boot = async () => {
      const saved = await readSavedState();
      const savedToken = saved?.token || "";
      const savedUser = saved?.user ? normalizeServerUser(saved.user) : initialUser;
      const savedDocs = Array.isArray(saved?.docs) ? saved.docs.map(withRecordGroup) : [];

      if (active) {
        setAuthToken(savedToken);
        setUser(savedUser);
        setDocs(savedDocs);
      }

      if (!savedToken) {
        if (active) {
          setStack([{ screen: "welcome" }]);
          setBootstrapped(true);
        }
        return;
      }

      try {
        const [me, remote] = await Promise.all([requestMe(savedToken), requestDocuments(savedToken)]);
        const nextUser = normalizeServerUser(me.user);
        const nextDocs = mergeRemoteDocuments(savedDocs, remote.documents || []);
        if (!active) return;
        setUser(nextUser);
        setDocs(nextDocs);
        setStack([{ screen: "home" }]);
        setBootstrapped(true);
        await writeSavedState({ token: savedToken, user: nextUser, docs: nextDocs });
      } catch {
        await clearSavedState();
        if (!active) return;
        setAuthToken("");
        setUser(initialUser);
        setDocs([]);
        setStack([{ screen: "welcome" }]);
        setBootstrapped(true);
      }
    };
    boot();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped) return undefined;
    writeSavedState({ token: authToken, user, docs }).catch(() => undefined);
    return undefined;
  }, [bootstrapped, authToken, user, docs]);

  const push = useCallback((screen, params) => setStack((s) => [...s, { screen, params }]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const go = useCallback((screen, params) => {
    setFabOpen(false);
    setStack([{ screen, params }]);
  }, []);
  const startUpload = useCallback(async (method) => {
    if (!authToken) {
      Alert.alert("Login required", "Please login or create an account before uploading medical documents.");
      go("welcome");
      return;
    }
    try {
      const assets = await pickUploadAssets(method);
      if (!assets?.length) return;
      const localFiles = await copyAssetsToVault(assets, method);
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const drafts = method === "gallery" && localFiles.length > 1
        ? localFiles.map((file, index) => createDraftDocument(method, [file], index, batchId))
        : [createDraftDocument(method, localFiles, 0, batchId)];
      setDocs((existing) => [...drafts, ...existing]);
      go("records");
    } catch (error) {
      Alert.alert("Upload failed", error?.message || "Could not import this document.");
    }
  }, [authToken, go]);
  const reuploadDoc = useCallback(async (docId, method = "gallery") => {
    if (!authToken) {
      Alert.alert("Login required", "Please login before reuploading medical documents.");
      go("welcome");
      return;
    }
    const target = docs.find((doc) => doc.id === docId);
    if (!target) return;

    try {
      const assets = await pickUploadAssets(method);
      if (!assets?.length) return;
      const localFiles = await copyAssetsToVault(assets.slice(0, 1), method);
      const replacement = localFiles[0];
      if (!replacement) return;
      setDocs((existingDocs) => existingDocs.map((doc) => {
        if (doc.id !== docId) return doc;
        return withRecordGroup({
          ...doc,
          title: titleFromFileName(replacement.name || doc.title || "Medical document"),
          sortDate: Date.now(),
          fileName: replacement.name || doc.fileName,
          mimeType: replacement.mimeType || doc.mimeType,
          localUri: replacement.uri,
          localFiles: [replacement],
          pages: 1,
          ocr: "",
          structuredOcr: null,
          pageLevelText: [],
          summary: "Replacement saved. OCR and AI are running again.",
          status: "queued",
          needsReview: false,
          aiError: "",
          warnings: [],
          originalSaved: true,
          uploadSource: method,
        });
      }));
      go("records");
    } catch (error) {
      Alert.alert("Reupload failed", error?.message || "Could not replace this file.");
    }
  }, [authToken, docs, go]);
  const refreshDocuments = useCallback(async () => {
    if (!authToken) return [];
    const remote = await requestDocuments(authToken);
    const nextDocs = mergeRemoteDocuments(docs, remote.documents || []);
    setDocs(nextDocs);
    return nextDocs;
  }, [authToken, docs]);
  const saveUserProfile = useCallback(async (profile) => {
    const nextUser = authToken
      ? normalizeServerUser((await requestProfileUpdate(authToken, profile)).user)
      : normalizeServerUser(profile);
    setUser(nextUser);
    return nextUser;
  }, [authToken]);
  const finishAuth = useCallback(async ({ token, user: nextUser }) => {
    const normalizedUser = normalizeServerUser(nextUser);
    setAuthToken(token || "");
    setUser(normalizedUser);
    let nextDocs = [];
    if (token) {
      const remote = await requestDocuments(token).catch(() => ({ documents: [] }));
      nextDocs = mergeRemoteDocuments([], remote.documents || []);
    }
    setDocs(nextDocs);
    await writeSavedState({ token, user: normalizedUser, docs: nextDocs });
    return { user: normalizedUser, docs: nextDocs };
  }, []);
  const logout = useCallback(async () => {
    await requestLogout(authToken);
    await clearSavedState();
    setAuthToken("");
    setUser(initialUser);
    setDocs([]);
    setFabOpen(false);
    setStack([{ screen: "welcome" }]);
  }, [authToken]);
  const nav = { push, pop, go };
  const app = {
    authToken,
    user,
    setUser: (nextUser) => setUser(normalizeServerUser(nextUser)),
    saveUserProfile,
    finishAuth,
    logout,
    refreshDocuments,
    docs,
    addDoc: (doc) => setDocs((d) => [withRecordGroup(doc), ...d]),
    updateDoc: (doc) => setDocs((d) => d.map((existing) => (existing.id === doc.id ? withRecordGroup(doc) : existing))),
    updateDocPatch: (id, patch) => setDocs((d) => d.map((existing) => (existing.id === id ? withRecordGroup({ ...existing, ...patch }) : existing))),
    deleteDoc: async (id) => {
      if (authToken) await requestDeleteDocument(authToken, id).catch(() => undefined);
      setDocs((d) => d.filter((doc) => doc.id !== id));
    },
    startUpload,
    reuploadDoc,
  };

  useEffect(() => {
    const queued = docs.filter((doc) => doc.status === "queued" && !processingIdsRef.current.has(doc.id));
    if (!queued.length) return undefined;

    queued.forEach((doc) => {
      processingIdsRef.current.add(doc.id);
      runDocumentPipeline(doc, app)
        .catch((error) => {
          app.updateDocPatch(doc.id, processingFailurePatch(error));
        })
        .finally(() => {
          processingIdsRef.current.delete(doc.id);
        });
    });

    return undefined;
  }, [docs]);

  const current = stack[stack.length - 1];
  const screens = {
    splash: <Splash />,
    welcome: <Welcome nav={nav} />,
    phone: <PhoneEntry nav={nav} params={current.params} />,
    otp: <OTP nav={nav} app={app} params={current.params} />,
    onboarding: <Onboarding nav={nav} app={app} />,
    home: <HomeScreen nav={nav} app={app} />,
    records: <RecordsScreen nav={nav} app={app} params={current.params} />,
    search: <SearchScreen nav={nav} app={app} />,
    uploadPreview: <UploadPreview nav={nav} app={app} params={current.params} />,
    analysis: <AnalysisScreen nav={nav} app={app} params={current.params} />,
    ocrReview: <OCRReview nav={nav} app={app} params={current.params} />,
    recordGroup: <RecordGroupDetail nav={nav} app={app} params={current.params} />,
    document: <DocumentDetail nav={nav} app={app} params={current.params} />,
    profile: <ProfileScreen nav={nav} app={app} />,
    settings: <SettingsScreen nav={nav} app={app} />,
  };
  const showChrome = !["splash", "welcome", "phone", "otp", "onboarding"].includes(current.screen);
  const isRoot = ROOT_SCREENS.includes(current.screen);

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar hidden />
      <LinearGradient colors={["#FBFCFD", "#F3F5F8"]} style={StyleSheet.absoluteFill} />
      <View style={styles.routeWrap}>{screens[current.screen] || screens.home}</View>
      {showChrome && isRoot && <BottomNav current={current.screen} nav={nav} fabOpen={fabOpen} setFabOpen={setFabOpen} onUpload={startUpload} />}
    </SafeAreaView>
  );
}

const topInset = 0;

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: C.bg,
  },
  routeWrap: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  screenContent: {
    paddingTop: topInset,
  },
  flexFill: {
    flex: 1,
  },
  fullWidth: {
    width: "100%",
  },
  header: {
    paddingHorizontal: 22,
    paddingTop: 48,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: "800",
    color: C.primary,
  },
  smallIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  tinyIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarButton: {
    width: 42,
    height: 42,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 4,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarInitial: {
    color: C.primary,
    fontSize: 18,
    fontWeight: "900",
  },
  nativeStatus: {
    position: "absolute",
    top: topInset,
    left: 0,
    right: 0,
    height: 38,
    zIndex: 20,
    paddingHorizontal: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusTime: {
    fontSize: 13.5,
    fontWeight: "800",
    color: C.ink,
  },
  statusIcons: {
    flexDirection: "row",
    gap: 5,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(255,255,255,0.82)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 3,
  },
  iconButtonActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  buttonTouch: {
    borderRadius: 18,
  },
  button: {
    minHeight: 50,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 26,
    elevation: 4,
  },
  buttonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  softButton: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line,
    shadowOpacity: 0,
    elevation: 0,
  },
  dangerButton: {
    backgroundColor: C.redSoft,
    shadowOpacity: 0,
    elevation: 0,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    shadowColor: C.primary,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 1,
  },
  textButton: {
    color: C.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  splashGlow: {
    position: "absolute",
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: "rgba(250,141,177,0.26)",
  },
  splashMark: {
    width: 118,
    height: 118,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 30 },
    shadowRadius: 80,
    elevation: 7,
  },
  splashName: {
    fontSize: 34,
    fontWeight: "900",
    color: C.primary,
    marginTop: 24,
  },
  splashTag: {
    fontSize: 13.5,
    fontWeight: "700",
    color: C.muted,
    marginTop: 5,
  },
  crossBarVertical: {
    position: "absolute",
  },
  crossBarHorizontal: {
    position: "absolute",
  },
  welcome: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: topInset + 74,
    paddingBottom: 34,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandName: {
    fontSize: 28,
    fontWeight: "900",
    color: C.primary,
  },
  brandTag: {
    fontSize: 13,
    color: C.muted,
    fontWeight: "700",
  },
  welcomeCard: {
    marginTop: 38,
    padding: 22,
    borderRadius: 22,
    minHeight: 190,
  },
  welcomeTitle: {
    color: "#fff",
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "900",
    marginTop: 18,
  },
  welcomeBody: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  authBody: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  authTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: C.ink,
  },
  authSubtitle: {
    fontSize: 14,
    color: C.muted,
    marginTop: 8,
    lineHeight: 21,
  },
  phoneRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 30,
  },
  countryBox: {
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: "#fff",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  countryText: {
    color: C.ink,
    fontWeight: "800",
  },
  countryInput: {
    minWidth: 54,
    color: C.ink,
    fontWeight: "900",
    fontSize: 15,
    padding: 0,
  },
  phoneInput: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: "#fff",
    paddingHorizontal: 15,
    fontSize: 16,
    fontWeight: "800",
    color: C.ink,
  },
  bottomAction: {
    paddingHorizontal: 24,
    paddingBottom: 30,
  },
  otpRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 30,
  },
  otpInput: {
    width: 58,
    height: 62,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: C.line,
    backgroundColor: "#fff",
    textAlign: "center",
    fontSize: 24,
    fontWeight: "900",
    color: C.ink,
  },
  otpInputActive: {
    borderColor: C.primary,
  },
  onboardingCard: {
    marginHorizontal: 24,
    marginTop: 8,
    padding: 18,
  },
  profileSetupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 18,
  },
  profilePreview: {
    width: 62,
    height: 62,
    borderRadius: 23,
    backgroundColor: C.blush,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: C.ink,
  },
  fieldWrap: {
    marginBottom: 15,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: "800",
    color: C.text,
  },
  fieldBox: {
    marginTop: 7,
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center",
  },
  fieldIcon: {
    position: "absolute",
    left: 14,
    zIndex: 2,
  },
  fieldInput: {
    minHeight: 50,
    color: C.ink,
    fontSize: 14.5,
    fontWeight: "600",
    paddingHorizontal: 15,
  },
  textAreaBox: {
    minHeight: 132,
    justifyContent: "flex-start",
    paddingTop: 9,
  },
  textAreaInput: {
    minHeight: 118,
    paddingTop: 5,
  },
  segmentGrid3: {
    marginTop: 8,
    flexDirection: "row",
    gap: 9,
  },
  bloodGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  segmentButton: {
    minHeight: 45,
    minWidth: 68,
    flex: 1,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
  },
  segmentActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  segmentText: {
    color: C.text,
    fontSize: 13,
    fontWeight: "800",
  },
  pageBody: {
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  simplePageHeader: {
    marginBottom: 14,
  },
  simplePageTitle: {
    color: C.ink,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
  },
  simplePageSubtitle: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  homeTitle: {
    fontSize: 25,
    lineHeight: 29,
    fontWeight: "900",
    color: C.ink,
  },
  homeSubtitle: {
    fontSize: 14,
    color: C.text,
    marginTop: 7,
    marginBottom: 18,
  },
  homeHeroCard: {
    borderRadius: 22,
    padding: 20,
    minHeight: 244,
    borderWidth: 1,
    borderColor: "#FFD4E2",
    shadowColor: C.primary,
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 28,
    elevation: 5,
    overflow: "hidden",
  },
  homeHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  homeHeroMark: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(116,22,54,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  homeHeroEyebrow: {
    color: C.primary,
    fontSize: 11.5,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  homeHeroTitle: {
    color: C.ink,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    marginTop: 4,
  },
  homeHeroText: {
    color: C.text,
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 15,
    maxWidth: 300,
  },
  homeHeroStats: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.78)",
    marginTop: 18,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  homeHeroNumber: {
    color: C.primary,
    fontSize: 22,
    fontWeight: "900",
  },
  homeHeroLabel: {
    color: C.text,
    fontSize: 11.5,
    fontWeight: "800",
    marginTop: 2,
  },
  homeHeroDivider: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(116,22,54,0.14)",
  },
  homeHeroAction: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: C.primary,
    marginTop: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  homeHeroActionText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  homeStats: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  simpleStat: {
    flex: 1,
    minHeight: 90,
    padding: 12,
    borderRadius: 14,
  },
  simpleStatValue: {
    color: C.ink,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 8,
  },
  simpleStatLabel: {
    color: C.muted,
    fontSize: 11.5,
    fontWeight: "800",
    marginTop: 2,
  },
  primaryUploadCard: {
    minHeight: 84,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#fff",
    padding: 14,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  primaryUploadIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryUploadTitle: {
    color: C.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  primaryUploadText: {
    color: C.muted,
    fontSize: 12.3,
    lineHeight: 17,
    marginTop: 3,
  },
  searchBox: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 2,
  },
  searchIcon: {
    position: "absolute",
    left: 15,
    zIndex: 2,
  },
  searchInput: {
    height: 52,
    paddingLeft: 43,
    paddingRight: 16,
    color: C.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  vaultCard: {
    marginTop: 22,
    borderRadius: 22,
    padding: 22,
    minHeight: 190,
    shadowColor: C.primary,
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 34,
    elevation: 5,
  },
  vaultStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  vaultStatusText: {
    color: "#fff",
    fontSize: 12.5,
    fontWeight: "800",
  },
  vaultTitle: {
    color: "#fff",
    fontSize: 37,
    lineHeight: 40,
    fontWeight: "900",
    marginTop: 16,
  },
  heroPills: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  heroPillText: {
    color: "#FFD3DF",
    fontSize: 12,
    fontWeight: "800",
  },
  infoGrid: {
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
  },
  infoCard: {
    flex: 1,
    padding: 14,
    minHeight: 96,
  },
  infoLabel: {
    fontSize: 12.5,
    color: C.text,
    marginTop: 10,
  },
  infoValue: {
    fontSize: 20,
    fontWeight: "900",
    color: C.ink,
  },
  sectionHeader: {
    marginTop: 22,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: C.ink,
  },
  categoriesRow: {
    gap: 10,
    paddingBottom: 4,
  },
  categoryTile: {
    width: 86,
    alignItems: "center",
    gap: 8,
  },
  categoryIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryLabel: {
    fontSize: 12.5,
    fontWeight: "700",
    color: C.ink,
  },
  stackGap: {
    gap: 11,
  },
  docRow: {
    width: "100%",
    minHeight: 70,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(255,255,255,0.86)",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: C.primary,
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 2,
  },
  docIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  docTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  docTitle: {
    color: C.ink,
    fontSize: 14.5,
    fontWeight: "800",
  },
  docSubtitle: {
    color: C.muted,
    fontSize: 12.2,
    marginTop: 3,
  },
  chipRow: {
    gap: 10,
    paddingBottom: 4,
    marginTop: 14,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  chipText: {
    fontSize: 12.5,
    fontWeight: "800",
  },
  recordsHeroPanel: {
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(255,255,255,0.74)",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  enterpriseEyebrow: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  enterpriseTitle: {
    color: C.ink,
    fontSize: 28,
    lineHeight: 31,
    fontWeight: "900",
    marginTop: 4,
  },
  enterpriseSubtitle: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    maxWidth: 230,
  },
  recordsSecureBadge: {
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recordsSecureText: {
    color: C.green,
    fontSize: 12,
    fontWeight: "900",
  },
  recordsCommandCenter: {
    padding: 14,
    marginTop: 14,
    borderRadius: 18,
  },
  recordsModeTabs: {
    minHeight: 40,
    flexDirection: "row",
    gap: 0,
    marginTop: 8,
    marginBottom: 2,
  },
  drawerModeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  drawerModeButtonActive: {
    backgroundColor: "transparent",
  },
  drawerModeText: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  recordsCategoryStrip: {
    gap: 9,
    paddingBottom: 3,
    marginTop: 12,
  },
  recordsSortStrip: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  recordsStatsGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  recordsStatCard: {
    flex: 1,
    minHeight: 96,
    borderRadius: 16,
    padding: 12,
  },
  recordsStatIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  recordsStatValue: {
    color: C.ink,
    fontSize: 21,
    fontWeight: "900",
  },
  recordsStatLabel: {
    color: C.muted,
    fontSize: 11.5,
    fontWeight: "800",
    marginTop: 2,
  },
  recordsList: {
    gap: 18,
  },
  recordGroupCard: {
    position: "relative",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E8D5DD",
    backgroundColor: "#FFF9F2",
    padding: 14,
    paddingTop: 22,
    shadowColor: C.primary,
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 28,
    elevation: 4,
  },
  folderTab: {
    position: "absolute",
    top: -10,
    left: 18,
    minWidth: 124,
    height: 26,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#E8D5DD",
    backgroundColor: "#FFF9F2",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  folderTabText: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  recordGroupHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  recordGroupIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8E4EC",
    borderWidth: 1,
    borderColor: "#EFD1DC",
  },
  recordGroupTitle: {
    color: C.ink,
    fontSize: 17.5,
    fontWeight: "900",
  },
  recordGroupSub: {
    color: C.muted,
    fontSize: 12.4,
    fontWeight: "700",
    marginTop: 3,
  },
  recordGroupMetaRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  recordGroupMetric: {
    minHeight: 30,
    borderRadius: 999,
    backgroundColor: "rgba(116,22,54,0.07)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recordGroupReviewMetric: {
    backgroundColor: C.amberSoft,
  },
  recordGroupMeta: {
    color: C.primary,
    fontSize: 11.5,
    fontWeight: "900",
  },
  groupDocsList: {
    gap: 9,
    marginTop: 12,
  },
  drawerFileStack: {
    marginTop: 10,
    gap: 8,
  },
  drawerFileRow: {
    minHeight: 60,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#EFE1E5",
    backgroundColor: "#FFFFFF",
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  drawerFileRowOverlap: {
    marginTop: -1,
  },
  drawerFileStripe: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 4,
  },
  drawerFileTitle: {
    color: C.ink,
    fontSize: 13.5,
    fontWeight: "900",
  },
  drawerFileMeta: {
    color: C.muted,
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 3,
  },
  drawerMoreRow: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: C.blush,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  drawerMoreText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  recordGroupOpenRow: {
    minHeight: 38,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: "rgba(116,22,54,0.07)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recordGroupOpenText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  groupDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  groupOriginalViewer: {
    padding: 14,
    borderRadius: 16,
  },
  groupViewerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  groupViewerTitle: {
    color: C.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  groupViewerCount: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  groupPreviewStage: {
    height: 370,
    borderRadius: 14,
    backgroundColor: C.bg2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  groupPreviewImage: {
    width: 320,
    height: 350,
  },
  groupPdfPreview: {
    width: 230,
    minHeight: 170,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  groupPdfTitle: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 10,
  },
  groupSelectedMeta: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  groupSelectedTitle: {
    color: C.ink,
    fontSize: 13.5,
    fontWeight: "900",
  },
  groupSelectedSub: {
    color: C.muted,
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 3,
  },
  groupThumbRow: {
    gap: 9,
    paddingTop: 12,
    paddingBottom: 2,
  },
  groupThumb: {
    width: 58,
    height: 70,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  groupThumbActive: {
    borderColor: C.primary,
    borderWidth: 2,
  },
  groupThumbImage: {
    width: "100%",
    height: "100%",
  },
  enterpriseRecordCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(255,255,255,0.92)",
    padding: 14,
    shadowColor: C.primary,
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 26,
    elevation: 3,
  },
  enterpriseRecordCardCompact: {
    borderRadius: 14,
    padding: 11,
    backgroundColor: C.bg2,
    shadowOpacity: 0,
    elevation: 0,
  },
  recordCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  recordCategoryIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  recordCardTitle: {
    color: C.ink,
    fontSize: 16,
    fontWeight: "900",
  },
  recordCardMeta: {
    color: C.muted,
    fontSize: 12.2,
    fontWeight: "700",
    marginTop: 3,
  },
  statusPill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 10.5,
    fontWeight: "900",
  },
  recordCardSummary: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  recordMetaGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  recordMetaItem: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    backgroundColor: C.bg2,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recordMetaText: {
    flex: 1,
    color: C.text,
    fontSize: 11.5,
    fontWeight: "800",
  },
  recordCardFooter: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 12,
  },
  recordTagRow: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  recordTag: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: C.blush,
    color: C.primary,
    fontSize: 10.5,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  recordsScreen: {
    flex: 1,
    backgroundColor: "#050508",
  },
  recordsContent: {
    flex: 1,
    paddingTop: topInset + 50,
    paddingHorizontal: 18,
    paddingBottom: 94,
  },
  recordsDots: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.28,
  },
  recordsDot: {
    position: "absolute",
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  recordsTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  recordsEyebrow: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  recordsTitle: {
    color: "#fff",
    fontSize: 35,
    lineHeight: 39,
    fontWeight: "900",
    marginTop: 3,
  },
  recordsHeaderButton: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
  },
  recordsSearchWrap: {
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    marginBottom: 14,
  },
  recordsSearchIcon: {
    position: "absolute",
    left: 15,
    zIndex: 2,
  },
  recordsSearchInput: {
    height: 52,
    paddingLeft: 43,
    paddingRight: 16,
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  recordsChipRow: {
    gap: 10,
    paddingBottom: 4,
  },
  deckChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  deckChipActive: {
    backgroundColor: "#F4F767",
    borderColor: "#F4F767",
  },
  deckChipText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12.5,
    fontWeight: "800",
  },
  recordsSortRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 13,
  },
  deckSortButton: {
    minHeight: 38,
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  deckSortActive: {
    backgroundColor: "#F4F767",
    borderColor: "#F4F767",
  },
  deckSortText: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 12,
    fontWeight: "800",
  },
  deckFilterButton: {
    width: 42,
    minHeight: 38,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  deckSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 4,
  },
  deckSummary: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 13,
    fontWeight: "800",
  },
  deckHint: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    fontWeight: "700",
  },
  recordsDeck: {
    position: "relative",
  },
  recordsDeckScroller: {
    flex: 1,
    marginTop: 8,
    marginBottom: 4,
    overflow: "visible",
  },
  deckCardMotion: {
    position: "absolute",
    left: 0,
    right: 0,
    height: DECK_CARD_HEIGHT,
    borderRadius: 28,
  },
  deckCardTouch: {
    height: DECK_CARD_HEIGHT,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.44,
    shadowOffset: { width: 0, height: 22 },
    shadowRadius: 34,
    elevation: 10,
  },
  deckCard: {
    height: DECK_CARD_HEIGHT,
    borderRadius: 28,
    padding: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  deckCardLast: {
    height: DECK_CARD_HEIGHT + 26,
  },
  deckCardGlow: {
    position: "absolute",
    right: -34,
    top: -44,
    width: 155,
    height: 155,
    borderRadius: 78,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  deckCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  deckCardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  deckCardCategory: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  deckCardTitle: {
    color: "#fff",
    fontSize: 27,
    lineHeight: 31,
    fontWeight: "900",
    marginTop: 3,
  },
  deckCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  deckCardBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  deckDetails: {
    marginTop: 28,
  },
  deckMetric: {
    minWidth: 58,
  },
  deckMetricValue: {
    color: "#fff",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "900",
  },
  deckMetricLabel: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  deckCardLine: {
    flex: 1,
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    opacity: 0.78,
  },
  deckTick: {
    width: 2,
    height: 18,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  deckTickActive: {
    height: 32,
    backgroundColor: "#F4F767",
  },
  deckDatePill: {
    height: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deckDateText: {
    color: "#fff",
    fontSize: 11.5,
    fontWeight: "800",
  },
  deckCardFooter: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  deckDoctor: {
    flex: 1,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    fontWeight: "700",
  },
  deckOpen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  deckOpenText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  recordsEmpty: {
    marginTop: 24,
    padding: 28,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  recordsEmptyTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 12,
  },
  recordsEmptySub: {
    color: "rgba(255,255,255,0.54)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 6,
  },
  sortGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  recordCountRow: {
    marginTop: 20,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recordCount: {
    fontSize: 18,
    fontWeight: "900",
    color: C.ink,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  emptyState: {
    paddingVertical: 48,
    paddingHorizontal: 22,
    alignItems: "center",
  },
  emptyIcon: {
    width: 66,
    height: 66,
    borderRadius: 22,
    backgroundColor: C.surface2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: C.ink,
  },
  emptySubtitle: {
    fontSize: 13,
    color: C.muted,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 6,
  },
  previewCard: {
    minHeight: 354,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    backgroundColor: C.surface,
  },
  pdfGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "center",
  },
  scanLine: {
    position: "absolute",
    left: -18,
    right: -18,
    top: "46%",
    height: 3,
    backgroundColor: C.primary3,
  },
  toolGrid: {
    flexDirection: "row",
    gap: 9,
    marginTop: 14,
  },
  toolButton: {
    flex: 1,
    minHeight: 62,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(255,255,255,0.86)",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  toolButtonActive: {
    backgroundColor: C.blush,
    borderColor: C.primary3,
  },
  toolLabel: {
    fontSize: 11.5,
    fontWeight: "800",
    color: C.text,
  },
  readyCard: {
    marginTop: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  readyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: C.ink,
  },
  readySubtitle: {
    color: C.muted,
    fontSize: 12.5,
    marginTop: 2,
  },
  uploadStatusCard: {
    padding: 14,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  uploadStatusIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: C.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadStatusTitle: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "900",
  },
  uploadStatusText: {
    color: C.muted,
    fontSize: 12.2,
    marginTop: 3,
  },
  originalImagePreview: {
    width: "100%",
    height: "100%",
    borderRadius: 16,
  },
  pdfPreviewPanel: {
    width: "100%",
    minHeight: 240,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg2,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  pdfPreviewTitle: {
    color: C.ink,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 14,
  },
  pdfPreviewSub: {
    color: C.muted,
    fontSize: 12.5,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 7,
  },
  documentMock: {
    borderRadius: 12,
    backgroundColor: "#fff",
    shadowColor: "#3B2A32",
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 44,
    elevation: 5,
  },
  mockHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  mockLogo: {
    borderRadius: 6,
    backgroundColor: C.blueSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  mockLineStrong: {
    height: 7,
    borderRadius: 4,
    backgroundColor: "#3B8DA6",
  },
  mockLine: {
    height: 5,
    borderRadius: 4,
    backgroundColor: "#C7D8DE",
  },
  mockDivider: {
    height: 1,
    backgroundColor: C.line2,
    marginVertical: 16,
  },
  mockGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 9,
  },
  mockCell: {
    flex: 1,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#E7EEF1",
  },
  mockBars: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
  },
  mockAccentLine: {
    height: 1.5,
    backgroundColor: C.primary3,
    marginTop: 18,
    opacity: 0.72,
  },
  mockFooter: {
    flexDirection: "row",
    gap: 8,
    marginTop: 17,
  },
  analysisCard: {
    padding: 25,
    minHeight: 250,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F5",
  },
  analysisHeroCard: {
    padding: 16,
    backgroundColor: "#FFF7F9",
    borderRadius: 18,
  },
  analysisHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  analysisCrossWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  extractorPanel: {
    minHeight: 156,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(255,255,255,0.82)",
    marginTop: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  extractorDocument: {
    width: 118,
    height: 128,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.line2,
    padding: 12,
    overflow: "hidden",
  },
  extractorDocHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  extractorDocMark: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: C.blueSoft,
  },
  extractorDocTitleLines: {
    gap: 5,
  },
  extractorLine: {
    height: 7,
    borderRadius: 999,
    backgroundColor: C.primary,
  },
  extractorLineSoft: {
    height: 5,
    borderRadius: 999,
    backgroundColor: C.line2,
  },
  extractorTextRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 9,
  },
  extractorTextCell: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#E9EEF2",
  },
  extractorBeam: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 30,
    backgroundColor: "rgba(116,22,54,0.12)",
    borderBottomWidth: 2,
    borderBottomColor: C.primary3,
  },
  extractorPackets: {
    flex: 1,
    gap: 10,
  },
  packetRow: {
    minHeight: 34,
    borderRadius: 12,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  packetText: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: "900",
  },
  progressRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 8,
    borderColor: "rgba(116,22,54,0.12)",
    borderTopColor: C.primary2,
    borderRightColor: C.primary3,
    backgroundColor: "#FFF4F8",
    alignItems: "center",
    justifyContent: "center",
  },
  progressInner: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#FFF9FB",
    alignItems: "center",
    justifyContent: "center",
  },
  progressText: {
    fontSize: 28,
    fontWeight: "900",
    color: C.primary,
  },
  analysisTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: C.ink,
  },
  analysisBody: {
    fontSize: 14,
    lineHeight: 20,
    color: C.text,
    fontWeight: "600",
    marginTop: 4,
  },
  progressTrack: {
    width: "100%",
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(116,22,54,0.18)",
    marginTop: 18,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: C.primary,
  },
  analysisSteps: {
    marginTop: 16,
    gap: 10,
  },
  analysisStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  analysisStepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: C.line2,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  analysisStepDone: {
    borderColor: C.green,
    backgroundColor: C.green,
  },
  analysisStepActive: {
    borderColor: C.primary,
    backgroundColor: C.blush,
  },
  analysisStepText: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: "800",
  },
  analysisError: {
    color: C.red,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 14,
  },
  originalCard: {
    marginTop: 18,
    padding: 16,
    backgroundColor: C.cream,
  },
  originalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  originalTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: C.text,
  },
  originalTools: {
    flexDirection: "row",
    gap: 8,
  },
  originalPreview: {
    height: 296,
    borderRadius: 18,
    backgroundColor: "#F7EFEA",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  insightGrid: {
    flexDirection: "row",
    gap: 11,
    marginTop: 14,
  },
  miniInsight: {
    flex: 1,
    padding: 14,
  },
  miniLabel: {
    color: C.muted,
    fontSize: 12,
    marginTop: 10,
  },
  miniValue: {
    color: C.ink,
    fontSize: 17,
    fontWeight: "900",
  },
  ocrBanner: {
    padding: 15,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  ocrBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: C.text,
    fontWeight: "700",
  },
  documentViewer: {
    height: 390,
    backgroundColor: C.cream,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  viewerImagePreview: {
    width: 270,
    height: 350,
    borderRadius: 16,
  },
  viewerTools: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  viewerTool: {
    flex: 1,
    height: 45,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  docDetailHeader: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  detailTitle: {
    color: C.ink,
    fontSize: 21,
    fontWeight: "900",
  },
  detailSubtitle: {
    color: C.muted,
    fontSize: 12.5,
    marginTop: 2,
  },
  infoPanel: {
    marginTop: 14,
    padding: 16,
  },
  infoRow: {
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 14,
  },
  infoRowLabel: {
    color: C.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  infoRowValue: {
    flex: 1,
    color: C.ink,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
  },
  ocrTitle: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
  },
  insightPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  insightItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 8,
  },
  insightDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  insightItemText: {
    flex: 1,
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  verifiedFactItem: {
    paddingTop: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  verifiedFactText: {
    color: C.ink,
    fontSize: 13.2,
    lineHeight: 19,
    fontWeight: "900",
  },
  verifiedEvidence: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
    fontWeight: "700",
  },
  ocrText: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
  },
  structuredOcrText: {
    color: C.text,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
  },
  reportTextWrap: {
    gap: 12,
  },
  reportBlock: {
    gap: 5,
  },
  reportHeading: {
    color: C.ink,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: "900",
    marginTop: 2,
  },
  reportText: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  reportBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  reportBulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.primary,
    marginTop: 7,
  },
  reportTableScroll: {
    marginTop: 2,
  },
  reportTable: {
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 10,
    overflow: "hidden",
    minWidth: 290,
  },
  reportTableRow: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: C.line2,
  },
  reportTableHeaderRow: {
    backgroundColor: C.blueSoft,
    borderTopWidth: 0,
  },
  reportTableCell: {
    minWidth: 112,
    maxWidth: 168,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: C.line2,
    color: C.text,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: "700",
  },
  reportTableHeaderCell: {
    color: C.ink,
    fontWeight: "900",
  },
  twoCol: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  fullPreview: {
    flex: 1,
    backgroundColor: "rgba(26,14,21,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullPreviewImage: {
    width: "92%",
    height: "78%",
    borderRadius: 18,
  },
  fullClose: {
    position: "absolute",
    top: topInset + 54,
    right: 24,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  profileCard: {
    padding: 18,
    alignItems: "center",
  },
  profilePhoto: {
    width: 88,
    height: 88,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: {
    color: C.ink,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 13,
  },
  profilePhone: {
    color: C.muted,
    fontSize: 13,
    marginTop: 4,
  },
  editCard: {
    padding: 16,
    marginTop: 15,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  toggleIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleLabel: {
    flex: 1,
    color: C.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 999,
    padding: 3,
    justifyContent: "center",
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
  },
  sheetScrim: {
    flex: 1,
    backgroundColor: "rgba(48,38,42,0.38)",
    justifyContent: "flex-end",
  },
  uploadSheet: {
    marginHorizontal: 14,
    marginBottom: 18,
    borderRadius: 24,
    backgroundColor: "rgba(255,250,249,0.98)",
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    shadowColor: "#22121B",
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 24 },
    shadowRadius: 60,
    elevation: 8,
  },
  sheetGrabber: {
    width: 36,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#D9BFC8",
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: C.ink,
  },
  sheetSubtitle: {
    fontSize: 13,
    color: C.muted,
    lineHeight: 19,
    marginTop: 4,
  },
  sheetOptions: {
    gap: 12,
    marginTop: 22,
  },
  uploadOption: {
    minHeight: 82,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg2,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  uploadOptionIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadOptionTitle: {
    color: C.ink,
    fontSize: 14.5,
    fontWeight: "800",
  },
  uploadOptionSub: {
    color: C.muted,
    fontSize: 12.2,
    marginTop: 2,
  },
  bottomNav: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 16,
    height: 68,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: C.primary,
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 40,
    elevation: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    zIndex: 10,
  },
  navItem: {
    flex: 1,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  navLabel: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  navActivePill: {
    backgroundColor: C.blushStrong,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: -1,
  },
  navFab: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -28,
    shadowColor: C.primary,
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 30,
    elevation: 8,
  },
});
