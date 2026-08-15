/**
 * Phase 4 — authoritative validation & merge (§11, §12).
 *
 * Node re-verifies every domain result before accepting it (the frozen engine
 * is the solver, but Node is the persistence gate). Merge validation prevents
 * a partially-valid generation from ever being published.
 */
import type {
  DomainCandidate,
  DomainHall,
  DomainPlan,
  DomainRunRecord,
  DomainSolveResult,
  MergeValidation,
} from "./types";

export interface DomainValidation {
  valid: boolean;
  structuralErrors: string[];
  assignedCount: number;
  candidateCount: number;
  duplicateCandidateIds: string[];
  duplicateSeatIds: string[];
  seatsOutsideDomain: string[];
  objectiveMatchesValidator: boolean;
}

export function validateDomainResult(
  plan: DomainPlan,
  result: DomainSolveResult,
): DomainValidation {
  const errors: string[] = [];
  if (result.status !== "OPTIMAL" && result.status !== "FEASIBLE") {
    return {
      valid: false,
      structuralErrors: [`domain status ${result.status} is not acceptable`],
      assignedCount: result.assignedCount,
      candidateCount: result.candidateCount,
      duplicateCandidateIds: [],
      duplicateSeatIds: [],
      seatsOutsideDomain: [],
      objectiveMatchesValidator: false,
    };
  }

  if (result.assignedCount !== result.candidateCount) {
    errors.push(
      `assignedCount ${result.assignedCount} != candidateCount ${result.candidateCount}`,
    );
  }
  if (result.unassignedCount !== 0) {
    errors.push(`unassignedCount ${result.unassignedCount} != 0`);
  }

  const assignedCandidateIds = result.assignments.map((a) => a.candidateId);
  const duplicateCandidateIds = findDuplicates(assignedCandidateIds);
  const assignedSeatIds = result.assignments.map((a) => a.hallSeatId);
  const duplicateSeatIds = findDuplicates(assignedSeatIds);

  const validSeatIds = new Set(plan.seats.map((s) => s.id));
  const seatsOutsideDomain = result.assignments
    .map((a) => a.hallSeatId)
    .filter((seatId) => !validSeatIds.has(seatId));

  const expectedCandidateIds = new Set(plan.candidates.map((c) => c.id));
  const candidatesMissing = plan.candidates.filter(
    (c) => !assignedCandidateIds.includes(c.id),
  ).length;

  const objectiveMatchesValidator =
    result.reportedObjective !== null &&
    result.reportedObjective === result.validatorObjective;

  if (duplicateCandidateIds.length > 0) {
    errors.push(`duplicate candidate ids: ${duplicateCandidateIds.join(", ")}`);
  }
  if (duplicateSeatIds.length > 0) {
    errors.push(`duplicate seat ids: ${duplicateSeatIds.join(", ")}`);
  }
  if (seatsOutsideDomain.length > 0) {
    errors.push(`seats outside domain: ${seatsOutsideDomain.join(", ")}`);
  }
  if (candidatesMissing !== 0) {
    errors.push(`${candidatesMissing} domain candidates not assigned`);
  }
  if (!objectiveMatchesValidator) {
    errors.push("reported objective != validator objective");
  }

  return {
    valid: errors.length === 0,
    structuralErrors: errors,
    assignedCount: result.assignedCount,
    candidateCount: result.candidateCount,
    duplicateCandidateIds,
    duplicateSeatIds,
    seatsOutsideDomain,
    objectiveMatchesValidator,
  };
}

export function validateMerge(
  records: DomainRunRecord[],
  sessionCandidates: DomainCandidate[],
  halls: DomainHall[],
): MergeValidation {
  const allCandidateIds: string[] = [];
  const allSeatIds: string[] = [];
  const domainHallIds = new Map<string, string[]>();
  const unknownDomainIds: string[] = [];

  for (const record of records) {
    if (!record.plan) continue;
    const planHallIds = record.plan.hallIds;
    if (domainHallIds.has(record.domainId) && !sameSet(domainHallIds.get(record.domainId)!, planHallIds)) {
      unknownDomainIds.push(record.domainId);
    }
    domainHallIds.set(record.domainId, planHallIds);
    for (const assignment of record.result?.assignments ?? []) {
      allCandidateIds.push(assignment.candidateId);
      allSeatIds.push(assignment.hallSeatId);
    }
  }

  const duplicateCandidateIds = findDuplicates(allCandidateIds);
  const duplicateSeatIds = findDuplicates(allSeatIds);

  const hallSeatOwner = new Map<string, string>();
  for (const hall of halls) {
    for (const seat of hall.seats) hallSeatOwner.set(seat.id, hall.id);
  }

  // Every assignment's seat must be owned by a hall, and that hall must be a
  // hall of the assignment's domain.
  const foreignSeats: string[] = [];
  for (const record of records) {
    if (!record.plan) continue;
    const ownedHalls = new Set(record.plan.hallIds);
    for (const assignment of record.result?.assignments ?? []) {
      const ownerHall = hallSeatOwner.get(assignment.hallSeatId);
      if (ownerHall === undefined) {
        foreignSeats.push(assignment.hallSeatId);
        continue;
      }
      if (assignment.hallId !== ownerHall || !ownedHalls.has(ownerHall)) {
        foreignSeats.push(assignment.hallSeatId);
      }
    }
  }

  const sessionCandidateIds = new Set(sessionCandidates.map((c) => c.id));
  const missingCandidateCount = sessionCandidates.filter(
    (c) => !allCandidateIds.includes(c.id),
  ).length;

  // Cross-domain adjacency: with cross-hall adjacency forbidden, a seat may
  // only be owned by one hall/domain. Two domains sharing a hall is the only
  // detectable cross-domain conflict; adjacency itself never spans domains
  // (guaranteed by partition invariants, re-verified here at the seat level).
  const hallUseByDomain = new Map<string, Set<string>>();
  let crossDomainAdjacencyDetected = false;
  for (const record of records) {
    if (!record.plan) continue;
    for (const hallId of record.plan.hallIds) {
      const users = hallUseByDomain.get(hallId) ?? new Set<string>();
      users.add(record.domainId);
      hallUseByDomain.set(hallId, users);
      if (users.size > 1) crossDomainAdjacencyDetected = true;
    }
  }

  const assignedCandidateCount = allCandidateIds.length;
  const valid =
    assignedCandidateCount === sessionCandidateIds.size &&
    duplicateCandidateIds.length === 0 &&
    duplicateSeatIds.length === 0 &&
    unknownDomainIds.length === 0 &&
    foreignSeats.length === 0 &&
    missingCandidateCount === 0 &&
    !crossDomainAdjacencyDetected;

  return {
    sessionCandidateCount: sessionCandidateIds.size,
    assignedCandidateCount,
    duplicateCandidateIds,
    duplicateSeatIds,
    unknownDomainIds,
    missingCandidateCount,
    crossDomainAdjacencyDetected,
    valid,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((x) => setA.has(x));
}

export function findDuplicates(items: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) duplicates.add(item);
    seen.add(item);
  }
  return [...duplicates];
}