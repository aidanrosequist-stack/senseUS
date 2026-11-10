import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './lib/i18n'
// Starts listening for the browser's "installable" signal from app start,
// since it can arrive before any page that shows the install card.
import './lib/installPrompt'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)