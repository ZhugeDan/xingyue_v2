import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { ImageOff, Loader2, Clapperboard, Camera } from 'lucide-react'

interface Moment {
  id: number
  title: string
  description: string | null
  media_url: string
  media_type: 'photo' | 'video'
  created_at: string
}

export default function Timeline() {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/moments')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data: Moment[]) => {
        setMoments(data)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
        <Loader2 size={32} className="animate-spin" />
        <span className="text-sm">加载中…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-red-400">
        <ImageOff size={32} />
        <span className="text-sm">加载失败：{error}</span>
      </div>
    )
  }

  if (moments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-slate-300">
        <Camera size={48} strokeWidth={1.2} />
        <p className="text-base font-medium">还没有动态，快去发一条吧！</p>
      </div>
    )
  }

  return (
    <ol className="relative border-l-2 border-rose-200 ml-3">
      {moments.map((m) => (
        <li key={m.id} className="mb-8 ml-6">
          {/* Timeline dot */}
          <span className="absolute -left-[11px] flex items-center justify-center w-5 h-5 rounded-full bg-rose-100 border-2 border-rose-300 ring-4 ring-white">
            {m.media_type === 'video' ? (
              <Clapperboard size={10} className="text-rose-500" />
            ) : (
              <Camera size={10} className="text-rose-500" />
            )}
          </span>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-shadow">
            {/* Media */}
            {m.media_type === 'photo' ? (
              <img
                src={m.media_url}
                alt={m.title}
                className="w-full max-h-80 object-cover"
                loading="lazy"
              />
            ) : (
              <video
                src={m.media_url}
                controls
                className="w-full max-h-80 bg-black"
                preload="metadata"
              />
            )}

            {/* Content */}
            <div className="p-4">
              <h3 className="font-semibold text-slate-800 text-base leading-snug mb-1">
                {m.title}
              </h3>
              {m.description && (
                <p className="text-sm text-slate-500 leading-relaxed mb-2">{m.description}</p>
              )}
              <time className="text-xs text-slate-400">
                {formatDistanceToNow(new Date(m.created_at), {
                  addSuffix: true,
                  locale: zhCN,
                })}
              </time>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
