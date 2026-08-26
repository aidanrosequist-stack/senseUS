import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/layout/AppShell'
import NotificationPopup from './components/notifications/NotificationPopup'
import { NotificationsContext } from './context/NotificationsContext'
import { useNotifications } from './hooks/useNotifications'
import { AuthProvider } from './context/AuthContext'

const Home = lazy(() => import('./pages/Home'))
const Vote = lazy(() => import('./pages/Vote'))
const Profile = lazy(() => import('./pages/Profile'))
const Compare = lazy(() => import('./pages/Compare'))
const Register = lazy(() => import('./pages/Register'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Login = lazy(() => import('./pages/Login'))
const Settings = lazy(() => import('./pages/Settings'))
const MakeUpMyMind = lazy(() => import('./pages/MakeUpMyMind'))
const Admin = lazy(() => import('./pages/Admin'))
const Explore = lazy(() => import('./pages/Explore'))
const Activity = lazy(() => import('./pages/Activity'))
const Conversation = lazy(() => import('./pages/Conversation'))
const Terms = lazy(() => import('./pages/Terms'))
const Mission = lazy(() => import('./pages/Mission'))
const HowItWorks = lazy(() => import('./pages/HowItWorks'))
const QuestionPreview = lazy(() => import('./pages/QuestionPreview'))
const Transparency = lazy(() => import('./pages/Transparency'))
const NotFound = lazy(() => import('./pages/NotFound'))
const Ethos = lazy(() => import('./pages/Ethos'))
const SponsorWithUs = lazy(() => import('./pages/SponsorWithUs'))

function PageLoading() {
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
      Loading...
    </div>
  )
}

// Holds the notification hook's live state and mounts the popup, as a
// thin wrapper *around* `children` rather than around <Routes> directly.
// This matters because it's re-render, not remount, that's the concern
// here: every realtime notification event, markAsRead, etc. re-renders
// this component. If it built <Routes> itself, React would see a new
// <Routes> element on every one of those events and re-render the whole
// routed tree — Header, BottomNav, and whatever page is open — for data
// none of them (besides BottomNav's unread badge, which reads the
// context instead) actually need. `children` here is the same
// <AppRoutes/> element App() below passed in, which never changes just
// because notification state changes, so React bails out
// of re-rendering it — the routed tree only re-renders for its own
// reasons (an actual navigation).
function NotificationsProvider({ children }) {
  const {
    notifications,
    unreadCount,
    urgentNotification,
    highNotifications,
    loading,
    markAsRead,
    markAllAsRead,
    dismissUrgent,
    dismissHigh,
    deleteNotification
  } = useNotifications()

  return (
    <NotificationsContext.Provider value={{
      notifications,
      unreadCount,
      urgentNotification,
      highNotifications,
      loading,
      markAsRead,
      markAllAsRead,
      dismissUrgent,
      dismissHigh,
      deleteNotification
    }}>
      <NotificationPopup
        urgentNotification={urgentNotification}
        highNotifications={highNotifications}
        onDismissUrgent={dismissUrgent}
        onDismissHigh={dismissHigh}
      />
      {children}
    </NotificationsContext.Provider>
  )
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/mission" element={<Mission />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/transparency" element={<Transparency />} />
        <Route path="/ethos" element={<Ethos />} />
        {/* Not linked from navigation yet — build now, launch visibly alongside Phase 2 (user-suggested questions). Reachable directly at /sponsor. */}
        <Route path="/sponsor" element={<SponsorWithUs />} />
        <Route path="/q/:number" element={<QuestionPreview />} />

        {/* Every route below shares one AppShell (Header + BottomNav),
            mounted once and kept alive across navigation between them —
            not rebuilt per page. ProtectedRoute wraps the shell itself,
            so the login/profile check also runs once per visit instead
            of re-fetching and re-flashing "Loading..." on every click
            between these pages, which is what the old per-route
            <ProtectedRoute> wrapping used to do. */}
        <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route path="/vote" element={<Vote />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/make-up-my-mind/:questionId" element={<MakeUpMyMind />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/conversation/:questionId" element={<Conversation />} />
          {/* /notifications used to route here — removed along with
              src/pages/Notifications.jsx. Nothing in the app ever linked
              to it (confirmed via a repo-wide search), and /profile is
              now the one place notifications are shown, with the same
              type-icon/click-to-navigate behavior that page had. The
              file itself is still on disk; delete it whenever you get a
              chance since nothing here can remove files on your machine. */}
          <Route path="/compare/:token" element={<Compare />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      {/* AuthProvider runs the one shared session lookup + listener for
          the whole app — everything under it (ProtectedRoute, useAdmin,
          useNotifications, and every page that calls useAuth()) reads
          from this single source instead of each standing up its own. */}
      <AuthProvider>
        <NotificationsProvider>
          <AppRoutes />
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
