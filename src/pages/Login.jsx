import { motion } from 'framer-motion'
import { Logo } from '../components/Shell'
import { useAuth } from '../lib/AuthContext'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C40.9 36.3 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}

export default function Login() {
  const { signInWithGoogle } = useAuth()

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, position: 'relative', overflow: 'hidden',
    }}>
      {/* ambient glow */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2 }}
        style={{
          position: 'absolute', width: 620, height: 620, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(47,212,138,0.12), transparent 65%)',
          top: '-14%', filter: 'blur(20px)', pointerEvents: 'none',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="card"
        style={{ width: 'min(430px, 100%)', padding: 40, position: 'relative', textAlign: 'center' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 26 }}>
          <Logo />
        </div>

        <div className="eyebrow" style={{ marginBottom: 10 }}>Premium Trading Journal</div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          Track your edge.<br /><span className="grad-text">Trade with clarity.</span>
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 14, lineHeight: 1.6 }}>
          Sign in to access your dashboard, journal, and analytics — securely synced to your account.
        </p>

        <motion.button
          whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
          onClick={signInWithGoogle}
          style={{
            marginTop: 30, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            padding: '14px', borderRadius: 13, fontSize: 15, fontWeight: 600,
            background: '#f6f8f7', color: '#141817',
            boxShadow: '0 12px 30px -12px rgba(0,0,0,0.6)',
          }}
        >
          <GoogleIcon />
          Continue with Google
        </motion.button>

        <div style={{ marginTop: 22, fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
          By continuing you agree to keep your trading data private to your account.
        </div>
      </motion.div>
    </div>
  )
}
