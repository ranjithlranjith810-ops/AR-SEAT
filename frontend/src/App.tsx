import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAdmin, RequireAuth } from "./auth/guards";
import { AuditPage } from "./components/AuditPage";
import { CandidatePage } from "./components/CandidatePage";
import { DocumentStatusPage } from "./components/DocumentStatusPage";
import { ExamCandidatesPage } from "./components/ExamCandidatesPage";
import { ExamSelectionPage } from "./components/ExamSelectionPage";
import { GenerationStatusPage } from "./components/GenerationStatusPage";
import { HallsPage } from "./components/HallsPage";
import { HomePage } from "./components/HomePage";
import { Layout } from "./components/Layout";
import { LoginPage } from "./components/LoginPage";
import { SeatingPage } from "./components/SeatingPage";
import { StudentsPage } from "./components/StudentsPage";
import { UploadPage } from "./components/UploadPage";

function NotFound() {
  return (
    <div className="panel">
      <h1>Not found</h1>
      <p>The page you are looking for does not exist.</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<HomePage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route
              path="/halls"
              element={
                <RequireAdmin>
                  <HallsPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/exams"
              element={
                <RequireAdmin>
                  <ExamSelectionPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/exams/:examId/candidates"
              element={
                <RequireAdmin>
                  <ExamCandidatesPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/upload"
              element={
                <RequireAdmin>
                  <UploadPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/audit"
              element={
                <RequireAdmin>
                  <AuditPage />
                </RequireAdmin>
              }
            />
            <Route path="/documents/:documentId" element={<DocumentStatusPage />} />
            <Route path="/documents/:documentId/candidates" element={<CandidatePage />} />
            <Route path="/generations/:generationId" element={<GenerationStatusPage />} />
            <Route path="/seating/:seatingPlanId" element={<SeatingPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}