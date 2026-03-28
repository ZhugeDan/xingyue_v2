import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import {
  ImageOff, Loader2, Camera, Clapperboard, Images,
  Play, MessageCircle, Send, Trash2, X,
} from 'lucide-react'
import YALightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Video from 'yet-another-react-lightbox/plugins/video'
import { apiFetch, UnauthorizedError } from '../utils/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MediaItem {
  url: string
  type: 'photo' | 'video'
}

interface Comment {
  id: number
  role: string
  content: string
  created_at: string
}

interface Moment {
  id: number
  title: string
  description: string | null
  media_list: MediaItem[]
  ai_tags: string[] | null
  created_at: string
  comments: Comment[]
}

interface Group {
  year: number
  month: number
  moments: Moment[]
}

interface Props {
  onAuthError: () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GRID_LIMIT = 9
const TAG_SEP = '---TAGS---'

const TAG_PALETTE = [
  'bg-blue-50 text-blue-600',
  'bg-emerald-50 text-emerald-600',
  'bg-violet-50 text-violet-600',
  'bg-amber-50 text-amber-600',
  'bg-sky-50 text-sky-600',
  'bg-rose-50 text-rose-500',
]

const IDENTITIES = ['👵 姥姥', '👴 姥爷', '👩 妈妈', '👨 爸爸', '👦 舅舅']

// ── Helpers ───────────────────────────────────────────────────────────────────

const parseUTC = (s: string) => new Date(s.endsWith('Z') ? s : `${s}Z`)

const sectionId = (year: number, month: number) =>
  `section-${year}-${String(month).padStart(2, '0')}`

/** 将流式累积文本拆分为日记文案 + 标签数组。 */
function parseStreamResult(full: string): { description: string; tags: string[] } {
  let description = full
  let tags: string[] = []
  if (full.includes(TAG_SEP)) {
    const [d, t] = full.split(TAG_SEP, 2)
    description = d.trim()
    const m = t.match(/\[[\s\S]*?\]/)
    if (m) {
      try {
        const parsed = JSON.parse(m[0])
        if (Array.isArray(parsed)) tags = parsed.map(String).filter(Boolean)
      } catch { /* ignore */ }
    }
  }
  return { description: description.trim(), tags }
}

/** Group a newest-first sorted moment list into year/month buckets (preserves order). */
function groupMoments(moments: Moment[]): Group[] {
  const result: Group[] = []
  for (const m of moments) {
    const d = parseUTC(m.created_at)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    const last = result[result.length - 1]
    if (last && last.year === year && last.month === month) {
      last.moments.push(m)
    } else {
      result.push({ year, month, moments: [m] })
    }
  }
  return result
}

function toSlide(item: MediaItem) {
  if (item.type === 'photo') return { src: item.url }
  const mime = item.url.endsWith('.webm') ? 'video/webm'
    : item.url.endsWith('.mov') ? 'video/quicktime'
    : 'video/mp4'
  return { type: 'video' as const, sources: [{ src: item.url, type: mime }] }
}

// ── DotIcon ───────────────────────────────────────────────────────────────────

function DotIcon({ items }: { items: MediaItem[] }) {
  const hasVideo = items.some((i) => i.type === 'video')
  const multi = items.length > 1
  if (hasVideo) return <Clapperboard size={10} className="text-rose-500" />
  if (multi)    return <Images size={10} className="text-rose-500" />
  return <Camera size={10} className="text-rose-500" />
}

// ── MediaGrid ─────────────────────────────────────────────────────────────────

function MediaGrid({
  items,
  onItemClick,
  onDeleteMedia,
}: {
  items: MediaItem[]
  onItemClick: (idx: number) => void
  onDeleteMedia: (idx: number) => void
}) {
  const n = items.length
  if (n === 0) return null

  if (n === 1) {
    const item = items[0]
    return (
      <div className="relative overflow-hidden group">
        <div className="cursor-pointer" onClick={() => onItemClick(0)}>
          {item.type === 'photo' ? (
            <img src={item.url} alt="" className="w-full max-h-72 object-cover" loading="lazy" />
          ) : (
            <>
              <video src={item.url} muted playsInline preload="metadata"
                className="w-full max-h-72 bg-black object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20
                group-hover:bg-black/30 transition-colors pointer-events-none">
                <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center shadow-lg">
                  <Play size={20} className="text-slate-700 ml-0.5" fill="currentColor" />
                </div>
              </div>
            </>
          )}
        </div>
        {n > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteMedia(0) }}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 hover:bg-red-500
              text-white opacity-0 group-hover:opacity-100 transition-all"
            title="删除此文件"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    )
  }

  const shown = items.slice(0, GRID_LIMIT)
  const hiddenCount = Math.max(0, n - GRID_LIMIT)
  const cols = n <= 4 ? 'grid-cols-2' : 'grid-cols-3'

  return (
    <div className={`grid gap-0.5 ${cols}`}>
      {shown.map((item, idx) => {
        const isLastWithHidden = idx === shown.length - 1 && hiddenCount > 0
        return (
          <div key={idx} className="relative aspect-square overflow-hidden cursor-pointer group">
            <div className="w-full h-full" onClick={() => onItemClick(idx)}>
              {item.type === 'photo' ? (
                <img src={item.url} alt=""
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy" />
              ) : (
                <>
                  <video src={item.url} muted playsInline preload="metadata"
                    className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center
                    bg-black/20 group-hover:bg-black/30 transition-colors pointer-events-none">
                    <div className="w-9 h-9 rounded-full bg-white/80 flex items-center justify-center shadow-md">
                      <Play size={14} className="text-slate-700 ml-0.5" fill="currentColor" />
                    </div>
                  </div>
                </>
              )}
            </div>

            {isLastWithHidden && (
              <div className="absolute inset-0 bg-black/55 flex items-center justify-center pointer-events-none">
                <span className="text-white text-xl font-bold">+{hiddenCount}</span>
              </div>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); onDeleteMedia(idx) }}
              className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/40 hover:bg-red-500
                text-white opacity-0 group-hover:opacity-100 transition-all z-10"
              title="删除此文件"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── CommentSection ────────────────────────────────────────────────────────────

function CommentSection({
  momentId,
  initialComments,
  onAuthError,
}: {
  momentId: number
  initialComments: Comment[]
  onAuthError: () => void
}) {
  const [open,       setOpen]       = useState(false)
  const [comments,   setComments]   = useState<Comment[]>(initialComments)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text,       setText]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!selectedId || !text.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/moments/${momentId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedId, content: text.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      const created: Comment = await res.json()
      setComments((prev) => [...prev, created])
      setText('')
    } catch (e) {
      if (e instanceof UnauthorizedError) { onAuthError(); return }
      alert('发送失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteComment(commentId: number) {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    try {
      const res = await apiFetch(`/api/moments/${momentId}/comments/${commentId}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 404) throw new Error()
    } catch {
      setComments(initialComments)
    }
  }

  return (
    <div className="border-t border-slate-100">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-400
          px-4 py-2.5 transition-colors w-full text-left"
      >
        <MessageCircle size={13} />
        <span>{comments.length > 0 ? `${comments.length} 条留言` : '添加留言'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {comments.length > 0 && (
            <div className="space-y-2">
              {comments.map((c) => {
                const [emoji, ...rest] = c.role.split(' ')
                const name = rest.join(' ')
                return (
                  <div key={c.id} className="flex gap-2 items-start group/comment">
                    <span className="text-lg leading-none flex-shrink-0 mt-0.5">{emoji}</span>
                    <div className="flex-1 min-w-0 bg-slate-50 rounded-xl px-3 py-2">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-slate-700">{name}</span>
                        <span className="text-[10px] text-slate-300">
                          {formatDistanceToNow(parseUTC(c.created_at), { addSuffix: true, locale: zhCN })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 leading-snug">{c.content}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteComment(c.id)}
                      className="flex-shrink-0 mt-1 p-1 rounded-full text-slate-300
                        hover:text-red-400 hover:bg-red-50 opacity-0 group-hover/comment:opacity-100
                        transition-all"
                      title="删除留言"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div>
            <p className="text-[10px] text-slate-400 mb-1.5">我是：</p>
            <div className="flex flex-wrap gap-1.5">
              {IDENTITIES.map((id) => (
                <button
                  key={id}
                  onClick={() => setSelectedId(id === selectedId ? null : id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 ${
                    selectedId === id
                      ? 'bg-rose-500 text-white shadow-sm scale-105'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>

          {selectedId && (
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder={`${selectedId}说…`}
                maxLength={200}
                disabled={submitting}
                className="flex-1 text-sm rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                  focus:outline-none focus:ring-2 focus:ring-rose-300 placeholder-slate-300
                  disabled:opacity-50"
              />
              <button
                onClick={handleSubmit}
                disabled={!text.trim() || submitting}
                className="p-2.5 rounded-xl bg-rose-500 text-white disabled:bg-slate-200
                  disabled:text-slate-400 transition-colors flex-shrink-0"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── AiWriteButton ─────────────────────────────────────────────────────────────

function AiWriteButton({
  momentId,
  onAuthError,
  onComplete,
  autoTrigger = false,
}: {
  momentId: number
  onAuthError: () => void
  onComplete: (description: string, tags: string[]) => void
  autoTrigger?: boolean
}) {
  const [phase, setPhase]             = useState<'idle' | 'streaming' | 'error'>('idle')
  const [displayText, setDisplayText] = useState('')   // text before TAG_SEP
  const [streamTags,  setStreamTags]  = useState<string[]>([])
  const [errorMsg,    setErrorMsg]    = useState('')

  // Auto-trigger on mount when the moment has multiple images
  useEffect(() => {
    if (autoTrigger) startStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startStream() {
    setPhase('streaming')
    setDisplayText('')
    setStreamTags([])

    try {
      const res = await apiFetch(`/api/moments/${momentId}/ai_stream`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer      = ''
      let accumulated = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE lines are separated by \n; incomplete last line stays in buffer
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''

        for (const line of parts) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()

          if (raw === '[DONE]') {
            // Stream complete — parse full text and notify parent
            const { description, tags } = parseStreamResult(accumulated)
            onComplete(description, tags)
            break outer   // parent re-renders, this component unmounts
          }

          try {
            const obj = JSON.parse(raw) as { text?: string; error?: string }

            if (obj.error) {
              setErrorMsg(obj.error)
              setPhase('error')
              return
            }

            if (obj.text) {
              accumulated += obj.text

              if (accumulated.includes(TAG_SEP)) {
                // Split: show description part; try to extract any tags so far
                const [descPart, tagsPart] = accumulated.split(TAG_SEP, 2)
                setDisplayText(descPart)
                const m = tagsPart.match(/\[[\s\S]*?\]/)
                if (m) {
                  try {
                    const parsed = JSON.parse(m[0])
                    if (Array.isArray(parsed))
                      setStreamTags(parsed.map(String).filter(Boolean))
                  } catch { /* partial JSON, keep waiting */ }
                }
              } else {
                setDisplayText(accumulated)
              }
            }
          } catch { /* malformed SSE line — skip */ }
        }
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) { onAuthError(); return }
      setErrorMsg(e instanceof Error ? e.message : '网络错误，请稍后重试')
      setPhase('error')
    }
  }

  return (
    <div className="space-y-1.5">

      {/* ── Idle: trigger button ── */}
      {phase === 'idle' && (
        <button
          onClick={startStream}
          className="flex items-center gap-1.5 text-xs text-slate-400
            hover:text-violet-500 transition-all duration-150 group py-0.5"
        >
          <span className="text-sm group-hover:scale-125 transition-transform duration-200 inline-block">
            ✨
          </span>
          AI 智能生成日记
        </button>
      )}

      {/* ── Streaming: typewriter text + cursor + tags ── */}
      {phase === 'streaming' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600 leading-relaxed">
            {displayText || '\u00A0'}
            {/* Blinking cursor */}
            <span className="inline-block w-px h-[1.1em] bg-violet-400 ml-0.5
              align-text-bottom animate-pulse" />
          </p>

          {streamTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {streamTags.map((tag, i) => (
                <span
                  key={tag}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium
                    ${TAG_PALETTE[i % TAG_PALETTE.length]}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Error: message + retry ── */}
      {phase === 'error' && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-red-400">{errorMsg}</span>
          <button
            onClick={startStream}
            className="text-violet-500 hover:text-violet-600 underline underline-offset-2"
          >
            重试
          </button>
        </div>
      )}

    </div>
  )
}

// ── SlimNav ───────────────────────────────────────────────────────────────────

function SlimNav({
  groups,
  activeId,
  onSelect,
}: {
  groups: Group[]
  activeId: string | null
  onSelect: (year: number, month: number) => void
}) {
  const years = useMemo(() => [...new Set(groups.map((g) => g.year))], [groups])
  if (groups.length < 2) return null   // pointless for 0-1 groups

  return (
    <nav
      aria-label="时间轴导航"
      className="fixed right-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-end py-6 pr-2 select-none"
    >
      {/* Vertical spine line */}
      <div
        className="pointer-events-none absolute inset-y-6 right-[13px] w-px bg-slate-200/70"
        aria-hidden
      />

      {years.map((year, yi) => (
        <div key={year} className={`flex flex-col items-end ${yi > 0 ? 'mt-4' : ''}`}>
          {/* Year label */}
          <span className="mb-0.5 pr-5 text-[8px] font-bold tracking-widest text-slate-300 uppercase">
            {year}
          </span>

          {/* Month rows */}
          {groups
            .filter((g) => g.year === year)
            .map((g) => {
              const id = sectionId(g.year, g.month)
              const isActive = activeId === id
              return (
                <button
                  key={id}
                  onClick={() => onSelect(g.year, g.month)}
                  title={`${g.year}年${g.month}月（${g.moments.length} 条）`}
                  /* 最小点击区域 32×28 px，满足移动端无障碍标准 */
                  className="group relative flex min-h-7 min-w-8 items-center justify-end gap-2
                    pr-1.5 transition-all duration-200"
                >
                  {/* Month label — hidden until hover / always visible when active */}
                  <span
                    className={`whitespace-nowrap text-[10px] font-medium leading-none
                      transition-all duration-200
                      ${isActive
                        ? 'translate-x-0 opacity-100 text-rose-500'
                        : 'translate-x-2 opacity-0 text-slate-400 group-hover:translate-x-0 group-hover:opacity-100'
                      }`}
                  >
                    {g.month}月
                  </span>

                  {/* Dot */}
                  <span
                    className={`block rounded-full flex-shrink-0 transition-all duration-200
                      ${isActive
                        ? 'h-3 w-3 bg-rose-400 ring-2 ring-rose-200 ring-offset-1'
                        : 'h-1.5 w-1.5 bg-slate-300 group-hover:h-2 group-hover:w-2 group-hover:bg-rose-300'
                      }`}
                  />
                </button>
              )
            })}
        </div>
      ))}
    </nav>
  )
}

// ── Main Timeline ─────────────────────────────────────────────────────────────

export default function Timeline({ onAuthError }: Props) {
  const [moments,   setMoments]   = useState<Moment[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [lbOpen,    setLbOpen]    = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lbSlides,  setLbSlides]  = useState<any[]>([])
  const [lbIndex,   setLbIndex]   = useState(0)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const timelineRef = useRef<HTMLOListElement>(null)

  // ── Data ──────────────────────────────────────────────────────────────────

  const loadMoments = useCallback(() => {
    setLoading(true)
    apiFetch('/api/moments/')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data: Moment[]) => { setMoments(data); setLoading(false) })
      .catch((e: unknown) => {
        if (e instanceof UnauthorizedError) { onAuthError(); return }
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
  }, [onAuthError])

  useEffect(() => { loadMoments() }, [loadMoments])

  // ── Grouping & scroll-spy ─────────────────────────────────────────────────

  const groups = useMemo(() => groupMoments(moments), [moments])

  /** Initialise active section to the topmost group once data loads. */
  useEffect(() => {
    if (groups.length > 0) {
      setActiveSection((prev) => prev ?? sectionId(groups[0].year, groups[0].month))
    }
  }, [groups])

  /** IntersectionObserver: highlights the nav dot matching the on-screen section. */
  useEffect(() => {
    const container = timelineRef.current
    if (!container || groups.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        // Pick the topmost section header currently in the trigger band
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        setActiveSection(visible[0].target.id)
      },
      /**
       * rootMargin: a 15 % band starting at 5 % from the top.
       * An element is "active" once it enters this zone.
       */
      { root: null, rootMargin: '-5% 0px -80% 0px', threshold: 0 },
    )

    container.querySelectorAll('[id^="section-"]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [groups])

  // ── Gallery ───────────────────────────────────────────────────────────────

  const openGallery = useCallback((items: MediaItem[], startIdx: number) => {
    setLbSlides(items.map(toSlide))
    setLbIndex(startIdx)
    setLbOpen(true)
  }, [])

  // ── Scroll-to ─────────────────────────────────────────────────────────────

  const scrollToSection = useCallback((year: number, month: number) => {
    document
      .getElementById(sectionId(year, month))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ── Delete handlers ───────────────────────────────────────────────────────

  async function handleDeleteMoment(momentId: number) {
    if (!window.confirm('确定要删除这条美好回忆吗？')) return
    try {
      const res = await apiFetch(`/api/moments/${momentId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(await res.text())
      setMoments((prev) => prev.filter((m) => m.id !== momentId))
    } catch (e) {
      if (e instanceof UnauthorizedError) { onAuthError(); return }
      alert('删除失败，请重试')
    }
  }

  async function handleDeleteMedia(momentId: number, mediaIndex: number) {
    const moment = moments.find((m) => m.id === momentId)
    if (!moment) return

    if (moment.media_list.length === 1) {
      if (window.confirm('这是最后一个文件，确定要删除整条动态吗？')) {
        await handleDeleteMoment(momentId)
      }
      return
    }

    if (!window.confirm('确定要删除这张图片/视频吗？')) return

    try {
      const res = await apiFetch(`/api/moments/${momentId}/media/${mediaIndex}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await res.text())
      setMoments((prev) =>
        prev.map((m) =>
          m.id === momentId
            ? { ...m, media_list: m.media_list.filter((_, i) => i !== mediaIndex) }
            : m,
        ),
      )
    } catch (e) {
      if (e instanceof UnauthorizedError) { onAuthError(); return }
      alert('删除失败，请重试')
    }
  }

  // ── Render: loading / error / empty ──────────────────────────────────────

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

  // ── Render: main ──────────────────────────────────────────────────────────

  return (
    <>
      <YALightbox
        open={lbOpen}
        close={() => setLbOpen(false)}
        slides={lbSlides}
        index={lbIndex}
        plugins={[Zoom, Video]}
        zoom={{ maxZoomPixelRatio: 3 }}
      />

      {/* Right-side slim navigation — rendered outside the scroll container */}
      <SlimNav groups={groups} activeId={activeSection} onSelect={scrollToSection} />

      {/* pr-10 reserves space so content never hides behind the slim nav */}
      <ol ref={timelineRef} className="relative border-l-2 border-rose-200 ml-3 pr-10">
        {groups.map((group, gi) => {
          const showYearBadge = gi === 0 || groups[gi - 1].year !== group.year

          return (
            <Fragment key={`${group.year}-${group.month}`}>

              {/* ── Year separator (between years only) ── */}
              {showYearBadge && gi > 0 && (
                <li className="mb-5 ml-6" aria-hidden>
                  <div className="flex items-center gap-3 -ml-9 mt-1">
                    <div className="w-7 h-px bg-rose-200" />
                    <span className="text-xs font-bold tracking-widest text-rose-300">
                      {group.year}
                    </span>
                    <div className="flex-1 h-px bg-rose-100" />
                  </div>
                </li>
              )}

              {/* ── Month section header (anchor for scroll + dot on timeline) ── */}
              <li
                id={sectionId(group.year, group.month)}
                className="mb-3 ml-6 scroll-mt-6"
              >
                {/* Timeline dot — hollow circle for section headers */}
                <span className="absolute -left-[11px] flex items-center justify-center
                  w-5 h-5 rounded-full bg-white border-2 border-rose-200 ring-4 ring-white" />

                <div className="flex items-center gap-2 py-1 pl-0.5">
                  <span className="text-xs font-semibold text-rose-400">
                    {group.year}年{group.month}月
                  </span>
                  <span className="text-[10px] text-slate-300">
                    {group.moments.length} 条
                  </span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
              </li>

              {/* ── Moments in this group ── */}
              {group.moments.map((m) => (
                <li key={m.id} className="mb-8 ml-6">

                  {/* Timeline dot */}
                  <span className="absolute -left-[11px] flex items-center justify-center w-5 h-5
                    rounded-full bg-rose-100 border-2 border-rose-300 ring-4 ring-white">
                    <DotIcon items={m.media_list} />
                  </span>

                  {/* Card */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100
                    overflow-hidden hover:shadow-md transition-shadow duration-200 group/card">

                    <MediaGrid
                      items={m.media_list}
                      onItemClick={(i) => openGallery(m.media_list, i)}
                      onDeleteMedia={(i) => handleDeleteMedia(m.id, i)}
                    />

                    <div className="px-4 pt-3 pb-2 space-y-2">

                      {/* Title row */}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-800 text-base leading-snug flex-1">
                          {m.title}
                        </h3>
                        <button
                          onClick={() => handleDeleteMoment(m.id)}
                          className="flex-shrink-0 p-1.5 rounded-full text-slate-300
                            hover:text-red-400 hover:bg-red-50 opacity-0 group-hover/card:opacity-100
                            transition-all mt-0.5"
                          title="删除这条动态"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {m.description ? (
                        <p className="text-sm text-slate-500 leading-relaxed">{m.description}</p>
                      ) : (
                        <AiWriteButton
                          momentId={m.id}
                          onAuthError={onAuthError}
                          autoTrigger={m.media_list.length > 1}
                          onComplete={(desc, tags) =>
                            setMoments((prev) =>
                              prev.map((mom) =>
                                mom.id === m.id
                                  ? {
                                      ...mom,
                                      description: desc,
                                      ai_tags: tags.length > 0 ? tags : mom.ai_tags,
                                    }
                                  : mom,
                              ),
                            )
                          }
                        />
                      )}

                      {/* Footer: time + AI tags */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
                        <time
                          className="text-xs text-slate-400 flex-shrink-0 cursor-default"
                          title={format(parseUTC(m.created_at), 'yyyy-MM-dd HH:mm')}
                        >
                          {formatDistanceToNow(parseUTC(m.created_at), { addSuffix: true, locale: zhCN })}
                        </time>

                        {m.ai_tags && m.ai_tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {m.ai_tags.map((tag, i) => (
                              <span
                                key={tag}
                                className={`text-xs px-2 py-0.5 rounded-full font-medium
                                  ${TAG_PALETTE[i % TAG_PALETTE.length]}`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <CommentSection
                      momentId={m.id}
                      initialComments={m.comments}
                      onAuthError={onAuthError}
                    />
                  </div>
                </li>
              ))}

            </Fragment>
          )
        })}
      </ol>
    </>
  )
}
