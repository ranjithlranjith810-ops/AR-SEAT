import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";
import { AuthContext } from "../auth/auth-context";
import type { PublicUser } from "../lib/types";

export const adminUser: PublicUser = { id: "admin-1", username: "admin", role: "ADMIN" };
export const staffUser: PublicUser = { id: "staff-1", username: "staff", role: "STAFF" };

export const noopAuth = {
  user: null,
  loading: false,
  login: async () => undefined,
  logout: async () => undefined,
};

function authValue(user: PublicUser | null) {
  return user ? { ...noopAuth, user } : noopAuth;
}

// Renders `ui` inside AuthContext + MemoryRouter (no param routes).
export function renderWithAuth(ui: ReactElement, user: PublicUser | null) {
  return render(
    <AuthContext.Provider value={authValue(user)}>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

// Renders a param-route element against `path` (e.g. "/documents/:documentId")
// at an initial entry derived by substituting doc-1 for :documentId.
export function renderParamRoute(
  element: ReactElement,
  path: string,
  user: PublicUser | null,
  initial = path.replace(":documentId", "doc-1"),
) {
  return render(
    <AuthContext.Provider value={authValue(user)}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

// Renders an arbitrary Routes tree for guard/routing tests.
export function renderRoutes(routes: ReactNode, user: PublicUser | null, initial = "/") {
  return render(
    <AuthContext.Provider value={authValue(user)}>
      <MemoryRouter initialEntries={[initial]}>{routes}</MemoryRouter>
    </AuthContext.Provider>,
  );
}