import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../lib/api";
import { RequireAdmin, RequireAuth } from "../auth/guards";
import { LoginPage } from "./LoginPage";
import { adminUser, noopAuth, renderRoutes, renderWithAuth, staffUser } from "../test/harness";
import { AuthContext } from "../auth/auth-context";
import type { PublicUser } from "../lib/types";

describe("route protection", () => {
  it("redirects unauthenticated users away from protected routes to login", () => {
    renderRoutes(
      <Routes>
        <Route path="/" element={<RequireAuth><div>protected-content</div></RequireAuth>} />
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>,
      null,
    );
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
    expect(screen.getByText("login-page")).toBeInTheDocument();
  });

  it("renders protected content for an authenticated user", () => {
    renderRoutes(
      <Routes>
        <Route path="/" element={<RequireAuth><div>protected-content</div></RequireAuth>} />
      </Routes>,
      adminUser,
    );
    expect(screen.getByText("protected-content")).toBeInTheDocument();
  });

  it("shows a loading state while the session is being resolved", () => {
    renderRoutes(
      <Routes>
        <Route
          path="/"
          element={
            <AuthContext.Provider value={{ ...noopAuth, user: null, loading: true }}>
              <RequireAuth><div>protected-content</div></RequireAuth>
            </AuthContext.Provider>
          }
        />
      </Routes>,
      null,
    );
    expect(screen.getByText("Checking your session...")).toBeInTheDocument();
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
  });

  it("blocks STAFF from the ADMIN-only upload surface", () => {
    renderWithAuth(
      <RequireAdmin><div>upload-surface</div></RequireAdmin>,
      staffUser,
    );
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("upload-surface")).not.toBeInTheDocument();
  });

  it("allows ADMIN through the ADMIN-only surface", () => {
    renderWithAuth(
      <RequireAdmin><div>upload-surface</div></RequireAdmin>,
      adminUser,
    );
    expect(screen.getByText("upload-surface")).toBeInTheDocument();
  });
});

describe("LoginPage", () => {
  it("rejects an empty submission with a client-side message", async () => {
    const uploader = userEvent.setup();
    renderWithAuth(<LoginPage />, null);
    await uploader.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your username and password.");
  });

  it("submits credentials and surfaces a safe error for invalid credentials", async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(401, "INVALID_CREDENTIALS", "invalid username or password"));
    renderWithAuth(
      <AuthContext.Provider value={{ ...noopAuth, login }}>
        <LoginPage />
      </AuthContext.Provider>,
      null,
    );

    const uploader = userEvent.setup();
    await uploader.type(screen.getByLabelText("Username"), "admin");
    await uploader.type(screen.getByLabelText("Password"), "wrongpass");
    await uploader.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid username or password.")).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith("admin", "wrongpass");
  });

  it("submits credentials and navigates away on success", async () => {
    const login = vi.fn().mockResolvedValue(adminUser);
    function StatefulHarness({ initialUser }: { initialUser: PublicUser | null }) {
      const [user, setUser] = useState<PublicUser | null>(initialUser);
      return (
        <AuthContext.Provider
          value={{
            user,
            loading: false,
            login: async (u: string, p: string) => {
              await login(u, p);
              setUser(adminUser);
            },
            logout: async () => undefined,
          }}
        >
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/" element={<div>home-page</div>} />
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );
    }
    render(<StatefulHarness initialUser={null} />);

    const uploader = userEvent.setup();
    await uploader.type(screen.getByLabelText("Username"), "admin");
    await uploader.type(screen.getByLabelText("Password"), "correctpass");
    await uploader.click(screen.getByRole("button", { name: "Sign in" }));

    expect(login).toHaveBeenCalledWith("admin", "correctpass");
    await waitFor(() => {
      expect(screen.getByText("home-page")).toBeInTheDocument();
    });
  });

  it("redirects an already-authenticated user away from the login page", () => {
    renderWithAuth(<LoginPage />, adminUser);
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });
});