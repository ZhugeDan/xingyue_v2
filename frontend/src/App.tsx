import { useState, useCallback } from 'react'
import { BookHeart, PlusCircle, Lock, Loader2, Eye } from 'lucide-react'
import Timeline from './components/Timeline'
import UploadModal from './components/UploadModal'
import {
  getPassword, savePassword, clearPassword,
  enterGuestMode, isGuestMode, clearGuestMode,
  verifyPassword,
} from './utils/api'

// ── 密码门 ──────────────────────────────────────────────────────────────────
function PasswordGate({
  onSuccess,
  onGuest,
}: {
  onSuccess: () => void
  onGuest: () => void
}) {
  const [pwd,     setPwd]     = useState('')
  const [error,   setError]   = useState('')
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
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm
                focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50 placeholder-slate-300"
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
            className="w-full flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600
              disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium text-sm
              py-3 rounded-xl transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : '进入'}
          </button>

          {/* 访客模式入口 */}
          <div className="relative flex items-center">
            <div className="flex-1 border-t border-slate-100" />
            <span className="mx-3 text-xs text-slate-300">或</span>
            <div className="flex-1 border-t border-slate-100" />
          </div>

          <button
            type="button"
            onClick={onGuest}
            className="w-full flex items-center justify-center gap-2 border border-slate-200
              hover:border-rose-200 hover:bg-rose-50 text-slate-500 hover:text-rose-500
              font-medium text-sm py-3 rounded-xl transition-all duration-200"
          >
            <Eye size={15} />
            随便看看（访客模式）
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 主应用 ──────────────────────────────────────────────────────────────────
export default function App() {
  // authed: 已通过密码 OR 主动进入访客模式
  const [authed,    setAuthed]    = useState<boolean>(() => Boolean(getPassword()) || isGuestMode())
  // isAdmin: 由后端 GET /api/moments/ 返回的 is_admin 字段决定，初始值从 localStorage 推断
  const [isAdmin,   setIsAdmin]   = useState<boolean>(() => Boolean(getPassword()))
  const [modalOpen, setModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleAuthError = useCallback(() => {
    clearPassword()
    clearGuestMode()
    setAuthed(false)
    setIsAdmin(false)
    setModalOpen(false)
  }, [])

  const handleUploaded = useCallback(() => {
    setModalOpen(false)
    setRefreshKey((k) => k + 1)
  }, [])

  /** Timeline 从 API 拿到 is_admin 后回调，确保与后端状态同步 */
  const handleAdminStatus = useCallback((admin: boolean) => {
    setIsAdmin(admin)
  }, [])

  if (!authed) {
    return (
      <PasswordGate
        onSuccess={() => { setIsAdmin(true); setAuthed(true) }}
        onGuest={() => {
          enterGuestMode()
          setIsAdmin(false)
          setAuthed(true)
        }}
      />
    )
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

          {isAdmin ? (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 bg-rose-500 hover:bg-rose-600 active:scale-95
                transition-all text-white text-sm font-medium px-4 py-2 rounded-full shadow-md"
            >
              <PlusCircle size={16} />
              发动态
            </button>
          ) : (
            /* 访客标识 + 一键切换 */
            <button
              onClick={() => {
                clearGuestMode()
                setAuthed(false)
              }}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-400
                border border-slate-200 hover:border-rose-200 px-3 py-1.5 rounded-full transition-all"
            >
              <Eye size={13} />
              访客模式
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        <Timeline
          key={refreshKey}
          isAdmin={isAdmin}
          onAuthError={handleAuthError}
          onAdminStatus={handleAdminStatus}
        />
      </main>

      {/* Upload modal — 仅管理员能打开 */}
      {modalOpen && isAdmin && (
        <UploadModal
          onClose={() => setModalOpen(false)}
          onUploaded={handleUploaded}
          onAuthError={handleAuthError}
        />
      )}
    </div>
  )
}
