import axios, { AxiosError } from "axios";
import fs from "node:fs/promises";

export class AzureDocumentIntelligenceConfigurationError extends Error {}
export class AzureDocumentIntelligenceUnavailableError extends Error {}
export class AzureDocumentIntelligenceAnalyzeError extends Error {}

const AZURE_REQUEST_TIMEOUT_MS = 30000;

type AzureWord = {
  content?: string;
  confidence?: number;
};

type AzureLine = {
  content?: string;
  polygon?: number[];
  spans?: Array<{ offset?: number; length?: number }>;
};

type AzurePage = {
  pageNumber?: number;
  words?: AzureWord[];
  lines?: AzureLine[];
};

type AzureCell = {
  content?: string;
  rowIndex?: number;
  columnIndex?: number;
  rowSpan?: number;
  columnSpan?: number;
};

type AzureTable = {
  rowCount?: number;
  columnCount?: number;
  cells?: AzureCell[];
};

type AzureKeyValuePair = {
  key?: { content?: string };
  value?: { content?: string };
  confidence?: number;
};

export type AzureLayoutResult = {
  status: "ok";
  content: string;
  pages: Array<{
    page: number;
    text: string;
    confidence: number;
    lines: Array<{ text: string; polygon?: number[] }>;
  }>;
  tables: Array<{
    rowCount: number;
    columnCount: number;
    markdown: string;
  }>;
  keyValuePairs: Array<{
    key: string;
    value: string;
    confidence: number;
  }>;
  confidence: number;
  modelId: string;
  apiVersion: string;
};

function getAzureConfig() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  const apiVersion = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || "2024-11-30";

  if (!endpoint) {
    throw new AzureDocumentIntelligenceConfigurationError("Azure Document Intelligence endpoint is not configured.");
  }

  if (!key) {
    throw new AzureDocumentIntelligenceConfigurationError("Azure Document Intelligence key is not configured.");
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    key,
    apiVersion,
  };
}

function tableToMarkdown(table: AzureTable) {
  const rowCount = table.rowCount || 0;
  const columnCount = table.columnCount || 0;
  if (!rowCount || !columnCount || !Array.isArray(table.cells)) return "";

  const rows = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
  for (const cell of table.cells) {
    const row = Number(cell.rowIndex);
    const col = Number(cell.columnIndex);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row >= rowCount || col >= columnCount) continue;
    rows[row][col] = (cell.content || "").replace(/\s+/g, " ").trim();
  }

  const escapeCell = (value: string) => value.replace(/\|/g, "\\|");
  const header = rows[0] || [];
  const separator = header.map(() => "---");
  const body = rows.slice(1);
  return [header, separator, ...body]
    .map((row) => `| ${row.map(escapeCell).join(" | ")} |`)
    .join("\n");
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pageConfidence(page: AzurePage) {
  const values = (page.words || [])
    .map((word) => Number(word.confidence))
    .filter((value) => Number.isFinite(value));
  return average(values);
}

function normalizeAnalyzeResult(raw: Record<string, unknown>, apiVersion: string): AzureLayoutResult {
  const analyzeResult = raw.analyzeResult && typeof raw.analyzeResult === "object"
    ? raw.analyzeResult as Record<string, unknown>
    : raw;
  const content = typeof analyzeResult.content === "string" ? analyzeResult.content.trim() : "";
  const pages = Array.isArray(analyzeResult.pages) ? analyzeResult.pages as AzurePage[] : [];
  const tables = Array.isArray(analyzeResult.tables) ? analyzeResult.tables as AzureTable[] : [];
  const keyValuePairs = Array.isArray(analyzeResult.keyValuePairs)
    ? analyzeResult.keyValuePairs as AzureKeyValuePair[]
    : [];

  const normalizedPages = pages.map((page, index) => {
    const lines = (page.lines || [])
      .map((line) => ({
        text: (line.content || "").replace(/\s+/g, " ").trim(),
        polygon: line.polygon,
      }))
      .filter((line) => line.text);
    return {
      page: page.pageNumber || index + 1,
      text: lines.map((line) => line.text).join("\n"),
      confidence: pageConfidence(page),
      lines,
    };
  });
  const markdownTables = tables
    .map((table) => ({
      rowCount: table.rowCount || 0,
      columnCount: table.columnCount || 0,
      markdown: tableToMarkdown(table),
    }))
    .filter((table) => table.markdown);
  const pageConfidenceValues = normalizedPages
    .map((page) => page.confidence)
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    status: "ok",
    content,
    pages: normalizedPages,
    tables: markdownTables,
    keyValuePairs: keyValuePairs.map((pair) => ({
      key: (pair.key?.content || "").replace(/\s+/g, " ").trim(),
      value: (pair.value?.content || "").replace(/\s+/g, " ").trim(),
      confidence: Number(pair.confidence) || 0,
    })).filter((pair) => pair.key || pair.value),
    confidence: average(pageConfidenceValues),
    modelId: typeof analyzeResult.modelId === "string" ? analyzeResult.modelId : "prebuilt-layout",
    apiVersion,
  };
}

function isTerminalStatus(status: string) {
  return ["succeeded", "failed", "canceled"].includes(status.toLowerCase());
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function azureErrorMessage(error: unknown) {
  const axiosError = error as AxiosError<{ error?: { message?: string; code?: string } }>;
  return axiosError.response?.data?.error?.message
    || axiosError.response?.data?.error?.code
    || axiosError.message
    || "Azure Document Intelligence request failed.";
}

export async function analyzeDocumentWithAzureLayout(filePath: string): Promise<AzureLayoutResult> {
  const { endpoint, key, apiVersion } = getAzureConfig();
  const buffer = await fs.readFile(filePath);
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze`;

  try {
    const response = await axios.post(
      analyzeUrl,
      { base64Source: buffer.toString("base64") },
      {
        params: {
          _overload: "analyzeDocument",
          "api-version": apiVersion,
          features: "keyValuePairs",
          outputContentFormat: "markdown",
        },
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(AZURE_REQUEST_TIMEOUT_MS),
        timeout: AZURE_REQUEST_TIMEOUT_MS,
        validateStatus: (status) => status === 202,
      }
    );
    const operationLocation = response.headers["operation-location"];
    if (!operationLocation) {
      throw new AzureDocumentIntelligenceAnalyzeError("Azure did not return an Operation-Location header.");
    }

    for (let attempt = 0; attempt < 45; attempt += 1) {
      await sleep(attempt < 3 ? 1000 : 2000);
      const poll = await axios.get(operationLocation, {
        headers: {
          "Ocp-Apim-Subscription-Key": key,
        },
        signal: AbortSignal.timeout(AZURE_REQUEST_TIMEOUT_MS),
        timeout: AZURE_REQUEST_TIMEOUT_MS,
      });
      const status = String(poll.data?.status || "");
      if (!isTerminalStatus(status)) continue;
      if (status.toLowerCase() !== "succeeded") {
        throw new AzureDocumentIntelligenceAnalyzeError(`Azure analysis ${status || "failed"}.`);
      }
      return normalizeAnalyzeResult(poll.data, apiVersion);
    }

    throw new AzureDocumentIntelligenceAnalyzeError("Azure analysis timed out.");
  } catch (error) {
    if (error instanceof AzureDocumentIntelligenceAnalyzeError) throw error;
    const axiosError = error as AxiosError;
    if (axiosError.response || axiosError.request) {
      throw new AzureDocumentIntelligenceUnavailableError(azureErrorMessage(error));
    }
    throw error;
  }
}

export function isAzureDocumentIntelligenceConfigured() {
  return Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY);
}
