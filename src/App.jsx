import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import NotificationPopup from './components/notifications/NotificationPopup'
import { NotificationsContext } from './context/NotificationsContext'
import { useNotifications } from './hooks/useNotifications'

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
const Notifications = lazy(() => import('./pages/Notifications'))
const Ethos = lazy(() => import('./pages/Ethos'))

function PageLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
      Loading...
    </div>
  )
}

function AppContent() {
  const {
    notifications,
    unreadCount,
    urgentNotification,
    highNotifications,
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
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/vote" element={<ProtectedRoute><Vote /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/make-up-my-mind/:questionId" element={<ProtectedRoute><MakeUpMyMind /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          <Route path="/activity" element={<ProtectedRoute><Activity /></ProtectedRoute>} />
          <Route path="/explore" element={<ProtectedRoute><Explore /></ProtectedRoute>} />
          <Route path="/conversation/:questionId" element={<ProtectedRoute><Conversation /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/mission" element={<Mission />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/transparency" element={<Transparency />} />
          <Route path="/ethos" element={<Ethos />} />
          <Route path="/q/:number" element={<QuestionPreview />} />
          <Route path="/compare/:token" element={<ProtectedRoute><Compare /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </NotificationsContext.Provider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}
