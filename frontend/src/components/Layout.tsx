import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Logout is best-effort on the client; the session cookie is cleared
      // server-side. Any failure is surfaced through the auth state reset.
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Exam Seating</div>
        <nav aria-label="Primary">
          <ul className="nav-list">
            <li>
              <NavLink to="/" end>
                Home
              </NavLink>
            </li>
            {user?.role === "ADMIN" && (
              <li>
                <NavLink to="/upload">Upload documents</NavLink>
              </li>
            )}
          </ul>
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar__user">
            <span className="sidebar__username">{user?.username}</span>
            <span className="sidebar__role">{user?.role}</span>
          </div>
          <button type="button" className="button button--ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}