import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAdmin, RequireAuth } from "./auth/guards";
import { CandidatePage } from "./components/CandidatePage";
import { DocumentStatusPage } from "./components/DocumentStatusPage";
import { ExamSelectionPage } from "./components/ExamSelectionPage";
import { HomePage } from "./components/HomePage";
import { Layout } from "./components/Layout";
import { LoginPage } from "./components/LoginPage";
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
            <Route
              path="/exams"
              element={
                <RequireAdmin>
                  <ExamSelectionPage />
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
            <Route path="/documents/:documentId" element={<DocumentStatusPage />} />
            <Route path="/documents/:documentId/candidates" element={<CandidatePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}