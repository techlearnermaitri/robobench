"use strict";

const {
  StorageSharedKeyCredential,
  ContainerClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require("@azure/storage-blob");

const CONTAINER = "artifacts";
let cached; // undefined = not loaded yet, null = not configured

// Reads the connection string from the environment (deployed) or from
// azureConfig.json next to this file (local, gitignored).
function load() {
  if (cached !== undefined) return cached;

  let conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) {
    try {
      conn = require("./azureConfig.json").connectionString;
    } catch (e) {
      conn = null;
    }
  }
  if (!conn) return (cached = null);

  const parts = {};
  conn.split(";").forEach((seg) => {
    const i = seg.indexOf("=");
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  });
  if (!parts.AccountName || !parts.AccountKey) return (cached = null);

  const suffix = parts.EndpointSuffix || "core.windows.net";
  cached = {
    accountName: parts.AccountName,
    credential: new StorageSharedKeyCredential(parts.AccountName, parts.AccountKey),
    baseUrl: `https://${parts.AccountName}.blob.${suffix}/${CONTAINER}`,
  };
  return cached;
}

function isConfigured() {
  return load() !== null;
}

// mode: "write" (create + write, one file) or "read" (download).
function makeSasUrl(blobPath, mode, minutes) {
  const az = load();
  if (!az) throw new Error("Azure storage is not configured");

  const opts = {
    containerName: CONTAINER,
    blobName: blobPath,
    permissions: BlobSASPermissions.parse(mode === "write" ? "cw" : "r"),
    startsOn: new Date(Date.now() - 5 * 60 * 1000), // allow for clock skew
    expiresOn: new Date(Date.now() + minutes * 60 * 1000),
    protocol: SASProtocol.Https,
  };
  if (mode === "read") opts.contentDisposition = "attachment";

  const sas = generateBlobSASQueryParameters(opts, az.credential).toString();
  const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
  return `${az.baseUrl}/${encodedPath}?${sas}`;
}

async function blobExists(blobPath) {
  const az = load();
  if (!az) throw new Error("Azure storage is not configured");
  const container = new ContainerClient(az.baseUrl, az.credential);
  return container.getBlobClient(blobPath).exists();
}

module.exports = { isConfigured, makeSasUrl, blobExists, CONTAINER };
