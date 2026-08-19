import type {
  AuditLogPage,
  Candidate,
  CandidatePage,
  ClassItem,
  Department,
  Exam,
  GenerationCreated,
  GenerationStatus,
  Gender,
  Hall,
  HallBench,
  HallSeat,
  IngestReport,
  PublicUser,
  SeatingPlan,
  Student,
  StudentPage,
  StudentStatus,
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

export async function resolveCandidate(
  documentId: string,
  candidateId: string,
): Promise<Candidate> {
  const res = await request<{ candidate: Candidate }>(
    `/exam-seating/documents/${encodeURIComponent(documentId)}/candidates/${encodeURIComponent(candidateId)}/resolve`,
    { method: "POST" },
  );
  return res.candidate;
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

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

export async function getAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return request<AuditLogPage>(`/exam-seating/audit-logs${qs ? `?${qs}` : ""}`);
}

export interface StudentListQuery {
  search?: string;
  departmentId?: string;
  classId?: string;
  status?: StudentStatus;
  limit?: number;
  offset?: number;
}

export async function listStudents(query: StudentListQuery = {}): Promise<StudentPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return request<StudentPage>(`/exam-seating/students${qs ? `?${qs}` : ""}`);
}

export async function getStudent(id: string): Promise<Student> {
  const res = await request<{ student: Student }>(`/exam-seating/students/${encodeURIComponent(id)}`);
  return res.student;
}

export interface StudentInput {
  name: string;
  rollNumber: string;
  registerNumber: string;
  gender: Gender;
  classId: string;
  status: StudentStatus;
}

export async function createStudent(input: StudentInput): Promise<Student> {
  const res = await request<{ student: Student }>("/exam-seating/students", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.student;
}

export async function updateStudent(id: string, patch: Partial<StudentInput>): Promise<Student> {
  const res = await request<{ student: Student }>(
    `/exam-seating/students/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return res.student;
}

export async function changeStudentStatus(id: string, status: StudentStatus): Promise<Student> {
  const res = await request<{ student: Student }>(
    `/exam-seating/students/${encodeURIComponent(id)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  return res.student;
}

export async function listDepartments(): Promise<Department[]> {
  const res = await request<{ departments: Department[] }>("/exam-seating/departments");
  return res.departments;
}

export async function createDepartment(input: { code: string; name: string }): Promise<Department> {
  const res = await request<{ department: Department }>("/exam-seating/departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.department;
}

export async function updateDepartment(
  id: string,
  patch: { code?: string; name?: string },
): Promise<Department> {
  const res = await request<{ department: Department }>(
    `/exam-seating/departments/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return res.department;
}

export interface ClassInput {
  departmentId: string;
  name: string;
  year: number;
  section: string;
  academicYear: string;
}

export async function listClasses(departmentId?: string): Promise<ClassItem[]> {
  const qs = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : "";
  const res = await request<{ classes: ClassItem[] }>(`/exam-seating/classes${qs}`);
  return res.classes;
}

export async function createClass(input: ClassInput): Promise<ClassItem> {
  const res = await request<{ class: ClassItem }>("/exam-seating/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.class;
}

export async function updateClass(id: string, patch: Partial<ClassInput>): Promise<ClassItem> {
  const res = await request<{ class: ClassItem }>(
    `/exam-seating/classes/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return res.class;
}

export async function listHalls(): Promise<Hall[]> {
  const res = await request<{ halls: Hall[] }>("/exam-seating/halls");
  return res.halls;
}

export interface HallInput {
  hallNumber: string;
  name: string;
  building?: string | null;
  rows: number;
  columns: number;
}

export async function createHall(input: HallInput): Promise<Hall> {
  const res = await request<{ hall: Hall }>("/exam-seating/halls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.hall;
}

export async function updateHall(
  id: string,
  patch: { name?: string; building?: string | null; isActive?: boolean },
): Promise<Hall> {
  const res = await request<{ hall: Hall }>(
    `/exam-seating/halls/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return res.hall;
}

export interface BenchInput {
  benchNumber: string;
  isActive?: boolean;
}

export async function listBenches(hallId: string): Promise<HallBench[]> {
  const res = await request<{ hallId: string; benches: HallBench[] }>(
    `/exam-seating/halls/${encodeURIComponent(hallId)}/benches`,
  );
  return res.benches;
}

export async function createBench(hallId: string, input: BenchInput): Promise<HallBench> {
  const res = await request<{ bench: HallBench }>(
    `/exam-seating/halls/${encodeURIComponent(hallId)}/benches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return res.bench;
}

export async function updateBench(
  id: string,
  patch: { benchNumber?: string; isActive?: boolean },
): Promise<HallBench> {
  const res = await request<{ bench: HallBench }>(
    `/exam-seating/benches/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return res.bench;
}

export async function setBenchActive(id: string, isActive: boolean): Promise<HallBench> {
  const res = await request<{ bench: HallBench }>(
    `/exam-seating/benches/${encodeURIComponent(id)}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    },
  );
  return res.bench;
}

export async function assignSeatToBench(benchId: string, hallSeatId: string): Promise<HallSeat> {
  const res = await request<{ hallSeat: HallSeat }>(
    `/exam-seating/benches/${encodeURIComponent(benchId)}/seats/${encodeURIComponent(hallSeatId)}`,
    { method: "POST" },
  );
  return res.hallSeat;
}

export async function removeSeatFromBench(
  benchId: string,
  hallSeatId: string,
): Promise<HallSeat> {
  const res = await request<{ hallSeat: HallSeat }>(
    `/exam-seating/benches/${encodeURIComponent(benchId)}/seats/${encodeURIComponent(hallSeatId)}`,
    { method: "DELETE" },
  );
  return res.hallSeat;
}