import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Vote from './pages/Vote'
import Profile from './pages/Profile'
import Register from './pages/Register'
import Privacy from './pages/Privacy'
import Login from './pages/Login'
import Settings from './pages/Settings'
import MakeUpMyMind from './pages/MakeUpMyMind'
import Admin from './pages/Admin'
import Explore from './pages/Explore'
import Activity from './pages/Activity'
import Conversation from './pages/Conversation'
import ProtectedRoute from './components/ProtectedRoute'
import Terms from './pages/Terms'
import Mission from './pages/Mission'
import HowItWorks from './pages/HowItWorks'

function App() {
  return (
    <BrowserRouter>
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
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/mission" element={<Mission />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App