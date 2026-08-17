import type {
  CandidatePage,
  Exam,
  GenerationCreated,
  GenerationStatus,
  IngestReport,
  PublicUser,
  SeatingPlan,
  UploadedDocument,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "include", ...init });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Unable to reach the server");
  }
  if (response.ok) {
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(response.status, "INVALID_RESPONSE", "Server returned an unexpected response");
    }
  }
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred";
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (body.error) code = body.error;
    if (body.message) message = body.message;
  } catch {
    // non-JSON error body; keep the generic fallback
  }
  throw new ApiError(response.status, code, message);
}

export async function login(username: string, password: string): Promise<PublicUser> {
  const res = await request<{ user: PublicUser }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.user;
}

export async function logout(): Promise<void> {
  await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export async function getMe(): Promise<PublicUser | null> {
  try {
    const res = await request<{ user: PublicUser }>("/auth/me");
    return res.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export interface UploadFileInput {
  name: string;
  data: Uint8Array;
}

// The backend reads the original filename from X-File-Name and applies its own
// authoritative sanitization at the persistence boundary. Browsers forbid most
// non-printable and non-Latin-1 bytes in header values, so we only strip those
// client-side (UX hygiene); the backend remains the authority.
function headerSafeFileName(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7E]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "document.pdf";
}

export async function uploadDocument(
  examId: string,
  file: UploadFileInput,
): Promise<IngestReport> {
  return request<IngestReport>(
    `/exam-seating/documents?examId=${encodeURIComponent(examId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-File-Name": headerSafeFileName(file.name),
      },
      body: file.data as BodyInit,
    },
  );
}

export async function getDocument(id: string): Promise<UploadedDocument> {
  const res = await request<{ document: UploadedDocument }>(`/exam-seating/documents/${encodeURIComponent(id)}`);
  return res.document;
}

export async function getDocumentCandidates(
  id: string,
  limit: number,
  offset: number,
): Promise<CandidatePage> {
  const query = `limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
  return request<CandidatePage>(
    `/exam-seating/documents/${encodeURIComponent(id)}/candidates?${query}`,
  );
}

export async function getExams(): Promise<Exam[]> {
  const res = await request<{ exams: Exam[] }>("/exam-seating/exams");
  return res.exams;
}

export async function generateSeating(examId: string): Promise<GenerationCreated> {
  return request<GenerationCreated>("/exam-seating/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ examId }),
  });
}

export async function getGenerationStatus(generationId: string): Promise<GenerationStatus> {
  return request<GenerationStatus>(
    `/exam-seating/generations/${encodeURIComponent(generationId)}`,
  );
}

export async function getSeatingPlan(seatingPlanId: string): Promise<SeatingPlan> {
  const res = await request<{ plan: SeatingPlan }>(
    `/exam-seating/plans/${encodeURIComponent(seatingPlanId)}`,
  );
  return res.plan;
}

export async function approveSeatingPlan(seatingPlanId: string): Promise<SeatingPlan> {
  const res = await request<{ plan: SeatingPlan }>(
    `/exam-seating/plans/${encodeURIComponent(seatingPlanId)}/approve`,
    { method: "POST" },
  );
  return res.plan;
}

export async function publishSeatingPlan(seatingPlanId: string): Promise<SeatingPlan> {
  const res = await request<{ plan: SeatingPlan }>(
    `/exam-seating/plans/${encodeURIComponent(seatingPlanId)}/publish`,
    { method: "POST" },
  );
  return res.plan;
}