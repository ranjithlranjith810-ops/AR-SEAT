# Frontend Auth Fast Refresh Fix — Closeout

## Change summary

Fixed a React Fast Refresh incompatibility that caused `useAuth must be used within AuthProvider` after Vite HMR updates.

- `frontend/src/auth/auth-context.ts` (NEW): the `AuthContext` `createContext()` object + `AuthContextValue` interface, isolated in their own module so the context identity is stable across HMR.
- `frontend/src/auth/AuthContext.tsx`: now exports only `AuthProvider` + `useAuth` (both Fast Refresh-compatible); imports the context from `./auth-context`.
- `frontend/src/test/harness.tsx`, `frontend/src/components/AuthAndLogin.test.tsx`, `frontend/src/components/UploadPage.test.tsx`: updated the `AuthContext` import path.

## Verification (all green)

| Check | Result | Evidence |
|---|---|---|
| Frontend test suite | 9 files / 106 tests passed | `auth-fix-frontend-tests.log` |
| TypeScript typecheck | clean | `auth-fix-typecheck.log` |
| Production build | success | `auth-fix-build.log` |
| Vite fully restarted via `npm run dev:all` | all services up | `auth-fix-devall.log` |
| HMR on consumer (`HomePage.tsx`) | `hmr update` only, no warning | `auth-fix-devall.log` |
| HMR on provider (`AuthContext.tsx`) | `hmr update` only, no `Could not Fast Refresh` | `auth-fix-devall.log` |
| Unauthenticated `/auth/me` | 401 (proxy + direct) | `auth-fix-e2e-verify.log` |
| ADMIN login `e2e-admin` / `e2e-password-1` | redirects to dashboard, admin nav visible | `auth-fix-e2e-verify.log` |
| Page refresh | session persists (200 /auth/me, still ADMIN) | `auth-fix-e2e-verify.log` |
| Logout | returns to `/login`, session invalidated (401) | `auth-fix-e2e-verify.log` |
| STAFF login `e2e-staff` | role STAFF, no admin nav, `/audit` blocked (Access denied) | `auth-fix-e2e-verify.log` |

## Files changed by this fix

- `frontend/src/auth/auth-context.ts` (new)
- `frontend/src/auth/AuthContext.tsx`
- `frontend/src/test/harness.tsx`
- `frontend/src/components/AuthAndLogin.test.tsx`
- `frontend/src/components/UploadPage.test.tsx`

## Preserved architecture

```
App
  -> AuthProvider
    -> HashRouter
      -> Routes
        -> RequireAuth
          -> protected page
```

## Not changed

- No backend change; auth contract unchanged.
- No roles/permissions changed.
- No database schema change.
- No auth bypass, no fake login state, no hardcoded role.
- No commit, no push.

## Git

Current HEAD: `d3b6d56 feat: add Phase 14 E2E browser harness` (unchanged). Working tree contains the uncommitted auth-fix changes plus pre-existing uncommitted Phase 16 work. See `auth-fix-git-status.log`, `auth-fix-git-diff-stat.log`, `auth-fix-git-diff.log`, `auth-fix-git-log.log`.