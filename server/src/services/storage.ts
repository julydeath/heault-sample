import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";

export type StoredOriginal = {
  provider: "local" | "azure_blob";
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  container?: string;
  url?: string;
  fallbackReason?: string;
};

export type StoredOriginalRead = {
  stream: NodeJS.ReadableStream;
  mimeType: string;
  size?: number;
  fileName: string;
};

function safeSegment(value = "file") {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "file";
}

function azureContainerName() {
  return (
    process.env.AZURE_STORAGE_CONTAINER
    || process.env.AZURE_BLOB_CONTAINER
    || process.env.AZURE_STORAGE_CONTAINER_NAME
    || "heault-originals"
  ).trim();
}

function localStorageRoot() {
  return path.resolve(__dirname, "..", "..", "storage");
}

function storageProviderPreference() {
  const provider = String(process.env.STORAGE_PROVIDER || "").trim().toLowerCase();
  if (["azure", "azure_blob", "blob"].includes(provider)) return "azure_blob";
  if (provider === "local") return "local";
  return "auto";
}

function azureBlobServiceClient() {
  const connectionString = (
    process.env.AZURE_STORAGE_CONNECTION_STRING
    || process.env.AZURE_BLOB_CONNECTION_STRING
    || ""
  ).trim();

  if (connectionString) {
    return BlobServiceClient.fromConnectionString(connectionString);
  }

  const accountName = (
    process.env.AZURE_STORAGE_ACCOUNT_NAME
    || process.env.AZURE_BLOB_ACCOUNT_NAME
    || ""
  ).trim();
  const accountKey = (
    process.env.AZURE_STORAGE_ACCOUNT_KEY
    || process.env.AZURE_BLOB_ACCOUNT_KEY
    || ""
  ).trim();

  if (!accountName || !accountKey) return null;

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  return new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
}

export function isAzureBlobConfigured() {
  return Boolean(
    process.env.AZURE_STORAGE_CONNECTION_STRING
    || process.env.AZURE_BLOB_CONNECTION_STRING
    || (
      (process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.AZURE_BLOB_ACCOUNT_NAME)
      && (process.env.AZURE_STORAGE_ACCOUNT_KEY || process.env.AZURE_BLOB_ACCOUNT_KEY)
    )
  );
}

export function storageStatus() {
  return {
    provider: storageProviderPreference(),
    azureBlobConfigured: isAzureBlobConfigured(),
    azureContainer: azureContainerName(),
    localStorageRoot: localStorageRoot(),
  };
}

async function saveOriginalFileLocally({
  sourcePath,
  fileName,
  mimeType,
  documentId,
  fallbackReason,
}: {
  sourcePath: string;
  fileName: string;
  mimeType: string;
  documentId?: string;
  fallbackReason?: string;
}): Promise<StoredOriginal> {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const id = safeSegment(documentId || crypto.randomUUID());
  const name = safeSegment(fileName || "medical-document");
  const baseDir = path.resolve(localStorageRoot(), "originals", yyyy, mm);
  await fs.mkdir(baseDir, { recursive: true });
  const storageKey = path.join("originals", yyyy, mm, `${id}-${name}`);
  const targetPath = path.resolve(localStorageRoot(), storageKey);
  await fs.copyFile(sourcePath, targetPath);
  const stat = await fs.stat(targetPath);

  return {
    provider: "local",
    storageKey,
    fileName: name,
    mimeType,
    size: stat.size,
    fallbackReason,
  };
}

async function saveOriginalFileToAzureBlob({
  sourcePath,
  fileName,
  mimeType,
  documentId,
}: {
  sourcePath: string;
  fileName: string;
  mimeType: string;
  documentId?: string;
}): Promise<StoredOriginal> {
  const client = azureBlobServiceClient();
  if (!client) {
    throw new Error("Azure Blob Storage is not configured.");
  }

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const id = safeSegment(documentId || crypto.randomUUID());
  const name = safeSegment(fileName || "medical-document");
  const blobName = `originals/${yyyy}/${mm}/${id}/${crypto.randomUUID()}-${name}`;
  const container = azureContainerName();
  const containerClient = client.getContainerClient(container);
  await containerClient.createIfNotExists();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadFile(sourcePath, {
    blobHTTPHeaders: {
      blobContentType: mimeType || "application/octet-stream",
    },
  });
  const properties = await blockBlobClient.getProperties();

  return {
    provider: "azure_blob",
    storageKey: blobName,
    container,
    url: blockBlobClient.url,
    fileName: name,
    mimeType,
    size: properties.contentLength || (await fs.stat(sourcePath)).size,
  };
}

export async function saveOriginalFile({
  sourcePath,
  fileName,
  mimeType,
  documentId,
}: {
  sourcePath: string;
  fileName: string;
  mimeType: string;
  documentId?: string;
}): Promise<StoredOriginal> {
  const provider = storageProviderPreference();
  if (provider === "local") {
    return saveOriginalFileLocally({ sourcePath, fileName, mimeType, documentId });
  }

  if (!isAzureBlobConfigured()) {
    if (provider === "azure_blob") {
      throw new Error("Azure Blob Storage is selected but not configured.");
    }
    return saveOriginalFileLocally({ sourcePath, fileName, mimeType, documentId });
  }

  try {
    return await saveOriginalFileToAzureBlob({ sourcePath, fileName, mimeType, documentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Azure Blob upload failed.";
    console.warn(JSON.stringify({
      event: "azure_blob_upload_failed",
      error: message,
      at: new Date().toISOString(),
    }));
    if (provider === "azure_blob") {
      throw new Error(`Azure Blob upload failed: ${message}`);
    }
    return saveOriginalFileLocally({
      sourcePath,
      fileName,
      mimeType,
      documentId,
      fallbackReason: "Azure Blob upload failed; original saved to local server storage.",
    });
  }
}

export async function readStoredOriginal(original: StoredOriginal): Promise<StoredOriginalRead> {
  if (original.provider === "azure_blob") {
    const client = azureBlobServiceClient();
    if (!client) {
      throw new Error("Azure Blob Storage is not configured.");
    }
    const containerClient = client.getContainerClient(original.container || azureContainerName());
    const blobClient = containerClient.getBlobClient(original.storageKey);
    const response = await blobClient.download(0);
    if (!response.readableStreamBody) {
      throw new Error("Azure Blob did not return a readable stream.");
    }
    return {
      stream: response.readableStreamBody,
      mimeType: response.contentType || original.mimeType || "application/octet-stream",
      size: response.contentLength,
      fileName: original.fileName || "medical-document",
    };
  }

  const storageRoot = localStorageRoot();
  const targetPath = path.resolve(storageRoot, original.storageKey);
  if (!targetPath.startsWith(storageRoot)) {
    throw new Error("Invalid local storage path.");
  }
  const stat = await fs.stat(targetPath);
  return {
    stream: createReadStream(targetPath),
    mimeType: original.mimeType || "application/octet-stream",
    size: stat.size,
    fileName: original.fileName || "medical-document",
  };
}
