// This hook now just re-exports the shared AuthContext consumer, kept as
// a thin shim so every existing `import { useAuth } from
// '../hooks/useAuth'` across the app (ProtectedRoute, useAdmin,
// useNotifications, and half a dozen pages) keeps working unchanged.
// The real session logic lives in a single AuthProvider mounted once at
// the top of App.jsx — see src/context/AuthContext.jsx — instead of
// being independently re-run by every component that calls this hook.
export { useAuth } from '../context/AuthContext'
