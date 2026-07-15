import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  Modal,
  PanResponder,
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
import Pdf from "react-native-pdf";
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

const DEVICE_WIDTH = Dimensions.get("window").width;
const DEVICE_HEIGHT = Dimensions.get("window").height;

const C = {
  bg: "#F5F7FA",
  bg2: "#EEF2F6",
  surface: "#FFFFFF",
  surface2: "#F8FAFC",
  cream: "#F7F3EA",
  blush: "#F5E8ED",
  blushStrong: "#E981A2",
  primary: "#7A1738",
  primary2: "#9B3152",
  primary3: "#C05D7E",
  ink: "#17202A",
  text: "#374151",
  muted: "#71808F",
  line: "#E3E8EF",
  line2: "#D7DEE8",
  green: "#2F8F5B",
  greenSoft: "#EAF7F0",
  blue: "#2867B2",
  blueSoft: "#EAF2FF",
  teal: "#0E7C86",
  tealSoft: "#E6F5F6",
  amber: "#A65F16",
  amberSoft: "#FFF4E4",
  red: "#B4233C",
  redSoft: "#FDE8ED",
};

const MAX_ANALYSIS_IMAGE_COUNT = 0;
const MAX_ANALYSIS_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_ANALYSIS_IMAGE_CHARS = 12_000_000;
const EXTRACTED_TEXT_PREVIEW_LIMIT = 2600;
const PROCESSING_CONCURRENCY = 1;

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
  { id: "scans", label: "Scans", icon: ScanLine, tint: C.tealSoft, color: C.teal },
  { id: "certificates", label: "Certificates", icon: BadgeCheck, tint: C.greenSoft, color: C.green },
  { id: "vaccinations", label: "Vaccinations", icon: Syringe, tint: "#EEF0FF", color: "#5E55B9" },
  { id: "others", label: "Others", icon: FolderOpen, tint: "#EEF2F6", color: C.text },
];

const RECORD_CARD_GRADS = {
  prescriptions: ["#9B3152", "#5E102B"],
  reports: ["#2867B2", "#102C54"],
  scans: ["#0E7C86", "#0B4650"],
  certificates: ["#2F8F5B", "#174B32"],
  vaccinations: ["#5E55B9", "#2D2869"],
  others: ["#64748B", "#1F2937"],
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

function parseDateLike(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  const iso = cleaned.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  const dmy = cleaned.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const date = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return 0;
}

function visitSortDate(doc = {}) {
  return parseDateLike(doc.date) || Number(doc.sortDate) || 0;
}

function uploadSortDate(doc = {}) {
  return parseDateLike(doc.uploadedAt || doc.createdAt)
    || Number(doc.uploadSortDate)
    || Number(doc.sortDate)
    || 0;
}

function displayDateLabel(value, fallbackSortDate = 0) {
  const parsed = parseDateLike(value) || Number(fallbackSortDate) || 0;
  if (parsed) return formatDate(new Date(parsed));
  return String(value || "").trim() || "-";
}

function lastVisitForDocs(docs = []) {
  const sorted = [...docs].sort((a, b) => visitSortDate(b) - visitSortDate(a));
  const doc = sorted[0];
  if (!doc) return "-";
  return displayDateLabel(doc.date, visitSortDate(doc));
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

function isPdfMime(mimeType = "", name = "") {
  return mimeType === "application/pdf" || String(name || "").toLowerCase().endsWith(".pdf");
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

const HOSPITAL_FACILITY_RE = /\b(hospital|clinic|medical\s+(centre|center|college)?|health\s*care|healthcare|diagnostics?|labs?|laborator(?:y|ies)|pathology|imaging|radiology|nursing\s+home|dental|eye\s+care|care\s+(centre|center))\b/i;
const HOSPITAL_BAD_LABEL_RE = /^#|\b(laboratory\s+test\s+reports?|lab\s+reports?|test\s+reports?|medical\s+reports?|reports?|prescription|invoice|receipt|bill|patient|uhid|mrn|age|sex|gender|dob|sample|specimen|collection|collected|received|reported|printed|result|unit|range|reference|doctor|dr\.?|consultant|department)\b/i;
const ADDRESS_WORD_RE = /\b(road|rd\.?|street|st\.?|nagar|colony|layout|sector|phase|near|opp\.?|opposite|floor|building|complex|city|district|state|pin|pincode|phone|mobile|email|www)\b/i;

function cleanHospitalLabel(value = "") {
  const text = String(value || "")
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

function hospitalLabelScore(value = "") {
  const label = cleanHospitalLabel(value);
  if (!label || label.length < 3 || label.length > 90) return 0;
  if (HOSPITAL_BAD_LABEL_RE.test(label)) return 0;
  const words = label.split(/\s+/).filter(Boolean);
  const hasFacility = HOSPITAL_FACILITY_RE.test(label);
  if (!hasFacility && (words.length < 2 || ADDRESS_WORD_RE.test(label))) return 0;
  if (/^\d+[\d\s,./-]*$/.test(label)) return 0;

  let score = hasFacility ? 8 : 3;
  if (/^[A-Z0-9 .,&'()-]+$/.test(label) || /\b[A-Z][a-z]{2,}\b/.test(label)) score += 1;
  if (ADDRESS_WORD_RE.test(label)) score -= hasFacility ? 2 : 5;
  if ((label.match(/\d/g) || []).length > 6) score -= 2;
  if ((label.match(/,/g) || []).length > 1) score -= 1;
  if (words.length > 8) score -= 1;
  return Math.max(0, score);
}

function groupingQuality(value = "", mode = "hospital") {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (mode === "hospital") return hospitalLabelScore(text);
  if (/not found/i.test(text)) return 0;
  return normalizeGroupName(text) ? 5 : 0;
}

function isWeakGroupingValue(value = "", mode = "hospital") {
  if (!String(value || "").trim()) return true;
  return groupingQuality(value, mode) < (mode === "hospital" ? 5 : 2);
}

function bestGroupingCandidate(values = [], mode = "hospital") {
  return values
    .map((value) => ({ value: mode === "hospital" ? cleanHospitalLabel(value) : String(value || "").trim(), score: groupingQuality(value, mode) }))
    .filter((item) => item.value && item.score > 0)
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)[0]?.value || "";
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
  if (group.transient) return null;
  for (const existing of map.values()) {
    if (existing.type !== group.type) continue;
    if (existing.transient) continue;
    const sameBatch = Boolean(doc.batchId && existing.docs.some((item) => item.batchId === doc.batchId));
    if (sameBatch && (isWeakGroupingValue(existing.label, group.type) || isWeakGroupingValue(group.label, group.type))) return existing;
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

function pendingUploadTargetForMode(doc = {}, mode = "hospital") {
  const target = normalizeUploadTarget(doc.uploadTarget);
  if (!target || !["queued", "processing"].includes(doc.status)) return null;
  return target.type === mode ? target : null;
}

function recordGroupForDoc(doc = {}, mode = "hospital") {
  const pendingTarget = pendingUploadTargetForMode(doc, mode);
  if (pendingTarget) {
    const targetKey = normalizeGroupName(pendingTarget.label) || pendingTarget.label.toLowerCase();
    return {
      type: pendingTarget.type,
      label: "New uploads",
      key: `new-uploads:${pendingTarget.type}:${targetKey}`,
      helper: `Adding to ${pendingTarget.label}`,
      transient: true,
      targetLabel: pendingTarget.label,
    };
  }

  const hospital = cleanHospitalLabel(doc.hospital || "");
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
      type: "doctor",
      label: "Doctor not found",
      key: `doctor-missing:${normalizeGroupName(hospital || period) || "unsorted"}`,
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
      type: "patient",
      label: "Patient not found",
      key: `patient-missing:${normalizeGroupName(hospital || doctor || period) || "unsorted"}`,
      helper: "No patient name found",
    };
  }

  if (hospital && !isWeakGroupingValue(hospital, "hospital")) {
    return {
      type: "hospital",
      label: hospital,
      key: `hospital:${normalizeGroupName(hospital) || hospital.toLowerCase()}`,
      helper: doctor ? `${doctor} - ${period}` : period,
    };
  }

  if (doctor) {
    return {
      type: "hospital",
      label: "Hospital not found",
      key: `hospital-missing:${normalizeGroupName(doctor) || normalizeGroupName(period) || "unsorted"}`,
      helper: `${doctor} - ${period}`,
    };
  }

  return {
    type: "hospital",
    label: "Hospital not found",
    key: `hospital-missing:${normalizeGroupName(period) || "unsorted"}`,
    helper: "Hospital or doctor not found",
  };
}

function groupingValueForMode(doc = {}, mode = "hospital") {
  if (mode === "doctor") return String(doc.doctor || "").trim();
  if (mode === "patient") return String(doc.patientName || doc.patient || "").trim();
  return cleanHospitalLabel(doc.hospital || "");
}

function buildGroupingFallbacks(docs = [], mode = "hospital") {
  const byBatch = new Map();
  for (const doc of docs) {
    if (!doc.batchId) continue;
    const value = groupingValueForMode(doc, mode);
    if (!value) continue;
    const existing = byBatch.get(doc.batchId) || [];
    existing.push(value);
    byBatch.set(doc.batchId, existing);
  }
  for (const [batchId, values] of byBatch.entries()) {
    const best = bestGroupingCandidate(values, mode);
    if (best) byBatch.set(batchId, best);
    else byBatch.delete(batchId);
  }
  return { byBatch };
}

function applyGroupingFallback(doc, docs, mode, fallbacks) {
  if (pendingUploadTargetForMode(doc, mode)) return doc;

  const current = groupingValueForMode(doc, mode);
  if (current && !isWeakGroupingValue(current, mode)) {
    if (mode === "hospital" && current !== doc.hospital) return { ...doc, hospital: current };
    return doc;
  }
  const fromBatch = doc.batchId ? fallbacks.byBatch.get(doc.batchId) : "";
  let value = fromBatch;

  if (!value && (isReuploadStatus(doc.status) || isProcessingStatus(doc.status))) {
    const docTime = doc.sortDate || 0;
    const nearby = docs
      .map((item) => ({ item, value: groupingValueForMode(item, mode), distance: Math.abs((item.sortDate || 0) - docTime) }))
      .filter((item) => item.item.id !== doc.id && item.value && !isWeakGroupingValue(item.value, mode))
      .filter((item) => item.distance <= 10 * 60 * 1000)
      .sort((a, b) => a.distance - b.distance)[0]?.item;
    value = groupingValueForMode(nearby, mode);
  }

  if (!value) return doc;
  if (mode === "doctor") return { ...doc, doctor: value, helperFallback: "Grouped with same upload" };
  if (mode === "patient") return { ...doc, patientName: value, helperFallback: "Grouped with same upload" };
  return { ...doc, hospital: value, helperFallback: "Grouped with same upload" };
}

function normalizeUploadTarget(context = null) {
  if (!context || typeof context !== "object") return null;
  const type = ["hospital", "doctor", "patient"].includes(context.type) ? context.type : context.mode;
  if (!["hospital", "doctor", "patient"].includes(type)) return null;
  const label = type === "hospital" ? cleanHospitalLabel(context.label) : String(context.label || "").trim();
  if (!label || /not found/i.test(label)) return null;
  if (type === "hospital" && isWeakGroupingValue(label, "hospital")) return null;
  return {
    type,
    mode: context.mode || type,
    label,
    groupKey: context.groupKey || "",
  };
}

function metadataForUploadTarget(target) {
  if (!target) return {};
  if (target.type === "doctor") return { doctor: target.label };
  if (target.type === "patient") return { patientName: target.label };
  return { hospital: target.label };
}

function resolveAnalysisMetadata(doc = {}, analysis = {}) {
  const target = normalizeUploadTarget(doc.uploadTarget);
  const analyzedHospital = cleanHospitalLabel(analysis?.hospital || "");
  let hospital = analyzedHospital || doc.hospital || "";
  let doctor = analysis?.doctor || doc.doctor || "";
  let patientName = analysis?.patientName || doc.patientName || "";

  if (target?.type === "hospital") {
    const sameHospital = analyzedHospital && shouldMergeGroupNames(target.label, analyzedHospital, true);
    if (!analyzedHospital || isWeakGroupingValue(analyzedHospital, "hospital") || sameHospital) {
      hospital = target.label;
    }
  }
  if (target?.type === "doctor" && (!doctor || shouldMergeGroupNames(target.label, doctor, true))) doctor = target.label;
  if (target?.type === "patient" && (!patientName || normalizeGroupName(patientName) === normalizeGroupName(target.label))) patientName = target.label;

  return { hospital, doctor, patientName };
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

function createDraftDocument(method, localFiles, batchIndex = 0, batchId = "", uploadTargetContext = null) {
  const primary = localFiles[0];
  const now = new Date();
  const id = `doc-${now.getTime()}-${batchIndex}-${Math.random().toString(36).slice(2, 8)}`;
  const uploadTarget = normalizeUploadTarget(uploadTargetContext);

  return withRecordGroup({
    id,
    title: titleFromFileName(primary?.name || "Medical Document"),
    category: "others",
    date: formatDate(now),
    sortDate: now.getTime(),
    uploadedAt: now.toISOString(),
    uploadSortDate: now.getTime(),
    batchIndex,
    doctor: "",
    hospital: "",
    patientName: "",
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
    uploadTarget,
    originalSaved: true,
  });
}

async function requestOcr(localFile, documentId, token, batchId, batchIndex = 0) {
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
      batchIndex: String(batchIndex || 0),
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
      batchIndex: doc.batchIndex || 0,
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
  const metadata = resolveAnalysisMetadata(doc, analysis);

  if (!analysis || isReuploadStatus(analysis.status)) {
    return withRecordGroup({
      ...doc,
      title: analysis?.title || doc.title,
      category,
      hospital: metadata.hospital,
      doctor: metadata.doctor,
      patientName: metadata.patientName,
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
    hospital: metadata.hospital,
    doctor: metadata.doctor,
    patientName: metadata.patientName,
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

function quickIndexPatchFromOcrResponse(ocr = {}) {
  const quick = ocr.quickIndex && typeof ocr.quickIndex === "object" ? ocr.quickIndex : {};
  const patch = {};
  if (quick.title) patch.title = quick.title;
  if (isKnownCategory(quick.category)) patch.category = quick.category;
  if (quick.hospital) patch.hospital = quick.hospital;
  if (quick.doctor) patch.doctor = quick.doctor;
  if (quick.patientName) patch.patientName = quick.patientName;
  if (quick.visitDate) patch.date = quick.visitDate;
  if (Array.isArray(quick.tags)) patch.tags = quick.tags.filter(Boolean).slice(0, 8);
  if (quick.summary) patch.summary = quick.summary;
  if (quick.clinicalSummary) patch.clinicalSummary = quick.clinicalSummary;
  if (quick.structuredOcr || ocr.structuredOcr) patch.structuredOcr = quick.structuredOcr || ocr.structuredOcr;
  if (Array.isArray(quick.verifiedFacts)) patch.verifiedFacts = quick.verifiedFacts;
  if (Array.isArray(quick.rejectedFacts)) patch.rejectedFacts = quick.rejectedFacts;
  if (typeof quick.confidence === "number") patch.confidence = quick.confidence;
  if (Array.isArray(quick.warnings)) patch.warnings = quick.warnings;
  return patch;
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

    const ocr = await requestOcr(files[i], doc.id, app.authToken, doc.batchId, doc.batchIndex);
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
      quickIndexSource: ocr,
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
  const quickIndexPatch = fileTexts.length === 1 ? quickIndexPatchFromOcrResponse(fileTexts[0].quickIndexSource) : {};

  app.updateDocPatch(doc.id, {
    ...quickIndexPatch,
    ocr: combinedText,
    pageLevelText: pageTexts,
    ocrConfidence,
    ocrProvider,
    originalStorage,
    status: "ocr_complete",
    summary: quickIndexPatch.summary || "OCR complete. AI summary and grouping are running in the background.",
  });

  if (!isActive()) return null;
  setStage("Writing summary and grouping record");
  setProgress(82);

  const analysisInput = { ...doc, ocr: combinedText, pageLevelText: pageTexts, ocrConfidence, ocrProvider, originalStorage };
  const analysis = await requestDocumentAnalysis(analysisInput, combinedText, pageTexts, files, app.authToken);
  const updated = applyAnalysisToDoc(analysisInput, analysis, combinedText);
  app.updateDoc(updated);
  const target = normalizeUploadTarget(updated.uploadTarget);
  if (target && app.authToken) {
    const targetPatch = metadataForUploadTarget(target);
    await requestUpdateDocument(app.authToken, updated.documentId || updated.id, {
      ...targetPatch,
      ...(updated.hospital ? { hospital: updated.hospital } : {}),
      ...(updated.doctor ? { doctor: updated.doctor } : {}),
      ...(updated.patientName ? { patientName: updated.patientName } : {}),
    }).catch(() => undefined);
  }
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

function processingFailurePatch(error, doc = {}) {
  const message = processingErrorMessage(error);
  const targetMetadata = metadataForUploadTarget(normalizeUploadTarget(doc.uploadTarget));
  return {
    ...targetMetadata,
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
  const uploadedAt = doc.uploadedAt || doc.createdAt || localDoc.uploadedAt || localDoc.createdAt || "";
  const uploadTime = parseDateLike(uploadedAt) || Number(localDoc.uploadSortDate) || Number(localDoc.sortDate) || Date.now();
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
    uploadedAt,
    uploadSortDate: uploadTime,
    batchIndex: Number.isFinite(Number(doc.batchIndex)) ? Number(doc.batchIndex) : Number(localDoc.batchIndex) || 0,
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
        <LinearGradient colors={disabled ? ["#E5E7EB", "#E5E7EB"] : [C.primary, C.primary2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
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

function PdfPreview({ uri, headers, full = false, compact = false }) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => uri ? { uri, headers, cache: true } : null, [uri, headers]);
  const pdfStyle = full ? styles.pdfFullPreview : compact ? styles.pdfCompactPreview : styles.pdfNativePreview;

  useEffect(() => {
    setPage(1);
    setPages(0);
    setFailed(false);
  }, [uri]);

  if (!source || failed) {
    return (
      <View style={[styles.pdfRenderFallback, full && styles.pdfRenderFallbackFull]}>
        <FileText size={full ? 52 : 38} color={C.primary} />
        <Text style={styles.pdfFallbackTitle}>PDF preview unavailable</Text>
        <Text style={styles.pdfFallbackText}>The original PDF is saved. Try opening it full screen or reupload if the file is corrupted.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.pdfPreviewShell, full && styles.pdfPreviewShellFull]}>
      <Pdf
        source={source}
        style={pdfStyle}
        trustAllCerts={false}
        enableAnnotationRendering
        enableDoubleTapZoom={full}
        enablePaging={full}
        scrollEnabled={full}
        singlePage={!full}
        spacing={full ? 8 : 0}
        fitPolicy={0}
        onLoadComplete={(numberOfPages) => {
          setPages(numberOfPages);
          setFailed(false);
        }}
        onPageChanged={(nextPage) => setPage(nextPage)}
        onError={() => setFailed(true)}
        renderActivityIndicator={() => <ActivityIndicator size="small" color={C.primary} />}
      />
      {!!pages && (
        <View style={styles.pdfPageBadge}>
          <Text style={styles.pdfPageBadgeText}>{page} / {pages}</Text>
        </View>
      )}
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
        <LinearGradient colors={[C.primary, "#481224"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.welcomeCard}>
          <ShieldCheck size={24} color="#fff" />
          <Text style={styles.welcomeTitle}>Your medical vault is ready.</Text>
          <Text style={styles.welcomeBody}>Create a secure vault or login with your existing mobile number.</Text>
        </LinearGradient>
        <View style={styles.welcomeProofGrid}>
          <View style={styles.welcomeProofItem}>
            <Lock size={17} color={C.primary} />
            <Text style={styles.welcomeProofText}>OTP secured</Text>
          </View>
          <View style={styles.welcomeProofItem}>
            <FolderOpen size={17} color={C.blue} />
            <Text style={styles.welcomeProofText}>Originals saved</Text>
          </View>
          <View style={styles.welcomeProofItem}>
            <Building2 size={17} color={C.teal} />
            <Text style={styles.welcomeProofText}>Hospital files</Text>
          </View>
        </View>
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
  const processingCount = app.docs.filter((doc) => isProcessingStatus(doc.status)).length;
  const latestDoc = app.docs[0];
  const firstName = app.user.name?.trim()?.split(" ")[0] || "there";
  return (
    <Screen bottomPad={122}>
      <Header nav={nav} app={app} />
      <View style={styles.pageBody}>
        <VaultDrawerHero firstName={firstName} onUpload={() => app.openUploadSheet?.()} />

        <View style={styles.infoGrid}>
          <Card style={styles.infoCard}>
            <Stethoscope size={20} color={C.primary} />
            <Text style={styles.infoLabel}>Last doctor visit</Text>
            <Text style={styles.infoValue} numberOfLines={1}>{app.user.lastDoctorVisit.date}</Text>
          </Card>
          <Card style={styles.infoCard}>
            <Clock size={20} color={processingCount ? C.blue : C.green} />
            <Text style={styles.infoLabel}>{processingCount ? "Processing now" : "Latest upload"}</Text>
            <Text style={styles.infoValue} numberOfLines={1}>{processingCount || displayDateLabel(latestDoc?.date, latestDoc?.sortDate)}</Text>
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
          {app.docs.length ? (
            app.docs.slice(0, 3).map((doc) => <DocumentRow key={doc.id} doc={doc} onPress={() => openDocument(nav, doc)} />)
          ) : (
            <EmptyState icon={Files} title="No documents yet" subtitle="Upload your first medical document to start building the vault." />
          )}
        </View>
      </View>
    </Screen>
  );
}

function VaultDrawerHero({ firstName, onUpload }) {
  const drawerLift = useRef(new Animated.Value(0)).current;
  const sealPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const liftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drawerLift, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(drawerLift, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sealPulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(sealPulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    liftLoop.start();
    pulseLoop.start();
    return () => {
      liftLoop.stop();
      pulseLoop.stop();
    };
  }, [drawerLift, sealPulse]);

  const translateY = drawerLift.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const sealScale = sealPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });

  return (
    <LinearGradient colors={["#FFFFFF", "#F8EEF2", "#EAF5F6"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.homeHeroCard}>
      <View style={styles.heroSecurePill}>
        <Lock size={13} color={C.green} />
        <Text style={styles.heroSecureText}>Secure vault active</Text>
      </View>

      <View style={styles.vaultHeroVisual}>
        <View style={styles.vaultDrawerBack} />
        <Animated.View style={[styles.vaultFileStack, { transform: [{ translateY }] }]}>
          <View style={[styles.vaultFilePaper, styles.vaultFilePaperBack]} />
          <View style={[styles.vaultFilePaper, styles.vaultFilePaperMid]} />
          <View style={styles.vaultFileFront}>
            <View style={styles.vaultFileTab} />
            <View style={styles.vaultFileHeader}>
              <View style={styles.vaultFileMark}>
                <MedicalCross size={16} color={C.primary} />
              </View>
              <View style={styles.vaultFileLines}>
                <View style={[styles.vaultLineStrong, { width: 86 }]} />
                <View style={[styles.vaultLineSoft, { width: 54 }]} />
              </View>
            </View>
            <View style={styles.vaultFileRows}>
              <View style={[styles.vaultLineSoft, { width: "86%" }]} />
              <View style={[styles.vaultLineSoft, { width: "64%" }]} />
              <View style={styles.vaultMiniGrid}>
                <View style={styles.vaultMiniCell} />
                <View style={styles.vaultMiniCell} />
                <View style={styles.vaultMiniCell} />
              </View>
            </View>
          </View>
        </Animated.View>
        <View style={styles.vaultDrawerBase}>
          <View style={styles.vaultDrawerHandle} />
        </View>
        <Animated.View style={[styles.vaultSeal, { transform: [{ scale: sealScale }] }]}>
          <ShieldCheck size={22} color="#fff" />
        </Animated.View>
      </View>

      <Text style={styles.homeHeroGreeting}>Good morning, {firstName}</Text>
      <Text style={styles.homeHeroTitle}>Your medical records, neatly filed.</Text>
      <Text style={styles.homeHeroText}>Private, organized, ready for your next visit.</Text>
      <TouchableOpacity activeOpacity={0.84} onPress={onUpload} style={styles.homeHeroAction}>
        <Plus size={18} color="#fff" />
        <Text style={styles.homeHeroActionText}>Add document</Text>
      </TouchableOpacity>
    </LinearGradient>
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

  return (
    <Screen bottomPad={122}>
      <Header nav={nav} app={app} title="Records" />
      <View style={styles.pageBody}>
        <View style={styles.simplePageHeader}>
          <Text style={styles.simplePageTitle}>Records drawer</Text>
          <Text style={styles.simplePageSubtitle}>Files are grouped for fast retrieval during visits. Open a file to view every original image or PDF first.</Text>
        </View>

        <View style={styles.recordsModeTabs}>
          <DrawerModeButton label="Hospital" icon={Building2} active={viewMode === "hospital"} onPress={() => setViewMode("hospital")} />
          <DrawerModeButton label="Doctor" icon={Stethoscope} active={viewMode === "doctor"} onPress={() => setViewMode("doctor")} />
          <DrawerModeButton label="Patient" icon={UserRound} active={viewMode === "patient"} onPress={() => setViewMode("patient")} />
        </View>

        <View style={styles.drawerSummaryBar}>
          <View style={styles.drawerSummaryIcon}>
            <FolderOpen size={18} color={C.primary} />
          </View>
          <View style={styles.flexFill}>
            <Text style={styles.drawerSummaryTitle}>{groups.length} {viewMode} file{groups.length === 1 ? "" : "s"}</Text>
            <Text style={styles.drawerSummaryText}>{app.docs.length} original document{app.docs.length === 1 ? "" : "s"} saved</Text>
          </View>
          <TouchableOpacity activeOpacity={0.78} onPress={() => app.startUpload?.("gallery")} style={styles.drawerSummaryAdd}>
            <Plus size={18} color="#fff" />
          </TouchableOpacity>
        </View>

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
    const dateValue = visitSortDate(doc);
    existing.docs.push(doc);
    existing.latestSortDate = Math.max(existing.latestSortDate, dateValue || 0);
    existing.oldestSortDate = Math.min(existing.oldestSortDate, dateValue || 0);
    existing.categories.add(categoryFor(doc.category).label);
    existing.pageCount += Number(doc.pages || 1);
    map.set(group.key, existing);
  }

  const groups = [...map.values()].map((group) => ({
    ...group,
    docs: group.docs.sort((a, b) => visitSortDate(b) - visitSortDate(a)),
    categoryLabels: [...group.categories].slice(0, 3),
  }));

  return groups.sort((a, b) => {
    if (sort === "alpha") return a.label.localeCompare(b.label);
    if (sort === "oldest") return (a.latestSortDate || 0) - (b.latestSortDate || 0);
    return (b.latestSortDate || 0) - (a.latestSortDate || 0);
  });
}

function dateRangeForDocs(docs = []) {
  const cleanDates = docs
    .map((doc) => ({ label: doc.date || "", sortDate: visitSortDate(doc) }))
    .filter((item) => item.label || item.sortDate)
    .sort((a, b) => (a.sortDate || 0) - (b.sortDate || 0));
  if (!cleanDates.length) return "No date";
  const first = displayDateLabel(cleanDates[0]?.label, cleanDates[0]?.sortDate);
  const last = displayDateLabel(cleanDates[cleanDates.length - 1]?.label, cleanDates[cleanDates.length - 1]?.sortDate);
  return first === last ? first : `${first} - ${last}`;
}

function statusForDocs(docs = []) {
  if (docs.some((doc) => isReuploadStatus(doc.status))) return "needs_reupload";
  if (docs.some((doc) => isProcessingStatus(doc.status))) return "processing";
  return "ready";
}

function RecordGroupCard({ group, nav, mode }) {
  const typeIcon = {
    hospital: Building2,
    doctor: Stethoscope,
    patient: UserRound,
    period: CalendarClock,
  };
  const Icon = typeIcon[group.type] || FolderOpen;
  const isTemporary = Boolean(group.transient);
  const processing = group.docs.filter((doc) => isProcessingStatus(doc.status)).length;
  const reuploadCount = group.docs.filter((doc) => isReuploadStatus(doc.status)).length;
  const openGroup = () => nav.push("recordGroup", { groupKey: group.key, mode });
  const groupStatus = isTemporary ? "processing" : reuploadCount ? "needs_reupload" : processing ? "processing" : "ready";
  const lastVisit = lastVisitForDocs(group.docs);

  return (
    <TouchableOpacity activeOpacity={0.86} onPress={openGroup} style={[styles.recordGroupCard, isTemporary && styles.recordGroupCardTemporary]}>
      <View style={styles.fileFolderShadow} />
      <View style={[styles.folderTab, isTemporary && styles.folderTabTemporary]}>
        <Icon size={14} color={C.primary} />
        <Text style={styles.folderTabText}>{isTemporary ? "New" : groupLabelForMode(group.type)}</Text>
      </View>
      <View style={styles.recordGroupHeader}>
        <View style={[styles.recordGroupIcon, isTemporary && styles.recordGroupIconTemporary]}>
          <Icon size={21} color={C.primary} />
        </View>
        <View style={styles.flexFill}>
          <Text style={styles.recordGroupTitle} numberOfLines={1}>{group.label}</Text>
          <Text style={styles.recordGroupSub} numberOfLines={1}>
            {isTemporary ? group.helper : `Last visit: ${lastVisit}`}
          </Text>
        </View>
        {groupStatus === "ready" ? <ChevronRight size={19} color={C.primary} /> : <StatusPill status={groupStatus} />}
      </View>
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
        <View style={styles.recordGroupMetric}>
          <CalendarClock size={14} color={C.primary} />
          <Text style={styles.recordGroupMeta}>{isTemporary ? "Processing now" : `Last visit ${lastVisit}`}</Text>
        </View>
      </View>
      <View style={styles.recordGroupOpenRow}>
        <Text style={styles.recordGroupOpenText}>{isTemporary ? "View upload progress" : `Open ${groupLabelForMode(group.type).toLowerCase()} file`}</Text>
        <ChevronRight size={16} color={C.primary} />
      </View>
    </TouchableOpacity>
  );
}

function remoteOriginalUrl(documentId, index) {
  return `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId || "")}/originals/${index}`;
}

function sourceForOriginalFile(file = {}) {
  const safeFile = file || {};
  return safeFile.headers
    ? { uri: safeFile.uri, headers: safeFile.headers }
    : { uri: safeFile.uri };
}

function originalFilesForDoc(doc = {}, token = "") {
  if (doc.localFiles?.length) return doc.localFiles;
  if (doc.localUri) return [{ uri: doc.localUri, name: doc.fileName, mimeType: doc.mimeType }];

  const remoteOriginals = Array.isArray(doc.originalFiles) && doc.originalFiles.length
    ? doc.originalFiles
    : doc.originalStorage
      ? [doc.originalStorage]
      : [];
  if (!remoteOriginals.length || !(doc.documentId || doc.id)) return [];
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  return remoteOriginals.map((file, index) => ({
    uri: remoteOriginalUrl(doc.documentId || doc.id, index),
    name: file?.fileName || doc.fileName || `original-${index + 1}`,
    mimeType: file?.mimeType || doc.mimeType || "application/octet-stream",
    size: file?.size,
    headers,
    remote: true,
  }));
}

function primaryOriginalForDoc(doc = {}, token = "") {
  return originalFilesForDoc(doc, token)[0] || null;
}

function originalPagesForDocs(docs = [], token = "") {
  return docs.flatMap((doc) => {
    const files = originalFilesForDoc(doc, token);
    return files.map((file, index) => ({ doc, file, index }));
  });
}

function originalSortDate(item = {}) {
  return uploadSortDate(item.doc) || Number(item.doc?.sortDate) || 0;
}

function compareOriginalUploadOrder(a = {}, b = {}) {
  const dateDiff = originalSortDate(b) - originalSortDate(a);
  if (dateDiff) return dateDiff;
  const batchDiff = (Number(a.doc?.batchIndex) || 0) - (Number(b.doc?.batchIndex) || 0);
  if (batchDiff) return batchDiff;
  const fileDiff = (Number(a.index) || 0) - (Number(b.index) || 0);
  if (fileDiff) return fileDiff;
  return String(a.doc?.id || "").localeCompare(String(b.doc?.id || ""));
}

function originalDateLabel(item = {}) {
  return displayDateLabel(item.doc?.uploadedAt || item.doc?.createdAt, originalSortDate(item));
}

function originalMonthLabel(item = {}) {
  const time = originalSortDate(item);
  if (!time) return originalDateLabel(item);
  return new Date(time).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function truncateTextAtBoundary(text = "", limit = EXTRACTED_TEXT_PREVIEW_LIMIT) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  const paragraph = value.lastIndexOf("\n\n", limit);
  const line = value.lastIndexOf("\n", limit);
  const cut = paragraph > limit * 0.45 ? paragraph : line > limit * 0.55 ? line : limit;
  return value.slice(0, cut).trim();
}

function compactCategoryList(values = []) {
  const clean = uniqueCleanValues(values);
  if (!clean.length) return "";
  if (clean.length <= 3) return clean.join(", ");
  return `${clean.slice(0, 3).join(", ")} +${clean.length - 3}`;
}

function monthKeyForDoc(doc = {}) {
  const time = visitSortDate(doc);
  if (!time) return "No date";
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(key = "") {
  if (key === "No date") return "No date found";
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function buildRecordOverviewText(group, intelligence, lastVisit, dateRange) {
  const docs = intelligence.docs || [];
  if (!docs.length) return "";
  const pageCount = docs.reduce((sum, doc) => sum + Number(doc.pages || 1), 0);
  const fileKind = groupLabelForMode(group?.type).toLowerCase();
  const sourceLines = [
    intelligence.hospitals.length ? `Hospital: ${compactList(intelligence.hospitals)}` : "",
    intelligence.doctors.length ? `Doctor: ${compactList(intelligence.doctors)}` : "",
    intelligence.patients.length ? `Patient: ${compactList(intelligence.patients)}` : "",
    intelligence.categories.length ? `Document types: ${compactList(intelligence.categories)}` : "",
  ].filter(Boolean);

  const monthly = new Map();
  docs.forEach((doc) => {
    const key = monthKeyForDoc(doc);
    const existing = monthly.get(key) || { sort: visitSortDate(doc) || 0, count: 0, pages: 0, categories: [] };
    existing.sort = Math.max(existing.sort, visitSortDate(doc) || 0);
    existing.count += 1;
    existing.pages += Number(doc.pages || 1);
    existing.categories.push(categoryFor(doc.category).label);
    monthly.set(key, existing);
  });
  const monthLines = [...monthly.entries()]
    .sort((a, b) => (b[1].sort || 0) - (a[1].sort || 0))
    .map(([key, value]) => `- ${monthLabelFromKey(key)}: ${value.count} document${value.count === 1 ? "" : "s"}, ${value.pages} page${value.pages === 1 ? "" : "s"}${value.categories.length ? `, ${compactCategoryList(value.categories)}` : ""}`);

  const noteLines = docs
    .map((doc) => {
      const summary = usefulSummaryForDoc(doc);
      if (!summary) return "";
      return `- ${displayDateLabel(doc.date, visitSortDate(doc))}: ${summary.replace(/\n+/g, " ")}`;
    })
    .filter(Boolean)
    .slice(0, 12);

  return cleanReadableText([
    "## Overview",
    `This ${fileKind} record contains ${docs.length} document${docs.length === 1 ? "" : "s"} and ${pageCount} page${pageCount === 1 ? "" : "s"} across ${dateRange}. Latest visit: ${lastVisit}.`,
    sourceLines.length ? sourceLines.map((line) => `- ${line}`).join("\n") : "",
    monthLines.length ? ["## Timeline", monthLines.join("\n")].join("\n\n") : "",
    noteLines.length ? ["## Document notes", noteLines.join("\n")].join("\n\n") : "",
  ].filter(Boolean).join("\n\n"));
}

function OriginalPreviewPage({ item, width, zoom = 1, rotation = 0, full = false }) {
  const isImage = item?.file?.mimeType?.startsWith("image/");
  const isPdf = isPdfMime(item?.file?.mimeType, item?.file?.name);
  const pageStyle = full
    ? [styles.galleryModalPage, { width }]
    : [styles.groupPreviewPage, { width }];
  const imageStyle = full ? styles.galleryModalImage : styles.groupPreviewImage;

  return (
    <View style={pageStyle}>
      {isPdf ? (
        <PdfPreview uri={item.file.uri} headers={item.file.headers} full={full} />
      ) : (
      <Animated.View style={{ transform: [{ scale: zoom }, { rotate: `${rotation}deg` }] }}>
        {isImage ? (
          <Image source={sourceForOriginalFile(item.file)} style={imageStyle} resizeMode="contain" />
        ) : (
          <View style={full ? styles.galleryPdfPreview : styles.groupPdfPreview}>
            <FileText size={full ? 50 : 36} color={C.primary} />
            <Text style={full ? styles.galleryPdfTitle : styles.groupPdfTitle}>Original file</Text>
          </View>
        )}
      </Animated.View>
      )}
    </View>
  );
}

function TimelineScrubber({ items, selectedIndex, onChange }) {
  const [railWidth, setRailWidth] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [displayIndex, setDisplayIndex] = useState(selectedIndex);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const railTouchRef = useRef(null);
  const railPageXRef = useRef(0);
  const activeIndexRef = useRef(selectedIndex);
  const displayIndexRef = useRef(selectedIndex);
  const activeIndex = isDragging ? displayIndex : selectedIndex;
  const selected = items[Math.min(activeIndex, Math.max(0, items.length - 1))];
  const start = items[0];
  const end = items[items.length - 1];
  const selectedProgress = items.length > 1 ? selectedIndex / (items.length - 1) : 0;
  const fillWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(1, railWidth)] });
  const thumbTranslate = progressAnim.interpolate({ inputRange: [0, 1], outputRange: [-17, Math.max(1, railWidth) - 17] });

  const measureRail = useCallback(() => {
    railTouchRef.current?.measureInWindow?.((x, _y, width) => {
      railPageXRef.current = x || 0;
      if (width) setRailWidth(Math.max(1, width));
    });
  }, []);

  useEffect(() => {
    if (isDragging) return;
    activeIndexRef.current = selectedIndex;
    displayIndexRef.current = selectedIndex;
    setDisplayIndex(selectedIndex);
    progressAnim.setValue(selectedProgress);
  }, [isDragging, progressAnim, selectedIndex, selectedProgress]);

  useEffect(() => {
    const frame = requestAnimationFrame(measureRail);
    return () => cancelAnimationFrame(frame);
  }, [measureRail, railWidth]);

  const updateFromPosition = useCallback((pageX = 0, fallbackLocalX = 0) => {
    if (!items.length) return;
    const width = Math.max(1, railWidth);
    const localX = railPageXRef.current ? pageX - railPageXRef.current : fallbackLocalX;
    const nextProgress = Math.max(0, Math.min(1, localX / width));
    const nextIndex = items.length > 1 ? Math.round(nextProgress * (items.length - 1)) : 0;
    activeIndexRef.current = nextIndex;
    progressAnim.setValue(nextProgress);
    if (displayIndexRef.current !== nextIndex) {
      displayIndexRef.current = nextIndex;
      setDisplayIndex(nextIndex);
    }
  }, [items.length, progressAnim, railWidth]);

  const commitDrag = useCallback(() => {
    const nextIndex = Math.max(0, Math.min(items.length - 1, activeIndexRef.current || 0));
    const nextProgress = items.length > 1 ? nextIndex / (items.length - 1) : 0;
    setIsDragging(false);
    displayIndexRef.current = nextIndex;
    setDisplayIndex(nextIndex);
    Animated.spring(progressAnim, {
      toValue: nextProgress,
      speed: 18,
      bounciness: 3,
      useNativeDriver: false,
    }).start();
    if (nextIndex !== selectedIndex) onChange?.(nextIndex, { animated: false, source: "timeline" });
  }, [items.length, onChange, progressAnim, selectedIndex]);

  const stepTimeline = useCallback((direction) => {
    const nextIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + direction));
    activeIndexRef.current = nextIndex;
    displayIndexRef.current = nextIndex;
    setDisplayIndex(nextIndex);
    Animated.spring(progressAnim, {
      toValue: items.length > 1 ? nextIndex / (items.length - 1) : 0,
      speed: 18,
      bounciness: 2,
      useNativeDriver: false,
    }).start();
    if (nextIndex !== selectedIndex) onChange?.(nextIndex, { animated: true, source: "timeline-step" });
  }, [items.length, onChange, progressAnim, selectedIndex]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => items.length > 0,
    onMoveShouldSetPanResponder: () => items.length > 1,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      measureRail();
      setIsDragging(true);
      updateFromPosition(event.nativeEvent.pageX || 0, event.nativeEvent.locationX || 0);
    },
    onPanResponderMove: (event, gestureState) => {
      updateFromPosition(gestureState.moveX || event.nativeEvent.pageX || 0, event.nativeEvent.locationX || 0);
    },
    onPanResponderRelease: commitDrag,
    onPanResponderTerminate: commitDrag,
  }), [commitDrag, items.length, measureRail, updateFromPosition]);

  if (!items.length) return null;

  return (
    <View style={styles.timelinePanel}>
      <View style={styles.timelineHeader}>
        <View style={styles.flexFill}>
          <Text style={styles.timelineLabel}>Upload timeline</Text>
          <Text style={styles.timelineDate} numberOfLines={1}>Uploaded {originalDateLabel(selected)}</Text>
        </View>
        <View style={styles.timelineCountPill}>
          <Text style={styles.timelinePosition}>{activeIndex + 1} / {items.length}</Text>
        </View>
      </View>
      <View style={styles.timelineControlRow}>
        <TouchableOpacity
          activeOpacity={0.78}
          disabled={selectedIndex <= 0}
          onPress={() => stepTimeline(-1)}
          style={[styles.timelineStepButton, selectedIndex <= 0 && styles.timelineStepDisabled]}
        >
          <ChevronLeft size={18} color={selectedIndex <= 0 ? C.line2 : C.primary} />
        </TouchableOpacity>
        <View
          ref={railTouchRef}
          style={styles.timelineRailTouch}
          onLayout={(event) => {
            setRailWidth(Math.max(1, event.nativeEvent.layout.width));
            requestAnimationFrame(measureRail);
          }}
          {...panResponder.panHandlers}
        >
          <View style={styles.timelineRailOuter}>
            <View style={styles.timelineRail} />
            <Animated.View style={[styles.timelineRailFill, { width: fillWidth }]} />
            <Animated.View style={[styles.timelineThumb, isDragging && styles.timelineThumbActive, { transform: [{ translateX: thumbTranslate }] }]}>
              <View style={styles.timelineThumbDot} />
            </Animated.View>
          </View>
        </View>
        <TouchableOpacity
          activeOpacity={0.78}
          disabled={selectedIndex >= items.length - 1}
          onPress={() => stepTimeline(1)}
          style={[styles.timelineStepButton, selectedIndex >= items.length - 1 && styles.timelineStepDisabled]}
        >
          <ChevronRight size={18} color={selectedIndex >= items.length - 1 ? C.line2 : C.primary} />
        </TouchableOpacity>
      </View>
      <View style={styles.timelineFooter}>
        <Text style={styles.timelineRangeText} numberOfLines={1}>{originalMonthLabel(start)}</Text>
        <Text style={styles.timelineCurrentText} numberOfLines={1}>{originalMonthLabel(selected)}</Text>
        <Text style={styles.timelineRangeText} numberOfLines={1}>{originalMonthLabel(end)}</Text>
      </View>
    </View>
  );
}

function uniqueCleanValues(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeGroupName(value) || value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function compactList(values = [], empty = "-") {
  const clean = uniqueCleanValues(values);
  if (!clean.length) return empty;
  if (clean.length <= 2) return clean.join(", ");
  return `${clean.slice(0, 2).join(", ")} +${clean.length - 2}`;
}

function isGenericSummary(value = "") {
  return /^(original file saved|ocr complete|replacement saved|retrying ocr|document indexed from ocr text)/i.test(String(value || "").trim());
}

function usefulSummaryForDoc(doc = {}) {
  const text = cleanReadableText(doc.clinicalSummary || doc.summary || "");
  if (!text || isGenericSummary(text)) return "";
  return text;
}

function docHasExtractedText(doc = {}) {
  return Boolean(structuredTextForDoc(doc));
}

function recordGroupIntelligence(group) {
  const docs = [...(group?.docs || [])].sort((a, b) => visitSortDate(b) - visitSortDate(a));
  const docsByUpload = [...(group?.docs || [])].sort((a, b) => {
    const uploadDiff = uploadSortDate(b) - uploadSortDate(a);
    if (uploadDiff) return uploadDiff;
    return (Number(a.batchIndex) || 0) - (Number(b.batchIndex) || 0);
  });
  const processedDocs = docs.filter((doc) => docHasExtractedText(doc) || doc.status === "ready");
  const readyDocs = docs.filter((doc) => doc.status === "ready");
  const reuploadDocs = docs.filter((doc) => isReuploadStatus(doc.status));
  const processingDocs = docs.filter((doc) => isProcessingStatus(doc.status));
  const confidenceValues = docs.map((doc) => doc.ocrConfidence).filter((value) => typeof value === "number");
  const avgConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : undefined;
  const summaryItems = docs.map(usefulSummaryForDoc).filter(Boolean);
  const summaryText = cleanReadableText(summaryItems.map((text) => `- ${text.replace(/\n+/g, " ")}`).join("\n"));
  const extractedText = cleanReadableText(docsByUpload
    .map((doc, index) => {
      const text = structuredTextForDoc(doc);
      if (!text) return "";
      const uploaded = displayDateLabel(doc.uploadedAt || doc.createdAt, uploadSortDate(doc));
      const visit = displayDateLabel(doc.date, visitSortDate(doc));
      const category = categoryFor(doc.category).label;
      const label = [
        uploaded && uploaded !== "-" ? `Uploaded ${uploaded}` : `Document ${index + 1}`,
        visit && visit !== "-" && visit !== uploaded ? `Visit ${visit}` : "",
        category,
      ]
        .filter(Boolean)
        .join(" | ");
      return `## ${label}\n\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n"));

  return {
    docs,
    processedDocs,
    readyDocs,
    reuploadDocs,
    processingDocs,
    avgConfidence,
    summaryText,
    extractedText,
    hospitals: uniqueCleanValues(docs.map((doc) => doc.hospital)),
    doctors: uniqueCleanValues(docs.map((doc) => doc.doctor)),
    patients: uniqueCleanValues(docs.map((doc) => doc.patientName || doc.patient)),
    categories: uniqueCleanValues(docs.map((doc) => categoryFor(doc.category).label)),
    providers: uniqueCleanValues(docs.map((doc) => providerLabel(doc.ocrProvider)).filter((value) => value !== "-")),
  };
}

function recordProgressCopy(intelligence) {
  const total = intelligence.docs.length;
  const ready = intelligence.readyDocs.length;
  const processed = intelligence.processedDocs.length;
  const reupload = intelligence.reuploadDocs.length;
  const processing = intelligence.processingDocs.length;
  if (!total) return "No documents";
  if (reupload && processed) return `${processed} processed, ${reupload} need reupload`;
  if (reupload) return `${reupload} need reupload`;
  if (processing && processed) return `${processing} new upload${processing === 1 ? "" : "s"} processing`;
  if (processing) return `${processing} upload${processing === 1 ? "" : "s"} processing`;
  return `${ready || processed || total} processed`;
}

function recordGroupShareText(group, intelligence, lastVisit, dateRange) {
  const lines = [
    `${group?.label || "Medical record"} - Heault record`,
    `Last visit: ${lastVisit}`,
    `Date range: ${dateRange}`,
    `Documents: ${intelligence.docs.length}`,
    intelligence.hospitals.length ? `Hospital: ${compactList(intelligence.hospitals)}` : "",
    intelligence.doctors.length ? `Doctor: ${compactList(intelligence.doctors)}` : "",
    intelligence.patients.length ? `Patient: ${compactList(intelligence.patients)}` : "",
    intelligence.summaryText ? `\nAI summary:\n${intelligence.summaryText}` : "",
    intelligence.extractedText ? `\nClean extracted text:\n${intelligence.extractedText}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

async function shareRecordGroup(group, intelligence, lastVisit, dateRange) {
  try {
    await Share.share({
      title: `${group?.label || "Heault"} record`,
      message: recordGroupShareText(group, intelligence, lastVisit, dateRange),
    });
  } catch (error) {
    Alert.alert("Share failed", error?.message || "Could not share this record.");
  }
}

function RecordGroupDetail({ nav, app, params }) {
  const mode = params?.mode || "hospital";
  const group = useMemo(() => groupRecords(app.docs, "latest", mode).find((item) => item.key === params?.groupKey), [app.docs, mode, params?.groupKey]);
  const originals = useMemo(
    () => originalPagesForDocs(group?.docs || [], app.authToken).sort(compareOriginalUploadOrder),
    [group, app.authToken]
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const positionedTimelineRef = useRef("");
  const [galleryWidth, setGalleryWidth] = useState(0);
  const [fullGallery, setFullGallery] = useState(false);
  const [fullZoom, setFullZoom] = useState(1);
  const [fullRotation, setFullRotation] = useState(0);
  const [extractedExpanded, setExtractedExpanded] = useState(false);
  const galleryScrollRef = useRef(null);
  const fullGalleryScrollRef = useRef(null);
  const selected = originals[Math.min(selectedIndex, Math.max(0, originals.length - 1))];
  const selectedDoc = selected?.doc;
  const selectedNeedsReupload = isReuploadStatus(selectedDoc?.status);
  const groupStatus = statusForDocs(group?.docs || []);
  const dateRange = dateRangeForDocs(group?.docs || []);
  const lastVisit = lastVisitForDocs(group?.docs || []);
  const intelligence = useMemo(() => recordGroupIntelligence(group), [group]);
  const groupTypeIcon = group?.type === "doctor" ? Stethoscope : group?.type === "patient" ? UserRound : group?.type === "period" ? CalendarClock : Building2;
  const GroupIcon = groupTypeIcon;
  const groupUploadTarget = useMemo(
    () => normalizeUploadTarget({ type: group?.type, mode, label: group?.label, groupKey: group?.key }),
    [group?.key, group?.label, group?.type, mode]
  );
  const previewWidth = galleryWidth || DEVICE_WIDTH - 68;
  const overviewText = useMemo(() => buildRecordOverviewText(group, intelligence, lastVisit, dateRange), [group, intelligence, lastVisit, dateRange]);
  const extractedText = intelligence.extractedText || "";
  const extractedHasMore = extractedText.length > EXTRACTED_TEXT_PREVIEW_LIMIT;
  const displayedExtractedText = extractedExpanded ? extractedText : truncateTextAtBoundary(extractedText);

  useEffect(() => {
    if (selectedIndex >= originals.length) setSelectedIndex(Math.max(0, originals.length - 1));
  }, [originals.length, selectedIndex]);

  useEffect(() => {
    setExtractedExpanded(false);
  }, [params?.groupKey]);

  useEffect(() => {
    const key = `${params?.groupKey || "group"}:${originals.length}`;
    if (!originals.length || positionedTimelineRef.current === key) return undefined;
    positionedTimelineRef.current = key;
    const latestIndex = 0;
    setSelectedIndex(latestIndex);
    const frame = requestAnimationFrame(() => {
      galleryScrollRef.current?.scrollToIndex?.({ index: latestIndex, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [params?.groupKey, originals.length, previewWidth]);

  useEffect(() => {
    if (!fullGallery) return undefined;
    const frame = requestAnimationFrame(() => {
      fullGalleryScrollRef.current?.scrollToIndex?.({ index: selectedIndex, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [fullGallery, selectedIndex]);

  const moveToOriginal = (index, options = {}) => {
    const nextIndex = Math.max(0, Math.min(originals.length - 1, index));
    setSelectedIndex(nextIndex);
    const animated = options.animated ?? Math.abs(nextIndex - selectedIndex) <= 8;
    galleryScrollRef.current?.scrollToIndex?.({ index: nextIndex, animated });
  };

  const openFullGallery = (index = selectedIndex) => {
    if (!originals.length) return;
    setSelectedIndex(Math.max(0, Math.min(originals.length - 1, index)));
    setFullZoom(1);
    setFullRotation(0);
    setFullGallery(true);
  };

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
        <View style={styles.groupFileCover}>
          <View style={styles.groupFileTab}>
            <GroupIcon size={14} color={C.primary} />
            <Text style={styles.groupFileTabText}>{groupLabelForMode(group.type)} file</Text>
          </View>
          <View style={styles.groupFileCoverTop}>
            <View style={styles.recordGroupIcon}>
              <GroupIcon size={22} color={C.primary} />
            </View>
            <View style={styles.flexFill}>
              <Text style={styles.groupFileTitle} numberOfLines={2}>{group.label}</Text>
              <Text style={styles.groupFileSubtitle} numberOfLines={1}>Last visit: {lastVisit}</Text>
            </View>
            {groupStatus === "needs_reupload" && <StatusPill status={groupStatus} />}
          </View>
          <View style={styles.groupFileFacts}>
            <View style={styles.groupFileFact}>
              <Files size={14} color={C.primary} />
              <Text style={styles.groupFileFactText}>{group.docs.length} doc{group.docs.length === 1 ? "" : "s"}</Text>
            </View>
            <View style={styles.groupFileFact}>
              <FileText size={14} color={C.primary} />
              <Text style={styles.groupFileFactText}>{group.pageCount} page{group.pageCount === 1 ? "" : "s"}</Text>
            </View>
            <View style={styles.groupFileFact}>
              <CalendarClock size={14} color={C.primary} />
              <Text style={styles.groupFileFactText} numberOfLines={1}>{lastVisit}</Text>
            </View>
          </View>
          {!!groupUploadTarget && (
            <TouchableOpacity
              activeOpacity={0.84}
              onPress={() => app.openUploadSheet?.(groupUploadTarget)}
              style={styles.groupAddInlineButton}
            >
              <Plus size={17} color="#fff" />
              <Text style={styles.groupAddInlineText}>
                Add documents to this {groupUploadTarget.type === "hospital" ? "hospital" : "file"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.groupOriginalViewer}>
          <View style={styles.groupViewerTop}>
            <View>
              <Text style={styles.groupViewerTitle}>Original documents</Text>
              <Text style={styles.groupViewerSubtitle}>Every uploaded image or PDF stays here.</Text>
            </View>
            <Text style={styles.groupViewerCount}>
              {originals.length ? `${Math.min(selectedIndex + 1, originals.length)} / ${originals.length}` : "Not cached"}
            </Text>
          </View>
          <View style={styles.groupPreviewStage} onLayout={(event) => setGalleryWidth(event.nativeEvent.layout.width)}>
            {originals.length ? (
              <>
                <FlatList
                  ref={galleryScrollRef}
                  data={originals}
                  horizontal
                  pagingEnabled
                  initialNumToRender={1}
                  maxToRenderPerBatch={2}
                  windowSize={3}
                  removeClippedSubviews
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item, index) => `${item.doc.id}-${item.index}-${index}`}
                  getItemLayout={(_, index) => ({ length: previewWidth, offset: previewWidth * index, index })}
                  onScrollToIndexFailed={(info) => {
                    galleryScrollRef.current?.scrollToOffset?.({ offset: info.averageItemLength * info.index, animated: true });
                  }}
                  onMomentumScrollEnd={(event) => {
                    const index = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, previewWidth));
                    setSelectedIndex(Math.max(0, Math.min(originals.length - 1, index)));
                  }}
                  renderItem={({ item, index }) => (
                    <TouchableOpacity key={`${item.doc.id}-${index}`} activeOpacity={0.94} onPress={() => openFullGallery(index)}>
                      <OriginalPreviewPage item={item} width={previewWidth} />
                    </TouchableOpacity>
                  )}
                />
                <TouchableOpacity activeOpacity={0.82} onPress={() => openFullGallery(selectedIndex)} style={styles.galleryOpenButton}>
                  <Maximize2 size={15} color="#fff" />
                  <Text style={styles.galleryOpenText}>Open</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.groupMissingOriginal}>
                <FileText size={38} color="#fff" />
                <Text style={styles.groupMissingTitle}>Original preview is not cached on this device</Text>
                <Text style={styles.groupMissingText}>Metadata, OCR text, and summary are still available. Reupload the file to restore the original preview.</Text>
              </View>
            )}
          </View>
          {!!originals.length && <TimelineScrubber items={originals} selectedIndex={selectedIndex} onChange={moveToOriginal} />}
          {selectedNeedsReupload && (
            <AppButton icon={RefreshCcw} onPress={() => app.reuploadDoc?.(selectedDoc.id)} style={[styles.fullWidth, { marginTop: 14 }]}>
              Reupload this file
            </AppButton>
          )}
        </View>

        {!!(intelligence.processingDocs.length || intelligence.reuploadDocs.length) && (
          <Card style={[styles.recordProcessCard, intelligence.reuploadDocs.length ? styles.recordProcessCardWarn : styles.recordProcessCardInfo]}>
            <View style={styles.recordProcessIcon}>
              {intelligence.reuploadDocs.length ? <RefreshCcw size={18} color={C.amber} /> : <ActivityIndicator size="small" color={C.blue} />}
            </View>
            <View style={styles.flexFill}>
              <Text style={styles.recordProcessTitle}>{recordProgressCopy(intelligence)}</Text>
              <Text style={styles.recordProcessText}>
                Existing pages stay saved. Heault processes only the newly added uploads and then adds them to this file.
              </Text>
            </View>
          </Card>
        )}

        <Card style={styles.recordSummaryPanel}>
          <View style={styles.sectionHeaderSpread}>
            <View style={styles.insightPanelHeader}>
              <FileCheck2 size={17} color={C.primary} />
              <Text style={styles.ocrTitle}>Record summary</Text>
            </View>
            <TouchableOpacity activeOpacity={0.78} onPress={() => shareRecordGroup(group, intelligence, lastVisit, dateRange)} style={styles.sectionActionButton}>
              <Share2 size={15} color={C.primary} />
            </TouchableOpacity>
          </View>
          <View style={styles.recordSummaryGrid}>
            <View style={styles.recordSummaryTile}>
              <CalendarClock size={16} color={C.primary} />
              <Text style={styles.recordSummaryLabel}>Last visit</Text>
              <Text style={styles.recordSummaryValue} numberOfLines={1}>{lastVisit}</Text>
            </View>
            <View style={styles.recordSummaryTile}>
              <Files size={16} color={C.primary} />
              <Text style={styles.recordSummaryLabel}>Documents</Text>
              <Text style={styles.recordSummaryValue}>{group.docs.length} / {group.pageCount} pages</Text>
            </View>
          </View>
          <InfoRow label="Hospital" value={group.type === "hospital" && group.label !== "Hospital not found" ? group.label : compactList(intelligence.hospitals)} />
          <InfoRow label="Doctor" value={compactList(intelligence.doctors)} />
          <InfoRow label="Patient" value={compactList(intelligence.patients)} />
          <InfoRow label="Categories" value={compactList(intelligence.categories)} />
          <InfoRow label="OCR confidence" value={percentLabel(intelligence.avgConfidence)} />
          <InfoRow label="OCR provider" value={compactList(intelligence.providers)} />
        </Card>

        <Card style={[styles.infoPanel, styles.groupAiPanel]}>
          <View style={styles.insightPanelHeader}>
            <Sparkles size={17} color={C.green} />
            <Text style={styles.ocrTitle}>AI summary</Text>
          </View>
          {overviewText ? (
            <>
              <ReportText text={overviewText} large />
              {!!intelligence.reuploadDocs.length && (
                <Text style={styles.sectionFootnote}>Summary uses processed pages only. Reupload unclear pages to complete this record.</Text>
              )}
            </>
          ) : intelligence.processingDocs.length ? (
            <View style={styles.sectionLoadingRow}>
              <ActivityIndicator size="small" color={C.green} />
              <Text style={styles.sectionMutedText}>Analyzing documents. This will update automatically when processing finishes.</Text>
            </View>
          ) : (
            <Text style={styles.sectionMutedText}>AI summary will appear after OCR and analysis finish.</Text>
          )}
        </Card>

        <Card style={styles.infoPanel}>
          <View style={styles.sectionHeaderSpread}>
            <View style={styles.insightPanelHeader}>
              <FileText size={17} color={C.blue} />
              <Text style={styles.ocrTitle}>Clean extracted text</Text>
            </View>
            <View style={styles.sectionActions}>
              <TouchableOpacity activeOpacity={0.78} onPress={() => shareRecordGroup(group, intelligence, lastVisit, dateRange)} style={styles.sectionActionButton}>
                <Share2 size={15} color={C.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.78}
                disabled={!selectedDoc}
                onPress={() => selectedDoc && nav.push("ocrReview", { docId: selectedDoc.id })}
                style={[styles.sectionActionButton, !selectedDoc && styles.sectionActionButtonDisabled]}
              >
                <Edit3 size={15} color={selectedDoc ? C.primary : C.muted} />
              </TouchableOpacity>
            </View>
          </View>
          {extractedText ? (
            <>
              <ReportText text={displayedExtractedText} />
              {extractedHasMore && (
                <TouchableOpacity activeOpacity={0.78} onPress={() => setExtractedExpanded((value) => !value)} style={styles.readMoreButton}>
                  <Text style={styles.readMoreText}>{extractedExpanded ? "Show less" : "Read more"}</Text>
                  <ChevronRight size={15} color={C.primary} style={{ transform: [{ rotate: extractedExpanded ? "-90deg" : "90deg" }] }} />
                </TouchableOpacity>
              )}
            </>
          ) : intelligence.processingDocs.length ? (
            <View style={styles.sectionLoadingRow}>
              <ActivityIndicator size="small" color={C.blue} />
              <Text style={styles.sectionMutedText}>Extracting readable text from the uploaded documents.</Text>
            </View>
          ) : (
            <Text style={styles.sectionMutedText}>No readable text is available yet. Reupload a clearer medical document if this remains empty.</Text>
          )}
        </Card>

        <Card style={styles.infoPanel}>
          <View style={styles.insightPanelHeader}>
            <FolderOpen size={17} color={C.primary} />
            <Text style={styles.ocrTitle}>File details</Text>
          </View>
          <InfoRow label="Grouped by" value={groupLabelForMode(group.type)} />
          <InfoRow label="Date range" value={dateRange} />
          <InfoRow label="Documents" value={`${group.docs.length} document${group.docs.length === 1 ? "" : "s"}`} />
          <InfoRow label="Pages" value={`${group.pageCount} page${group.pageCount === 1 ? "" : "s"}`} />
          <InfoRow label="Status" value={statusCopy(groupStatus)[0]} />
        </Card>
      </View>
      <Modal visible={fullGallery} transparent animationType="fade" onRequestClose={() => setFullGallery(false)}>
        <View style={styles.galleryModal}>
          <View style={styles.galleryModalTop}>
            <TouchableOpacity activeOpacity={0.8} onPress={() => setFullGallery(false)} style={styles.galleryTopButton}>
              <X size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.galleryCounter}>{originals.length ? `${selectedIndex + 1} / ${originals.length}` : "0 / 0"}</Text>
            <TouchableOpacity activeOpacity={0.8} onPress={() => selectedDoc && shareDocument(selectedDoc)} style={styles.galleryTopButton}>
              <Share2 size={19} color="#fff" />
            </TouchableOpacity>
          </View>
          <FlatList
            ref={fullGalleryScrollRef}
            data={originals}
            horizontal
            pagingEnabled
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            removeClippedSubviews
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `${item.doc.id}-full-${item.index}-${index}`}
            getItemLayout={(_, index) => ({ length: DEVICE_WIDTH, offset: DEVICE_WIDTH * index, index })}
            onScrollToIndexFailed={(info) => {
              fullGalleryScrollRef.current?.scrollToOffset?.({ offset: DEVICE_WIDTH * info.index, animated: true });
            }}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.x / DEVICE_WIDTH);
              setSelectedIndex(Math.max(0, Math.min(originals.length - 1, index)));
            }}
            renderItem={({ item, index }) => (
              <OriginalPreviewPage key={`${item.doc.id}-full-${index}`} item={item} width={DEVICE_WIDTH} full zoom={index === selectedIndex ? fullZoom : 1} rotation={index === selectedIndex ? fullRotation : 0} />
            )}
          />
          <View style={styles.galleryModalTools}>
            <ViewerTool icon={ZoomOut} onPress={() => setFullZoom((z) => Math.max(0.8, z - 0.12))} />
            <ViewerTool icon={ZoomIn} onPress={() => setFullZoom((z) => Math.min(1.8, z + 0.12))} />
            <ViewerTool icon={RotateCw} onPress={() => setFullRotation((r) => r + 90)} />
          </View>
        </View>
      </Modal>
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
  const isPdfDoc = isPdfMime(doc?.mimeType, doc?.fileName);

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Import document" back />
      <View style={styles.pageBody}>
        <Card style={styles.uploadStatusCard}>
          <View style={styles.uploadStatusIcon}>
            <ShieldCheck size={20} color={C.green} />
          </View>
          <View style={styles.flexFill}>
            <Text style={styles.uploadStatusTitle}>{copy[0]}</Text>
            <Text style={styles.uploadStatusText} numberOfLines={2}>Original saved locally before OCR or AI starts.</Text>
          </View>
          <StatusPill status={doc?.status || "queued"} />
        </Card>

        <View style={[styles.previewCard, method === "camera" && { backgroundColor: "#171316" }]}>
          {doc && isImageDoc ? (
            <Image source={{ uri: doc.localUri }} style={styles.originalImagePreview} resizeMode="contain" />
          ) : doc && isPdfDoc ? (
            <PdfPreview uri={doc.localUri} />
          ) : (
            <View>
              <DocumentMock />
              {method === "camera" && <View style={styles.scanLine} />}
            </View>
          )}
        </View>
        <View style={styles.toolGrid}>
          <ToolButton icon={RefreshCcw} label={method === "camera" ? "Retake" : "Replace"} />
          <ToolButton icon={Crop} label="Crop" />
          <ToolButton icon={RotateCw} label="Rotate" />
          <ToolButton icon={Sparkles} label="Enhance" active={enhanced} onPress={() => setEnhanced(!enhanced)} />
        </View>
        <Card style={styles.readyCard}>
          <Check size={18} color={C.green} />
          <View style={styles.flexFill}>
            <Text style={styles.readyTitle}>{copy[1]}</Text>
            <Text style={styles.readySubtitle}>We will read the document, group it, and keep the original unchanged.</Text>
          </View>
        </Card>
        <AppButton disabled={!doc} icon={Sparkles} onPress={() => nav.push("analysis", { method, docId: doc?.id })} style={[styles.fullWidth, { marginTop: 18 }]}>Start processing</AppButton>
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
        const patch = processingFailurePatch(caught, doc);
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
  const isPdfDoc = isPdfMime(currentDoc?.mimeType, currentDoc?.fileName);
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
          <View style={styles.analysisSavedRow}>
            <Lock size={14} color={C.green} />
            <Text style={styles.analysisSavedText}>Original file saved locally. Processing can fail without losing the upload.</Text>
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
            {isImageDoc ? (
              <Image source={{ uri: currentDoc.localUri }} style={styles.originalImagePreview} resizeMode="contain" />
            ) : isPdfDoc ? (
              <PdfPreview uri={currentDoc.localUri} compact />
            ) : (
              <DocumentMock />
            )}
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
        <Card style={styles.formPanel}>
          <Field label="Rename document" value={form.title} onChangeText={(title) => setForm({ ...form, title })} icon={FileText} />
          <Text style={styles.fieldLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, { marginTop: 8, marginBottom: 14 }]}>
            {CATEGORIES.map((cat) => <Chip key={cat.id} label={cat.label} active={form.category === cat.id} onPress={() => setForm({ ...form, category: cat.id })} />)}
          </ScrollView>
          <Field label="AI summary" value={form.summary} onChangeText={(summary) => setForm({ ...form, summary })} icon={Sparkles} multiline />
          <Field label="Tags" value={form.tags} onChangeText={(tags) => setForm({ ...form, tags })} icon={Tags} />
          <Field label="Hospital name" value={form.hospital} onChangeText={(hospital) => setForm({ ...form, hospital })} icon={Building2} />
          <Field label="Doctor name" value={form.doctor} onChangeText={(doctor) => setForm({ ...form, doctor })} icon={Stethoscope} />
          <Field label="Visit date" value={form.visitDate} onChangeText={(visitDate) => setForm({ ...form, visitDate })} icon={CalendarClock} />
          <Field label="Clean extracted text" value={form.structuredText} onChangeText={(structuredText) => setForm({ ...form, structuredText })} icon={FileCheck2} multiline />
          <Field label="Raw OCR text" value={form.ocr} onChangeText={(ocr) => setForm({ ...form, ocr })} icon={FileText} multiline />
        </Card>
        <AppButton icon={ShieldCheck} onPress={save} style={[styles.fullWidth, { marginTop: 16 }]}>{incoming ? "Save changes" : "Save document"}</AppButton>
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
  const originalFile = primaryOriginalForDoc(doc, app.authToken);
  const isImageDoc = originalFile?.mimeType?.startsWith("image/");
  const isPdfDoc = isPdfMime(originalFile?.mimeType, originalFile?.name || doc?.fileName);
  const summaryText = doc?.summary || doc?.clinicalSummary || "";
  const structuredText = structuredTextForDoc(doc);

  return (
    <Screen bottomPad={34}>
      <Header nav={nav} app={app} title="Document" back right={<IconButton icon={MoreHorizontal} label="More" />} />
      <View style={styles.pageBody}>
        <View style={styles.documentViewerShell}>
          <View style={styles.documentViewerTop}>
            <View>
              <Text style={styles.documentViewerLabel}>Original file</Text>
              <Text style={styles.documentViewerName} numberOfLines={1}>{doc.fileName || doc.title}</Text>
            </View>
            <StatusPill status={doc.status || "ready"} />
          </View>
          <View style={styles.documentViewer}>
            {isPdfDoc ? (
              <PdfPreview uri={originalFile?.uri} headers={originalFile?.headers} />
            ) : (
              <Animated.View style={{ transform: [{ scale: zoom }, { rotate: `${rotation}deg` }] }}>
                {isImageDoc ? (
                <Image source={sourceForOriginalFile(originalFile)} style={styles.viewerImagePreview} resizeMode="contain" />
                ) : (
                  <DocumentMock />
                )}
              </Animated.View>
            )}
          </View>
        </View>
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
            <Text style={styles.detailSubtitle}>{cat.label} - {doc.pages} page{doc.pages === 1 ? "" : "s"}</Text>
          </View>
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
          {isImageDoc ? (
            <Image source={sourceForOriginalFile(originalFile)} style={styles.fullPreviewImage} resizeMode="contain" />
          ) : isPdfDoc ? (
            <PdfPreview uri={originalFile?.uri} headers={originalFile?.headers} full />
          ) : (
            <DocumentMock />
          )}
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

function ReportText({ text, large = false }) {
  const blocks = cleanReadableText(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return null;

  return (
    <View style={[styles.reportTextWrap, large && styles.reportTextWrapLarge]}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter(Boolean);
        if (/<table/i.test(block)) {
          return <ReportTable key={`block-${blockIndex}`} rows={htmlTableRows(block)} />;
        }
        if (lines.length > 1 && lines.every((line) => line.includes("|"))) {
          return <ReportTable key={`block-${blockIndex}`} rows={markdownTableRows(lines)} />;
        }

        return (
          <View key={`block-${blockIndex}`} style={[styles.reportBlock, blockIndex > 0 && styles.reportBlockSeparated]}>
            {lines.map((line, lineIndex) => {
              const heading = line.match(/^(#{1,6})\s+(.+)/);
              if (heading) {
                return (
                  <View key={`line-${lineIndex}`} style={styles.reportHeadingRow}>
                    <View style={styles.reportHeadingAccent} />
                    <Text style={[styles.reportHeading, large && styles.reportHeadingLarge]}>{heading[2]}</Text>
                  </View>
                );
              }
              const bullet = line.match(/^\s*[-*]\s+(.+)/);
              if (bullet) {
                return (
                  <View key={`line-${lineIndex}`} style={styles.reportBulletRow}>
                    <View style={styles.reportBulletDot} />
                    <Text style={[styles.reportText, large && styles.reportTextLarge]}>{bullet[1]}</Text>
                  </View>
                );
              }
              const numbered = line.match(/^\s*(\d+)\.\s+(.+)/);
              if (numbered) {
                return (
                  <View key={`line-${lineIndex}`} style={styles.reportBulletRow}>
                    <View style={styles.reportNumberPill}>
                      <Text style={styles.reportNumberText}>{numbered[1]}</Text>
                    </View>
                    <Text style={[styles.reportText, large && styles.reportTextLarge]}>{stripInlineHtml(numbered[2])}</Text>
                  </View>
                );
              }
              return <Text key={`line-${lineIndex}`} style={[styles.reportText, large && styles.reportTextLarge]}>{stripInlineHtml(line)}</Text>;
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

function BottomNav({ current, nav, fabOpen, setFabOpen, reuploadTargetId, setReuploadTargetId, uploadContext, setUploadContext, onUpload, onReupload, showBar = true }) {
  const options = [
    { id: "camera", icon: Camera, label: "Scan with Camera", sub: "Convert physical papers to digital data", tone: C.primary },
    { id: "pdf", icon: FileText, label: "Upload PDF", sub: "Direct import from medical portals", tone: C.primary2 },
    { id: "gallery", icon: ImageIcon, label: "Upload from Gallery", sub: "Select existing document images", tone: C.green },
  ];
  const openUpload = async (method) => {
    setFabOpen(false);
    const targetId = reuploadTargetId;
    const targetContext = uploadContext;
    setReuploadTargetId?.("");
    setUploadContext?.(null);
    if (targetId) await onReupload?.(targetId, method);
    else await onUpload?.(method, targetContext);
  };
  const closeSheet = () => {
    setFabOpen(false);
    setReuploadTargetId?.("");
    setUploadContext?.(null);
  };
  const replaceMode = Boolean(reuploadTargetId);
  const targetMode = Boolean(!replaceMode && uploadContext?.label);
  const targetLabel = uploadContext?.type === "hospital"
    ? "hospital file"
    : uploadContext?.type === "doctor"
      ? "doctor file"
      : "record file";
  return (
    <>
      <Modal visible={fabOpen} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity activeOpacity={1} onPress={closeSheet} style={styles.sheetScrim}>
          <TouchableOpacity activeOpacity={1} style={styles.uploadSheet}>
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetTitle}>{replaceMode ? "Replace Original" : targetMode ? `Add to ${targetLabel}` : "Add New Record"}</Text>
            <Text style={styles.sheetSubtitle}>
              {replaceMode
                ? "Choose the replacement source for this file."
                : targetMode
                  ? uploadContext.label
                  : "Choose how you would like to import your medical documents."}
            </Text>
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
            <AppButton tone="danger" onPress={closeSheet} style={[styles.fullWidth, { marginTop: 22 }]}>Cancel</AppButton>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {showBar && <View style={styles.bottomNav}>
        <NavItem icon={Home} label="Home" active={current === "home"} onPress={() => { closeSheet(); nav.go("home"); }} />
        <TouchableOpacity
          accessibilityLabel="Upload"
          activeOpacity={0.82}
          onPress={() => {
            setReuploadTargetId?.("");
            setUploadContext?.(null);
            setFabOpen(!fabOpen);
          }}
          style={styles.navFab}
        >
          <Plus size={30} color="#fff" style={{ transform: [{ rotate: fabOpen ? "45deg" : "0deg" }] }} />
        </TouchableOpacity>
        <NavItem icon={FolderOpen} label="Records" active={current === "records"} onPress={() => { closeSheet(); nav.go("records"); }} />
      </View>}
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
  const [reuploadTargetId, setReuploadTargetId] = useState("");
  const [uploadContext, setUploadContext] = useState(null);
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
    setReuploadTargetId("");
    setUploadContext(null);
    setStack([{ screen, params }]);
  }, []);
  const openUploadSheet = useCallback((context = null) => {
    setReuploadTargetId("");
    setUploadContext(normalizeUploadTarget(context));
    setFabOpen(true);
  }, []);
  const openReuploadSheet = useCallback((docId) => {
    if (!docId) return;
    setReuploadTargetId(docId);
    setUploadContext(null);
    setFabOpen(true);
  }, []);
  const startUpload = useCallback(async (method, context = null) => {
    if (!authToken) {
      Alert.alert("Login required", "Please login or create an account before uploading medical documents.");
      go("welcome");
      return;
    }
    try {
      const uploadTarget = normalizeUploadTarget(context);
      const assets = await pickUploadAssets(method);
      if (!assets?.length) return;
      const localFiles = await copyAssetsToVault(assets, method);
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const drafts = method === "gallery" && localFiles.length > 1
        ? localFiles.map((file, index) => createDraftDocument(method, [file], index, batchId, uploadTarget))
        : [createDraftDocument(method, localFiles, 0, batchId, uploadTarget)];
      setDocs((existing) => [...drafts, ...existing]);
      go("records");
    } catch (error) {
      Alert.alert("Upload failed", error?.message || "Could not import this document.");
    }
  }, [authToken, go]);
  const reuploadDoc = useCallback(async (docId, method) => {
    if (!method) {
      openReuploadSheet(docId);
      return;
    }
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
  }, [authToken, docs, go, openReuploadSheet]);
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
    setReuploadTargetId("");
    setUploadContext(null);
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
    openUploadSheet,
    openReuploadSheet,
    reuploadDoc,
  };

  useEffect(() => {
    const availableSlots = Math.max(0, PROCESSING_CONCURRENCY - processingIdsRef.current.size);
    if (!availableSlots) return undefined;
    const queued = docs
      .filter((doc) => doc.status === "queued" && !processingIdsRef.current.has(doc.id))
      .slice(0, availableSlots);
    if (!queued.length) return undefined;

    queued.forEach((doc) => {
      processingIdsRef.current.add(doc.id);
      runDocumentPipeline(doc, app)
        .catch((error) => {
          app.updateDocPatch(doc.id, processingFailurePatch(error, doc));
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
      <LinearGradient colors={["#FAFCFD", "#EEF3F6", "#F8F0F3"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.routeWrap}>{screens[current.screen] || screens.home}</View>
      {showChrome && (
        <BottomNav
          current={current.screen}
          nav={nav}
          fabOpen={fabOpen}
          setFabOpen={setFabOpen}
          reuploadTargetId={reuploadTargetId}
          setReuploadTargetId={setReuploadTargetId}
          uploadContext={uploadContext}
          setUploadContext={setUploadContext}
          onUpload={startUpload}
          onReupload={reuploadDoc}
          showBar={isRoot}
        />
      )}
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
    paddingHorizontal: 20,
    paddingTop: 46,
    paddingBottom: 10,
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
    fontSize: 17,
    fontWeight: "900",
    color: C.ink,
  },
  smallIconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
  },
  tinyIconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
  },
  avatarButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 2,
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 1,
  },
  iconButtonActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  buttonTouch: {
    borderRadius: 12,
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 3,
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
    fontWeight: "900",
  },
  softButton: {
    backgroundColor: C.surface,
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
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    shadowColor: "#0F172A",
    shadowOpacity: 0.045,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 1,
  },
  textButton: {
    color: C.primary,
    fontSize: 13,
    fontWeight: "900",
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
    backgroundColor: "rgba(122,23,56,0.10)",
  },
  splashMark: {
    width: 118,
    height: 118,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.10,
    shadowOffset: { width: 0, height: 24 },
    shadowRadius: 55,
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
    paddingHorizontal: 20,
    paddingTop: topInset + 62,
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
    marginTop: 34,
    padding: 22,
    borderRadius: 14,
    minHeight: 184,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  welcomeTitle: {
    color: "#fff",
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "900",
    marginTop: 18,
  },
  welcomeBody: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  welcomeProofGrid: {
    marginTop: 14,
    gap: 8,
  },
  welcomeProofItem: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  welcomeProofText: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: "900",
  },
  authBody: {
    paddingHorizontal: 20,
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
    marginTop: 26,
  },
  countryBox: {
    height: 54,
    borderRadius: 10,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: "#fff",
    paddingHorizontal: 15,
    fontSize: 16,
    fontWeight: "800",
    color: C.ink,
  },
  bottomAction: {
    paddingHorizontal: 20,
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
    borderRadius: 12,
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
    marginHorizontal: 20,
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
    borderRadius: 14,
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
    fontWeight: "900",
    color: C.text,
  },
  fieldBox: {
    marginTop: 7,
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: C.surface,
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
    borderRadius: 10,
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
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  simplePageHeader: {
    marginBottom: 14,
  },
  simplePageTitle: {
    color: C.ink,
    fontSize: 23,
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
    borderRadius: 16,
    padding: 18,
    minHeight: 382,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: "#0F172A",
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 28,
    elevation: 2,
    overflow: "hidden",
  },
  heroSecurePill: {
    alignSelf: "flex-start",
    minHeight: 32,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.82)",
    borderWidth: 1,
    borderColor: "rgba(47,143,91,0.14)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  heroSecureText: {
    color: C.green,
    fontSize: 11.5,
    fontWeight: "900",
  },
  vaultHeroVisual: {
    height: 168,
    marginTop: 8,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  vaultDrawerBack: {
    position: "absolute",
    width: 240,
    height: 118,
    bottom: 18,
    borderRadius: 24,
    backgroundColor: "rgba(122,23,56,0.10)",
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.10)",
    transform: [{ rotate: "-2deg" }],
  },
  vaultFileStack: {
    width: 214,
    height: 124,
    marginTop: 8,
  },
  vaultFilePaper: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 10,
    height: 100,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.12)",
    backgroundColor: "#fff",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 1,
  },
  vaultFilePaperBack: {
    transform: [{ rotate: "-7deg" }, { translateX: -12 }, { translateY: 8 }],
    backgroundColor: "#F3F7F8",
  },
  vaultFilePaperMid: {
    transform: [{ rotate: "6deg" }, { translateX: 13 }, { translateY: 5 }],
    backgroundColor: "#F9F0F3",
  },
  vaultFileFront: {
    position: "absolute",
    left: 24,
    right: 24,
    top: 0,
    minHeight: 118,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.14)",
    backgroundColor: "#FFFFFF",
    padding: 13,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 20,
    elevation: 2,
  },
  vaultFileTab: {
    position: "absolute",
    top: -1,
    left: 16,
    width: 60,
    height: 13,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    backgroundColor: C.blush,
  },
  vaultFileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 8,
  },
  vaultFileMark: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
  },
  vaultFileLines: {
    gap: 6,
  },
  vaultFileRows: {
    gap: 9,
    marginTop: 15,
  },
  vaultLineStrong: {
    height: 8,
    borderRadius: 99,
    backgroundColor: C.primary,
  },
  vaultLineSoft: {
    height: 7,
    borderRadius: 99,
    backgroundColor: "#DDE7EC",
  },
  vaultMiniGrid: {
    flexDirection: "row",
    gap: 7,
    marginTop: 2,
  },
  vaultMiniCell: {
    flex: 1,
    height: 16,
    borderRadius: 6,
    backgroundColor: C.tealSoft,
  },
  vaultDrawerBase: {
    position: "absolute",
    bottom: 14,
    width: 246,
    height: 46,
    borderRadius: 15,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 22,
    elevation: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  vaultDrawerHandle: {
    width: 76,
    height: 7,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  vaultSeal: {
    position: "absolute",
    right: 58,
    bottom: 34,
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.green,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 3,
  },
  homeHeroEyebrow: {
    color: C.primary,
    fontSize: 11.5,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  homeHeroGreeting: {
    color: C.ink,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: "900",
    marginTop: 5,
    maxWidth: 310,
  },
  homeHeroTitle: {
    color: C.primary,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    marginTop: 4,
    maxWidth: 310,
  },
  homeHeroText: {
    color: C.text,
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 280,
  },
  homeFilePreview: {
    minHeight: 92,
    marginTop: 18,
    justifyContent: "flex-end",
  },
  homeFileBack: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 13,
    height: 62,
    borderRadius: 10,
    backgroundColor: "rgba(122,23,56,0.12)",
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.10)",
    transform: [{ rotate: "-1.5deg" }],
  },
  homeFileSheet: {
    minHeight: 78,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.16)",
    backgroundColor: "rgba(255,255,255,0.92)",
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  homeFileGrip: {
    width: 5,
    alignSelf: "stretch",
    borderRadius: 999,
    backgroundColor: C.primary,
  },
  homeFileTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  homeFileLabel: {
    color: C.primary,
    fontSize: 10.5,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  homeFileTitle: {
    color: C.ink,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 3,
  },
  homeFileMeta: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  homeHeroStats: {
    minHeight: 68,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  homeHeroStatItem: {
    flex: 1,
    minHeight: 66,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.09)",
    paddingHorizontal: 12,
    justifyContent: "center",
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
    borderRadius: 12,
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
    borderRadius: 10,
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
    borderRadius: 10,
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
    borderRadius: 10,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: C.surface,
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
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
    shadowOpacity: 0,
    elevation: 0,
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
    borderRadius: 12,
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
    minHeight: 68,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 2,
  },
  docIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
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
    borderRadius: 10,
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
    minHeight: 42,
    flexDirection: "row",
    gap: 0,
    marginTop: 6,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
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
    borderBottomWidth: 2,
    borderBottomColor: C.primary,
  },
  drawerModeText: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  drawerSummaryBar: {
    minHeight: 66,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    padding: 12,
    marginBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  drawerSummaryIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerSummaryTitle: {
    color: C.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  drawerSummaryText: {
    color: C.muted,
    fontSize: 12.2,
    fontWeight: "700",
    marginTop: 2,
  },
  drawerSummaryAdd: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
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
    gap: 8,
    marginTop: 12,
  },
  recordsStatCard: {
    flex: 1,
    minHeight: 86,
    borderRadius: 10,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D9E0EA",
    backgroundColor: "#FEFCF8",
    padding: 15,
    paddingTop: 23,
    shadowColor: "#0F172A",
    shadowOpacity: 0.075,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 24,
    elevation: 2,
  },
  recordGroupCardTemporary: {
    backgroundColor: "#F8FBFF",
    borderColor: "#C9DDF4",
  },
  fileFolderShadow: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: -7,
    height: 16,
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.06)",
  },
  folderTab: {
    position: "absolute",
    top: -10,
    left: 14,
    minWidth: 112,
    height: 25,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#D9E0EA",
    backgroundColor: "#FEFCF8",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  folderTabTemporary: {
    backgroundColor: "#F8FBFF",
    borderColor: "#C9DDF4",
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
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4E9ED",
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.12)",
  },
  recordGroupIconTemporary: {
    backgroundColor: C.blueSoft,
    borderColor: "rgba(40,103,178,0.16)",
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
    marginTop: 14,
  },
  recordGroupMetric: {
    minHeight: 30,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.05)",
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
    marginTop: 12,
    gap: 0,
  },
  drawerFileRow: {
    minHeight: 58,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E3E0D8",
    backgroundColor: "#FFFFFF",
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  drawerFileRowOverlap: {
    marginTop: -6,
    marginHorizontal: 5,
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
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.76)",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.06)",
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
    minHeight: 42,
    marginTop: 14,
    borderRadius: 10,
    backgroundColor: "rgba(122,23,56,0.09)",
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
  groupFileCover: {
    position: "relative",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D9E0EA",
    backgroundColor: "#FEFCF8",
    padding: 14,
    paddingTop: 24,
    marginTop: 4,
    marginBottom: 16,
  },
  groupFileTab: {
    position: "absolute",
    top: -10,
    left: 14,
    minWidth: 124,
    height: 25,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#D9E0EA",
    backgroundColor: "#FEFCF8",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  groupFileTabText: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  groupFileCoverTop: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  groupFileTitle: {
    color: C.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
  },
  groupFileSubtitle: {
    color: C.muted,
    fontSize: 12.5,
    fontWeight: "700",
    marginTop: 4,
  },
  groupFileFacts: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  groupFileFact: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.05)",
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  groupFileFactText: {
    flex: 1,
    color: C.text,
    fontSize: 11.5,
    fontWeight: "900",
  },
  groupOriginalViewer: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    shadowColor: "#0F172A",
    shadowOpacity: 0.055,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 2,
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
  groupViewerSubtitle: {
    color: C.muted,
    fontSize: 11.8,
    fontWeight: "700",
    marginTop: 3,
  },
  groupViewerCount: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  groupAddInlineButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: C.primary,
    marginTop: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  groupAddInlineText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  groupPreviewStage: {
    height: 410,
    borderRadius: 12,
    backgroundColor: "#101820",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  groupPreviewPage: {
    height: 410,
    alignItems: "center",
    justifyContent: "center",
  },
  groupPreviewImage: {
    width: 318,
    height: 390,
  },
  groupPdfPreview: {
    width: 230,
    minHeight: 170,
    borderRadius: 10,
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
  galleryOpenButton: {
    position: "absolute",
    right: 12,
    bottom: 12,
    minHeight: 34,
    borderRadius: 9,
    backgroundColor: "rgba(15,23,42,0.76)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  galleryOpenText: {
    color: "#fff",
    fontSize: 11.5,
    fontWeight: "900",
  },
  groupMissingOriginal: {
    width: "78%",
    minHeight: 178,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  groupMissingTitle: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 12,
  },
  groupMissingText: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.2,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 7,
  },
  timelinePanel: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 12,
    shadowColor: "#321020",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 2,
  },
  timelineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  timelineLabel: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  timelineDate: {
    color: C.ink,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  timelinePosition: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  timelineCountPill: {
    borderRadius: 999,
    backgroundColor: C.blush,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  timelineControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timelineStepButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineStepDisabled: {
    backgroundColor: "#F4F6F8",
    borderColor: "#E6ECF1",
  },
  timelineRailTouch: {
    flex: 1,
    height: 54,
    justifyContent: "center",
    position: "relative",
  },
  timelineRailOuter: {
    height: 34,
    justifyContent: "center",
    position: "relative",
  },
  timelineRail: {
    height: 15,
    borderRadius: 999,
    backgroundColor: "#EEF2F6",
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.08)",
  },
  timelineRailFill: {
    position: "absolute",
    left: 0,
    top: 9.5,
    height: 15,
    borderRadius: 999,
    backgroundColor: "#D7869F",
  },
  timelineThumb: {
    position: "absolute",
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#fff",
    borderWidth: 4,
    borderColor: C.primary2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 7 },
    shadowRadius: 12,
    elevation: 5,
  },
  timelineThumbActive: {
    borderColor: C.primary,
    shadowOpacity: 0.28,
  },
  timelineThumbDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  timelineFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  timelineRangeText: {
    flex: 1,
    color: C.muted,
    fontSize: 11.4,
    fontWeight: "800",
  },
  timelineCurrentText: {
    flex: 1,
    color: C.primary,
    fontSize: 11.8,
    fontWeight: "900",
    textAlign: "center",
  },
  groupSelectedMeta: {
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    overflow: "hidden",
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  groupThumbNumber: {
    position: "absolute",
    left: 4,
    bottom: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: "rgba(15,23,42,0.78)",
    alignItems: "center",
    justifyContent: "center",
  },
  groupThumbNumberText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
  },
  groupThumbIssue: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: C.amber,
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
  lastVisitCard: {
    padding: 15,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  lastVisitIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
  },
  lastVisitLabel: {
    color: C.muted,
    fontSize: 12.5,
    fontWeight: "800",
  },
  lastVisitValue: {
    color: C.ink,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 2,
  },
  recordProcessCard: {
    padding: 14,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  recordProcessCardWarn: {
    backgroundColor: C.amberSoft,
    borderColor: "rgba(166,95,22,0.18)",
  },
  recordProcessCardInfo: {
    backgroundColor: C.blueSoft,
    borderColor: "rgba(40,103,178,0.16)",
  },
  recordProcessIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.78)",
    alignItems: "center",
    justifyContent: "center",
  },
  recordProcessTitle: {
    color: C.ink,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: "900",
  },
  recordProcessText: {
    color: C.text,
    fontSize: 12.4,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 3,
  },
  recordSummaryPanel: {
    padding: 16,
    marginTop: 14,
  },
  sectionHeaderSpread: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  sectionActions: {
    flexDirection: "row",
    gap: 8,
  },
  sectionActionButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionActionButtonDisabled: {
    opacity: 0.45,
  },
  recordSummaryGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
  },
  recordSummaryTile: {
    flex: 1,
    minHeight: 82,
    borderRadius: 11,
    backgroundColor: "#F9F3F5",
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.08)",
    padding: 11,
    justifyContent: "space-between",
  },
  recordSummaryLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 8,
  },
  recordSummaryValue: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "900",
  },
  groupAiPanel: {
    backgroundColor: C.greenSoft,
    borderColor: "rgba(47,143,91,0.14)",
  },
  sectionLoadingRow: {
    minHeight: 52,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.68)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionMutedText: {
    flex: 1,
    color: C.text,
    fontSize: 12.8,
    lineHeight: 18,
    fontWeight: "700",
  },
  sectionFootnote: {
    color: C.green,
    fontSize: 11.8,
    lineHeight: 16,
    fontWeight: "800",
    marginTop: 10,
  },
  enterpriseRecordCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    padding: 14,
    shadowColor: "#0F172A",
    shadowOpacity: 0.045,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 1,
  },
  enterpriseRecordCardCompact: {
    borderRadius: 10,
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
    borderRadius: 10,
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
    borderRadius: 8,
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
    borderRadius: 8,
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
    borderRadius: 7,
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
    borderRadius: 14,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    backgroundColor: C.surface,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOpacity: 0.055,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 2,
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
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
    backgroundColor: C.surface,
    shadowOpacity: 0,
    elevation: 0,
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
    shadowOpacity: 0,
    elevation: 0,
  },
  uploadStatusIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
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
    borderRadius: 10,
  },
  pdfPreviewPanel: {
    width: "100%",
    minHeight: 240,
    borderRadius: 10,
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
  pdfPreviewShell: {
    width: DEVICE_WIDTH - 82,
    height: 340,
    borderRadius: 10,
    backgroundColor: "#fff",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  pdfPreviewShellFull: {
    width: DEVICE_WIDTH,
    height: DEVICE_HEIGHT - 172,
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  pdfNativePreview: {
    width: DEVICE_WIDTH - 82,
    height: 340,
    backgroundColor: "#fff",
  },
  pdfCompactPreview: {
    width: DEVICE_WIDTH - 74,
    height: 286,
    backgroundColor: "#fff",
  },
  pdfFullPreview: {
    width: DEVICE_WIDTH,
    height: DEVICE_HEIGHT - 172,
    backgroundColor: "#fff",
  },
  pdfPageBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    minHeight: 26,
    borderRadius: 8,
    paddingHorizontal: 9,
    backgroundColor: "rgba(15,23,42,0.76)",
    alignItems: "center",
    justifyContent: "center",
  },
  pdfPageBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },
  pdfRenderFallback: {
    width: DEVICE_WIDTH - 82,
    minHeight: 240,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg2,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  pdfRenderFallbackFull: {
    width: DEVICE_WIDTH - 42,
    minHeight: DEVICE_HEIGHT - 230,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#fff",
  },
  pdfFallbackTitle: {
    color: C.ink,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 12,
  },
  pdfFallbackText: {
    color: C.muted,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 7,
    fontWeight: "700",
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
    backgroundColor: C.surface,
    borderRadius: 14,
  },
  analysisHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  analysisCrossWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  analysisSavedRow: {
    minHeight: 36,
    borderRadius: 9,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 10,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  analysisSavedText: {
    flex: 1,
    color: C.green,
    fontSize: 11.8,
    lineHeight: 16,
    fontWeight: "800",
  },
  extractorPanel: {
    minHeight: 156,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    marginTop: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  extractorDocument: {
    width: 118,
    height: 128,
    borderRadius: 10,
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
    borderRadius: 8,
    backgroundColor: C.surface,
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
    borderRadius: 4,
    backgroundColor: "rgba(116,22,54,0.18)",
    marginTop: 18,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
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
    backgroundColor: C.surface,
    borderRadius: 14,
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
    borderRadius: 12,
    backgroundColor: "#101820",
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
  documentViewerShell: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    padding: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.055,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 2,
  },
  documentViewerTop: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  documentViewerLabel: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  documentViewerName: {
    maxWidth: 220,
    color: C.ink,
    fontSize: 13.5,
    fontWeight: "900",
    marginTop: 3,
  },
  documentViewer: {
    height: 390,
    borderRadius: 12,
    backgroundColor: "#101820",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  viewerImagePreview: {
    width: 270,
    height: 350,
    borderRadius: 10,
  },
  viewerTools: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  viewerTool: {
    flex: 1,
    height: 45,
    borderRadius: 10,
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
    gap: 10,
  },
  reportTextWrapLarge: {
    gap: 12,
  },
  reportBlock: {
    gap: 7,
    paddingTop: 2,
  },
  reportBlockSeparated: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  reportHeadingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 1,
  },
  reportHeadingAccent: {
    width: 4,
    height: 18,
    borderRadius: 4,
    backgroundColor: C.primary,
    marginTop: 2,
  },
  reportHeading: {
    color: C.ink,
    flex: 1,
    fontSize: 15.2,
    lineHeight: 21,
    fontWeight: "900",
  },
  reportHeadingLarge: {
    fontSize: 16.5,
    lineHeight: 23,
  },
  reportText: {
    color: C.text,
    fontSize: 13.3,
    lineHeight: 20,
    fontWeight: "600",
  },
  reportTextLarge: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
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
  reportNumberPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 7,
    backgroundColor: C.blush,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  reportNumberText: {
    color: C.primary,
    fontSize: 10.5,
    fontWeight: "900",
  },
  reportTableScroll: {
    marginTop: 4,
    marginBottom: 2,
  },
  reportTable: {
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 8,
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
  readMoreButton: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(122,23,56,0.12)",
    backgroundColor: "#FFF8FA",
    paddingHorizontal: 13,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  readMoreText: {
    color: C.primary,
    fontSize: 12.5,
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
    borderRadius: 10,
  },
  fullClose: {
    position: "absolute",
    top: topInset + 54,
    right: 24,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryModal: {
    flex: 1,
    backgroundColor: "#050A10",
    paddingTop: topInset + 28,
    paddingBottom: 26,
  },
  galleryModalTop: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  galleryTopButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryCounter: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  galleryModalPage: {
    minHeight: DEVICE_HEIGHT - 170,
    alignItems: "center",
    justifyContent: "center",
  },
  galleryModalImage: {
    width: DEVICE_WIDTH,
    height: DEVICE_HEIGHT - 190,
  },
  galleryPdfPreview: {
    width: DEVICE_WIDTH - 72,
    minHeight: 260,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  galleryPdfTitle: {
    color: C.ink,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 12,
  },
  galleryModalTools: {
    minHeight: 58,
    paddingHorizontal: 18,
    flexDirection: "row",
    gap: 10,
  },
  profileCard: {
    padding: 18,
    alignItems: "center",
  },
  profilePhoto: {
    width: 88,
    height: 88,
    borderRadius: 18,
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
  formPanel: {
    padding: 16,
    marginTop: 14,
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
    borderRadius: 10,
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
    backgroundColor: "rgba(15,23,42,0.42)",
    justifyContent: "flex-end",
  },
  uploadSheet: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    shadowColor: "#0F172A",
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 42,
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
    gap: 10,
    marginTop: 20,
  },
  uploadOption: {
    minHeight: 76,
    borderRadius: 10,
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
    borderRadius: 10,
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
    left: 18,
    right: 18,
    bottom: 14,
    height: 66,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: "#0F172A",
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 28,
    elevation: 5,
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
    backgroundColor: C.blush,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: -1,
  },
  navFab: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -28,
    shadowColor: C.primary,
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
});
