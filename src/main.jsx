import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ThemeProvider } from './lib/theme'
import { initCardGlow } from './lib/cardGlow'
import './styles/global.css'

initCardGlow()

// Preferences are stored per user, so the provider needs the signed-in id —
// which means it has to sit inside AuthProvider rather than around it.
function PrefsGate({ children }) {
  const { user } = useAuth()
  return <ThemeProvider userId={user?.id ?? null}>{children}</ThemeProvider>
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <PrefsGate>
        <App />
      </PrefsGate>
    </AuthProvider>
  </React.StrictMode>
)
