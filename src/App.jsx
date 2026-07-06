import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Vote from './pages/Vote'
import Profile from './pages/Profile'
import Register from './pages/Register'
import Privacy from './pages/Privacy'
import Login from './pages/Login'
import Settings from './pages/Settings'
import MakeUpMyMind from './pages/MakeUpMyMind'
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
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/mission" element={<Mission />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App