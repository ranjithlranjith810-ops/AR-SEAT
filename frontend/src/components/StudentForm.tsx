import { useMemo, useState } from "react";
import { ApiError, createStudent, updateStudent } from "../lib/api";
import type { ClassItem, Department, Gender, Student, StudentStatus } from "../lib/types";
import { STUDENT_STATUSES } from "../lib/types";

export interface StudentFormProps {
  initial: Student | null;
  departments: Department[];
  classes: ClassItem[];
  onCancel: () => void;
  onSaved: (student: Student) => void;
  onError: (message: string) => void;
}

const GENDERS: Gender[] = ["MALE", "FEMALE", "OTHER"];

export function StudentForm({
  initial,
  departments,
  classes,
  onCancel,
  onSaved,
  onError,
}: StudentFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [registerNumber, setRegisterNumber] = useState(initial?.registerNumber ?? "");
  const [rollNumber, setRollNumber] = useState(initial?.rollNumber ?? "");
  const [gender, setGender] = useState<Gender>(initial?.gender ?? "MALE");
  const [departmentId, setDepartmentId] = useState(
    initial?.class.department.id ?? (departments[0]?.id ?? ""),
  );
  const [classId, setClassId] = useState(initial?.classId ?? "");
  const [status, setStatus] = useState<StudentStatus>(initial?.status ?? "ACTIVE");
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const filteredClasses = useMemo(
    () => classes.filter((cls) => cls.departmentId === departmentId),
    [classes, departmentId],
  );

  function validate(): string | null {
    if (name.trim().length === 0) return "Name is required.";
    if (registerNumber.trim().length === 0) return "Register number is required.";
    if (rollNumber.trim().length === 0) return "Roll number is required.";
    if (!classId) return "Select a class for this student.";
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setValidation(null);
    const problem = validate();
    if (problem) {
      setValidation(problem);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        registerNumber: registerNumber.trim(),
        rollNumber: rollNumber.trim(),
        gender,
        classId,
        status,
      };
      const saved = initial
        ? await updateStudent(initial.id, payload)
        : await createStudent(payload);
      onSaved(saved);
    } catch (err) {
      onError(safeFormError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit} aria-label="Student form">
      <h2>{initial ? `Edit ${initial.registerNumber}` : "Add student"}</h2>

      {validation && (
        <div className="alert alert--danger" role="alert">
          <div className="alert__title">Error</div>
          <div className="alert__body">{validation}</div>
        </div>
      )}

      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Name"
        />
      </label>

      <label className="field">
        <span>Register number</span>
        <input
          type="text"
          value={registerNumber}
          onChange={(event) => setRegisterNumber(event.target.value)}
          aria-label="Register number"
        />
      </label>

      <label className="field">
        <span>Roll number</span>
        <input
          type="text"
          value={rollNumber}
          onChange={(event) => setRollNumber(event.target.value)}
          aria-label="Roll number"
        />
      </label>

      <label className="field">
        <span>Gender</span>
        <select value={gender} onChange={(event) => setGender(event.target.value as Gender)}>
          {GENDERS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Department</span>
        <select
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
            setClassId("");
          }}
        >
          <option value="" disabled>
            Select department
          </option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.code} — {department.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Class</span>
        <select value={classId} onChange={(event) => setClassId(event.target.value)}>
          <option value="" disabled>
            Select class
          </option>
          {filteredClasses.map((cls) => (
            <option key={cls.id} value={cls.id}>
              {cls.name} ({cls.year}) — {cls.academicYear}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as StudentStatus)}>
          {STUDENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={submitting}>
          {initial ? "Save changes" : "Create student"}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function safeFormError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "STUDENT_ALREADY_EXISTS":
        return "That register number already exists. Student records must be unique.";
      case "CLASS_NOT_FOUND":
        return "The selected class no longer exists. Reload the page and try again.";
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "FORBIDDEN":
        return "You do not have permission to manage students.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}