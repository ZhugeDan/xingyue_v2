import { useState, useCallback } from 'react'
import { BookHeart, PlusCircle } from 'lucide-react'
import Timeline from './components/Timeline'
import UploadModal from './components/UploadModal'

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleUploaded = useCallback(() => {
    setModalOpen(false)
    setRefreshKey((k) => k + 1)
  }, [])

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
        <Timeline key={refreshKey} />
      </main>

      {/* Upload modal */}
      {modalOpen && (
        <UploadModal onClose={() => setModalOpen(false)} onUploaded={handleUploaded} />
      )}
    </div>
  )
}
