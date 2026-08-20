# Frontend Auth Fast Refresh Fix — Root Cause

## Symptom (before)

1. Unauthenticated `GET /auth/me` returns 401 — expected, correct behavior.
2. After Vite HMR updates, the frontend throws:
   - `Uncaught Error: useAuth must be used within AuthProvider` at `useAuth (AuthContext.tsx:64)` / `RequireAuth (guards.tsx:7)`.
3. Vite reports:
   - `Could not Fast Refresh ("AuthContext" export is incompatible)`.
4. The React tree was correct:
   - `AuthProvider` -> `HashRouter` -> `Routes` -> `RequireAuth` -> protected page.

## What was ruled out

| Hypothesis | Verdict |
|---|---|
| Duplicate `AuthContext` definitions | No — single `createContext` in `frontend/src/auth/AuthContext.tsx:20` |
| Importing provider/hook/context from different module paths | No — all import from `./auth/AuthContext` |
| Circular imports | No — `AuthContext` imports `../lib/api` + `../lib/types` only |
| Default vs named export mismatch | No — all named imports, all match |
| Provider nested incorrectly | No — `App.tsx` wraps `HashRouter` with `AuthProvider` |
| Route rendered outside provider | No — all routes are inside `AuthProvider` |
| Duplicated React in dependency graph | No — `npm ls react react-dom`: single `react@18.3.1` deduped |

## Actual root cause

`AuthContext.tsx` co-located three things in one module:

- the context object: `export const AuthContext = createContext<...>(null)`
- the `AuthProvider` component
- the `useAuth` hook

A `createContext()` result is neither a React component nor a hook. `@vitejs/plugin-react` (react-refresh) therefore flags that export as incompatible with Fast Refresh and logs `Could not Fast Refresh ("AuthContext" export is incompatible)`.

When the module hot-updates, the module re-executes and a **new `AuthContext` identity** is created. React rerenders the provider with the new identity while consumers that still reference the **old** identity read `undefined` from `useContext(oldContext)`. `useAuth()` then throws `useAuth must be used within AuthProvider` — even though the rendered tree shows `AuthProvider` above `RequireAuth`. This is the documented React Fast Refresh context-identity gotcha: co-locating a context object with components breaks hot reload.

## Fix (minimal, architecture-preserving)

Moved the context object into its own module so its identity is created once and is stable across HMR:

- **New** `frontend/src/auth/auth-context.ts` — exports `AuthContextValue` interface + `AuthContext` object.
- `frontend/src/auth/AuthContext.tsx` — now exports only `AuthProvider` (component) and `useAuth` (hook); imports the context from `./auth-context`.
- `frontend/src/test/harness.tsx`, `frontend/src/components/AuthAndLogin.test.tsx`, `frontend/src/components/UploadPage.test.tsx` — import `AuthContext` from `../auth/auth-context`.

After the change:

- `AuthContext.tsx` contains only Fast Refresh-compatible exports -> `hmr update /src/auth/AuthContext.tsx` with **no** `Could not Fast Refresh` warning.
- The context identity no longer changes during HMR -> consumers never observe a mismatched context.
- Architecture unchanged: `App` -> `AuthProvider` -> `HashRouter` -> `Routes` -> `RequireAuth` -> page.

No authentication behavior, roles, permissions, backend contract, or schema were changed. No fake login state, no bypass of `RequireAuth`, no hardcoded role.