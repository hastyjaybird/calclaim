import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { ROOT } from "../config.js";

const MAX_LOGO_BYTES = 2_000_000;
const ALLOWED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export const PARTNER_LOGO_UPLOAD_DIR = path.join(
  ROOT,
  "public/brand/partners/uploads",
);

function ensureUploadDir(): void {
  fs.mkdirSync(PARTNER_LOGO_UPLOAD_DIR, { recursive: true });
}

/** Parse a multipart/form-data body for partner signup/profile (fields + optional logo). */
export async function readPartnerSignupMultipart(
  req: IncomingMessage,
  maxBytes = 2_500_000,
): Promise<{
  name: string;
  email: string;
  city: string;
  partnerId: string;
  editToken: string;
  accountType: string;
  logo?: { buffer: Buffer; mime: string; filename: string };
}> {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    throw new Error("multipart_boundary");
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const raw = await readRawBody(req, maxBytes);
  const parts = splitMultipart(raw, boundary);

  let name = "";
  let email = "";
  let city = "";
  let partnerId = "";
  let editToken = "";
  let accountType = "";
  let logo: { buffer: Buffer; mime: string; filename: string } | undefined;

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    const body = part.subarray(headerEnd + 4);
    // Strip trailing CRLF
    const payload =
      body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a
        ? body.subarray(0, body.length - 2)
        : body;

    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const field = nameMatch?.[1] ?? "";
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const filename = filenameMatch?.[1] ?? "";

    if (filename) {
      if (field !== "logo") continue;
      const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      const mime = (mimeMatch?.[1] || "").trim().toLowerCase();
      if (!ALLOWED_LOGO_TYPES.has(mime)) {
        throw new Error("logo_type");
      }
      if (payload.length > MAX_LOGO_BYTES) {
        throw new Error("logo_too_large");
      }
      if (payload.length === 0) continue;
      logo = { buffer: Buffer.from(payload), mime, filename };
      continue;
    }

    const text = payload.toString("utf8").trim();
    if (field === "name") name = text.slice(0, 120);
    else if (field === "email") email = text.slice(0, 200).toLowerCase();
    else if (field === "city") city = text.slice(0, 80);
    else if (field === "accountType" || field === "account_type") {
      accountType = text.slice(0, 40).toLowerCase();
    } else if (field === "partnerId" || field === "partner_id") {
      partnerId = text.slice(0, 40).toLowerCase();
    } else if (field === "editToken" || field === "edit_token") {
      editToken = text.slice(0, 200);
    }
  }

  return { name, email, city, partnerId, editToken, accountType, logo };
}

export function savePartnerLogoUpload(
  partnerId: string,
  logo: { buffer: Buffer; mime: string; filename: string },
): string {
  ensureUploadDir();
  const ext =
    logo.mime === "image/png"
      ? ".png"
      : logo.mime === "image/webp"
        ? ".webp"
        : logo.mime === "image/gif"
          ? ".gif"
          : ".jpg";
  const safeId = partnerId.replace(/[^a-zA-Z0-9-]/g, "");
  const fileName = `${safeId}${ext}`;
  const abs = path.join(PARTNER_LOGO_UPLOAD_DIR, fileName);
  fs.writeFileSync(abs, logo.buffer);
  return `/brand/partners/uploads/${fileName}`;
}

function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function splitMultipart(buf: Buffer, boundary: string): Buffer[] {
  const delim = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = indexOf(buf, delim, 0);
  if (start < 0) return parts;
  start += delim.length;
  // skip optional leading CRLF after first boundary
  if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;

  while (start < buf.length) {
    const next = indexOf(buf, delim, start);
    if (next < 0) break;
    // part ends just before CRLF--boundary
    let end = next;
    if (end >= 2 && buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
    const slice = buf.subarray(start, end);
    // closing boundary is --boundary--
    const after = buf.subarray(next + delim.length, next + delim.length + 2);
    if (after[0] === 0x2d && after[1] === 0x2d) {
      if (slice.length) parts.push(slice);
      break;
    }
    if (slice.length) parts.push(slice);
    start = next + delim.length;
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
  }
  return parts;
}

function indexOf(hay: Buffer, needle: Buffer, from: number): number {
  return hay.indexOf(needle, from);
}
