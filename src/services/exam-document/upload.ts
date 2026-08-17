import { getSupabaseClient } from "../../supabase.js";
import { createHash } from "node:crypto";

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export const MAX_FILE_NAME_LENGTH = 255;

/**
 * Phase 9 — display-name control for client-supplied filenames (ingestion
 * security review §1–§4). The storage KEY is sanitized separately by
 * buildStoragePath; this function governs the fileName persisted into
 * UploadedExamDocument.fileName.
 */
export function sanitizeFileName(value: string): string {
  let out = value.normalize("NFC");
  // C0/C1 controls, bidi controls (ALM, LRM, RLM, embeddings/overrides,
  // isolates) are stripped; whitespace is collapsed.
  out = out.replace(
    /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
    "",
  );
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > MAX_FILE_NAME_LENGTH) out = out.slice(0, MAX_FILE_NAME_LENGTH);
  return out.length === 0 ? "document.pdf" : out;
}

export interface StorageUpload {
  ok: true;
  key: string;
  bytes: number;
}

export interface StorageAttr {
  ok: true;
  key: string;
  storageType: string;
  size: number;
  sha256: string;
}

export class MemoryDocumentStore {
  private files = new Map<string, { bytes: Uint8Array; sha256: string }>();

  async put(path: string, bytes: Uint8Array): Promise<StorageUpload> {
    const snapshot = new Uint8Array(bytes);
    const digest = sha256(snapshot);
    this.files.set(path, { bytes: snapshot, sha256: digest });
    return { ok: true, key: path, bytes: bytes.length };
  }

  async get(path: string): Promise<Uint8Array | null> {
    const file = this.files.get(path);
    return file ? file.bytes : null;
  }

  async metadata(path: string): Promise<StorageAttr | null> {
    const file = this.files.get(path);
    if (!file) return null;
    return {
      ok: true,
      key: path,
      storageType: "memory",
      size: file.bytes.length,
      sha256: file.sha256,
    };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async delete(path: string): Promise<boolean> {
    return this.files.delete(path);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }
}

export class SupabaseDocumentStore {
  private readonly bucket: string;
  private storage?: ReturnType<typeof getSupabaseClient>["storage"];

  private getStorage(): ReturnType<typeof getSupabaseClient>["storage"] {
    this.storage ??= getSupabaseClient().storage;
    return this.storage;
  }

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  private validateBucket(bucket: string): void {
    if (!bucket || bucket.length === 0) {
      throw new Error("Supabase bucket name must not be empty");
    }
  }

  async put(path: string, bytes: Uint8Array): Promise<StorageUpload> {
    this.validateBucket(this.bucket);
    const { error } = await this.getStorage().from(this.bucket).upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) throw new Error(`Upload to storage failed: ${error.message}`);
    return { ok: true, key: path, bytes: bytes.length };
  }

  async signedUrl(path: string, expiresInSeconds = 60): Promise<string> {
    this.validateBucket(this.bucket);
    const { data, error } = await this.getStorage()
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) throw new Error(`Signed URL creation failed: ${error.message}`);
    return data.signedUrl;
  }

  async get(path: string): Promise<Uint8Array | null> {
    this.validateBucket(this.bucket);
    const { data, error } = await this.getStorage().from(this.bucket).download(path);
    if (error) {
      if (error.message.includes("Object not found")) return null;
      throw new Error(`Storage download failed: ${error.message}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async metadata(path: string): Promise<StorageAttr | null> {
    this.validateBucket(this.bucket);
    const { data, error } = await this.getStorage().from(this.bucket).info(path);
    if (error) {
      if (error.message.includes("Object not found")) return null;
      throw new Error(`Storage info failed: ${error.message}`);
    }
    return {
      ok: true,
      key: path,
      storageType: "supabase",
      size: data.size ?? 0,
      sha256: "",
    };
  }

  async exists(path: string): Promise<boolean> {
    this.validateBucket(this.bucket);
    const { error } = await this.getStorage().from(this.bucket).info(path);
    if (!error) return true;
    if (error.message.includes("Object not found")) return false;
    throw new Error(`Storage info failed: ${error.message}`);
  }

  async delete(path: string): Promise<boolean> {
    this.validateBucket(this.bucket);
    const { error } = await this.getStorage().from(this.bucket).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
    return true;
  }
}

export async function metadataSha256(
  store: MemoryDocumentStore | SupabaseDocumentStore,
  path: string,
): Promise<string | null> {
  if (store instanceof MemoryDocumentStore) {
    const meta = await store.metadata(path);
    return meta ? meta.sha256 : null;
  }
  const bytes = await store.get(path);
  return bytes ? sha256(bytes) : null;
}