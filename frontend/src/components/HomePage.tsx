import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function HomePage() {
  const { user } = useAuth();
  return (
    <div className="panel">
      <h1>Document ingestion</h1>
      <p>
        Upload an exam PDF to extract candidate rows, validate them against the
        student master, and review the validated candidates before generation.
      </p>
      <div className="workflow-steps">
        <ol>
          <li>Select the exam for the document.</li>
          <li>Upload the exam/student PDF.</li>
          <li>Wait for ingestion and student-master validation.</li>
          <li>Review the validated candidates.</li>
        </ol>
      </div>
      {user?.role === "ADMIN" && (
        <Link className="button button--primary" to="/exams">
          Select an exam and upload
        </Link>
      )}
      {user?.role === "STAFF" && (
        <p className="muted">
          Document upload is administrator-only. You can view ingestion status and
          candidates once a document exists.
        </p>
      )}
    </div>
  );
}