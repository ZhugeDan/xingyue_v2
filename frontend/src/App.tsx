import { useState, useCallback } from 'react'
import { BookHeart, PlusCircle, Lock, Loader2 } from 'lucide-react'
import Timeline from './components/Timeline'
import UploadModal from './components/UploadModal'
import { getPassword, savePassword, clearPassword, verifyPassword } from './utils/api'

// ── 密码门 ──────────────────────────────────────────────────────────────────
function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [pwd, setPwd] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pwd.trim()) return
    setError('')
    setLoading(true)
    try {
      const ok = await verifyPassword(pwd.trim())
      if (ok) {
        savePassword(pwd.trim())
        onSuccess()
      } else {
        setError('暗号错误，请重试')
        setPwd('')
      }
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 via-slate-50 to-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-rose-400">
          <BookHeart size={36} strokeWidth={1.5} />
          <h1 className="text-xl font-semibold text-slate-700 tracking-tight">星月日记</h1>
          <p className="text-xs text-slate-400">私密家庭相册</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="请输入访问暗号…"
              autoFocus
              disabled={loading}
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50 placeholder-slate-300"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-xl px-4 py-2 text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !pwd.trim()}
            className="w-full flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium text-sm py-3 rounded-xl transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : '进入'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 主应用 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getPassword()))
  const [modalOpen, setModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleAuthError = useCallback(() => {
    clearPassword()
    setAuthed(false)
    setModalOpen(false)
  }, [])

  const handleUploaded = useCallback(() => {
    setModalOpen(false)
    setRefreshKey((k) => k + 1)
  }, [])

  if (!authed) {
    return <PasswordGate onSuccess={() => setAuthed(true)} />
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 via-slate-50 to-slate-100">
      {/* Navbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-rose-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-500">
            <BookHeart size={22} />
            <span className="font-semibold text-lg tracking-tight text-slate-700">星月日记</span>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 bg-rose-500 hover:bg-rose-600 active:scale-95 transition-all text-white text-sm font-medium px-4 py-2 rounded-full shadow-md"
          >
            <PlusCircle size={16} />
            发动态
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        <Timeline key={refreshKey} onAuthError={handleAuthError} />
      </main>

      {/* Upload modal */}
      {modalOpen && (
        <UploadModal
          onClose={() => setModalOpen(false)}
          onUploaded={handleUploaded}
          onAuthError={handleAuthError}
        />
      )}
    </div>
  )
}
