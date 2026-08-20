import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  changeStudentStatus,
  listClasses,
  listDepartments,
  listStudents,
} from "../lib/api";
import type { ClassItem, Department, Student, StudentStatus } from "../lib/types";
import { STUDENT_STATUSES } from "../lib/types";
import { Alert, PageLoader } from "./ui";
import { StudentForm } from "./StudentForm";

const PAGE_SIZE = 20;

export function StudentsPage() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);

  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listDepartments(), listClasses()])
      .then(([depts, cls]) => {
        if (cancelled) return;
        setDepartments(depts);
        setClasses(cls);
      })
      .catch(() => {
        // Options are optional; the table load below surfaces the real error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listStudents({
      search: appliedSearch || undefined,
      departmentId: departmentId || undefined,
      classId: classId || undefined,
      status: (status || undefined) as StudentStatus | undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((page) => {
        if (cancelled) return;
        setStudents(page.students);
        setTotal(page.total);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safeStudentsError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedSearch, departmentId, classId, status, offset, reloadKey]);

  function applyFilters() {
    setOffset(0);
    setAppliedSearch(search.trim());
    setReloadKey((k) => k + 1);
  }

  function resetFilters() {
    setSearch("");
    setAppliedSearch("");
    setDepartmentId("");
    setClassId("");
    setStatus("");
    setOffset(0);
    setReloadKey((k) => k + 1);
  }

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(student: Student) {
    setEditing(student);
    setFormError(null);
    setShowForm(true);
  }

  async function handleStatusChange(student: Student, next: StudentStatus) {
    setError(null);
    try {
      const updated = await changeStudentStatus(student.id, next);
      setStudents((rows) =>
        rows?.map((row) => (row.id === updated.id ? updated : row)) ?? null,
      );
      setNotice(`${student.registerNumber} → ${next}`);
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setError(safeStudentsError(err));
    }
  }

  if (loading && !students) return <PageLoader label="Loading students..." />;

  if (error && !students) {
    return (
      <div className="panel">
        <h1>Student Master</h1>
        <Alert variant="danger">{error}</Alert>
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!students) return null;

  const hasNext = offset + students.length < total;
  const hasPrev = offset > 0;

  return (
    <div className="panel">
      <h1>Student Master</h1>
      <p className="muted">
        Maintain the student records that candidate PDFs are validated against.
      </p>

      <div className="form-actions">
        <button type="button" className="button button--primary" onClick={openCreate}>
          Add student
        </button>
        {showForm && (
          <span>
            <StudentForm
              key={editing?.id ?? "new"}
              initial={editing}
              departments={departments}
              classes={classes}
              onCancel={() => setShowForm(false)}
              onSaved={(student) => {
                setShowForm(false);
                setNotice(`${student.registerNumber} saved`);
                setTimeout(() => setNotice(null), 4000);
                setReloadKey((k) => k + 1);
              }}
              onError={(message) => setFormError(message)}
            />
          </span>
        )}
      </div>

      {formError && <Alert variant="danger">{formError}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <form
        className="audit-filters"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label className="field">
          <span>Search</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, register number, roll number"
          />
        </label>
        <label className="field">
          <span>Department</span>
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">Any</option>
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
            <option value="">Any</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.department.code} / {cls.name} ({cls.academicYear})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any</option>
            {STUDENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions audit-filters__actions">
          <button type="submit" className="button button--primary">
            Apply
          </button>
          <button type="button" className="button button--ghost" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </form>

      {error && <Alert variant="danger">{error}</Alert>}

      {students.length === 0 ? (
        <Alert variant="info">No students match the current filters.</Alert>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Register number</th>
                <th>Roll number</th>
                <th>Department</th>
                <th>Class</th>
                <th>Gender</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td>{student.name}</td>
                  <td className="mono">{student.registerNumber}</td>
                  <td className="mono">{student.rollNumber}</td>
                  <td>{student.class.department.code}</td>
                  <td>
                    {student.class.name} ({student.class.academicYear})
                  </td>
                  <td>{student.gender}</td>
                  <td>
                    <span className={`status-badge status-badge--${student.status.toLowerCase()}`}>
                      {student.status}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => openEdit(student)}
                    >
                      Edit
                    </button>
                    <label className="field" style={{ display: "inline-flex", marginBottom: 0 }}>
                      <select
                        aria-label={`Status for ${student.registerNumber}`}
                        value={student.status}
                        onChange={(event) =>
                          handleStatusChange(student, event.target.value as StudentStatus)
                        }
                      >
                        {STUDENT_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <p className="pagination__summary">
          Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + students.length, total)} of {total}
        </p>
        <div className="pagination__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={!hasPrev}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={!hasNext}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function safeStudentsError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "FORBIDDEN":
        return "You do not have permission to manage students.";
      case "STUDENT_ALREADY_EXISTS":
        return "That register number already exists. Student records must be unique.";
      case "NETWORK_ERROR":
        return "Unable to reach the server. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}