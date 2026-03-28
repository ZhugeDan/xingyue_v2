import { useRef, useState, useCallback } from 'react'
import { X, UploadCloud, CheckCircle2, Loader2, Plus } from 'lucide-react'
import { apiFetch, UnauthorizedError } from '../utils/api'

const COS_BASE_URL = 'https://xingyue-1317852266.cos.ap-beijing.myqcloud.com'
const MAX_FILES = 9
const ACCEPTED = 'image/jpeg,image/png,image/gif,video/mp4,video/quicktime,video/webm'

interface FileEntry {
  file: File
  preview: string
  type: 'photo' | 'video'
}

interface Props {
  onClose: () => void
  onUploaded: () => void
  onAuthError: () => void
}

type Step = 'idle' | 'uploading' | 'saving' | 'done' | 'error'

/** PUT a single file to COS, returns when complete */
function putToCOS(file: File, uploadUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`COS 上传失败 (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('网络错误，COS 上传中断'))
    xhr.send(file)
  })
}

function detectType(file: File): 'photo' | 'video' {
  return file.type.startsWith('video/') ? 'video' : 'photo'
}

/** CSS grid columns based on count */
function gridCols(n: number): string {
  if (n === 1) return 'grid-cols-1'
  if (n <= 4) return 'grid-cols-2'
  return 'grid-cols-3'
}

export default function UploadModal({ onClose, onUploaded, onAuthError }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [step, setStep] = useState<Step>('idle')
  const [uploadedCount, setUploadedCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const busy = step === 'uploading' || step === 'saving'

  // ── File selection ──────────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    if (!picked.length) return

    setEntries((prev) => {
      const combined = [...prev]
      for (const file of picked) {
        if (combined.length >= MAX_FILES) break
        combined.push({
          file,
          preview: URL.createObjectURL(file),
          type: detectType(file),
        })
      }
      return combined
    })
    // Reset input so re-picking the same file works
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => {
      URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  // ── Submit ──────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!entries.length || !title.trim()) return
    setErrorMsg('')
    setUploadedCount(0)

    try {
      // 1. Batch-fetch presigned URLs
      setStep('uploading')
      const params = new URLSearchParams()
      entries.forEach((en) => params.append('mimes', en.file.type))
      const authRes = await apiFetch(`/api/upload/auth?${params}`)
      if (!authRes.ok) throw new Error(`获取上传授权失败 (${authRes.status})`)
      const { items } = await authRes.json() as {
        items: { upload_url: string; key: string }[]
      }

      // 2. Concurrent PUT to COS
      let done = 0
      await Promise.all(
        entries.map((entry, i) =>
          putToCOS(entry.file, items[i].upload_url).then(() => {
            done++
            setUploadedCount(done)
          })
        )
      )

      // 3. Save to backend
      setStep('saving')
      const mediaList = items.map((item, i) => ({
        url: `${COS_BASE_URL}/${item.key}`,
        type: entries[i].type,
      }))

      const saveRes = await apiFetch('/api/moments/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          media_list: mediaList,
        }),
      })
      if (!saveRes.ok) {
        const detail = await saveRes.text()
        throw new Error(`保存失败 (${saveRes.status})：${detail}`)
      }

      setStep('done')
      setTimeout(onUploaded, 800)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onAuthError()
        return
      }
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">发布新动态</h2>
          {!busy && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Success */}
        {step === 'done' ? (
          <div className="flex flex-col items-center gap-3 py-14 text-emerald-500">
            <CheckCircle2 size={48} strokeWidth={1.5} />
            <p className="text-base font-medium">发布成功！</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4 max-h-[80vh] overflow-y-auto">

            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                标题 <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="给这一刻起个名字…"
                maxLength={200}
                required
                disabled={busy}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50 placeholder-slate-300"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                描述（可选）
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="记录下这一刻的心情…"
                rows={2}
                maxLength={2000}
                disabled={busy}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50 placeholder-slate-300 resize-none"
              />
            </div>

            {/* Media section */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                媒体文件 <span className="text-rose-400">*</span>
                <span className="ml-1 text-slate-300 font-normal">（最多 {MAX_FILES} 张）</span>
              </label>

              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                multiple
                onChange={handleFileChange}
                disabled={busy}
                className="hidden"
              />

              {entries.length === 0 ? (
                /* Empty picker */
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-rose-300 bg-slate-50 hover:bg-rose-50 transition-colors py-8 disabled:opacity-50"
                >
                  <UploadCloud size={28} className="text-slate-300" />
                  <span className="text-sm text-slate-400">点击选择图片或视频（可多选）</span>
                </button>
              ) : (
                /* Thumbnail grid */
                <div className={`grid gap-1.5 ${gridCols(entries.length)}`}>
                  {entries.map((en, idx) => (
                    <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group">
                      {en.type === 'photo' ? (
                        <img
                          src={en.preview}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <video
                          src={en.preview}
                          className="w-full h-full object-cover"
                          muted
                        />
                      )}
                      {/* Remove button */}
                      {!busy && (
                        <button
                          type="button"
                          onClick={() => removeEntry(idx)}
                          className="absolute top-1 right-1 p-0.5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      )}
                      {/* Video badge */}
                      {en.type === 'video' && (
                        <span className="absolute bottom-1 left-1 text-[10px] bg-black/50 text-white px-1.5 py-0.5 rounded-full">
                          视频
                        </span>
                      )}
                    </div>
                  ))}

                  {/* Add more cell */}
                  {entries.length < MAX_FILES && !busy && (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="aspect-square rounded-xl border-2 border-dashed border-slate-200 hover:border-rose-300 bg-slate-50 hover:bg-rose-50 transition-colors flex items-center justify-center"
                    >
                      <Plus size={20} className="text-slate-300" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Upload progress */}
            {step === 'uploading' && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-3">
                <Loader2 size={14} className="animate-spin text-rose-400 flex-shrink-0" />
                <span>
                  上传中 {uploadedCount}/{entries.length}
                  <span className="text-slate-300 ml-1">· 请勿关闭页面</span>
                </span>
                {/* Mini progress bar */}
                <div className="ml-auto w-20 bg-slate-200 rounded-full h-1 overflow-hidden flex-shrink-0">
                  <div
                    className="h-full bg-rose-400 rounded-full transition-all duration-300"
                    style={{ width: `${(uploadedCount / entries.length) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {step === 'saving' && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-3">
                <Loader2 size={14} className="animate-spin text-rose-400 flex-shrink-0" />
                正在保存动态…
              </div>
            )}

            {/* Error */}
            {step === 'error' && errorMsg && (
              <p className="text-xs text-red-500 bg-red-50 rounded-xl px-4 py-2.5">{errorMsg}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy || !entries.length || !title.trim()}
              className="w-full bg-rose-500 hover:bg-rose-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium text-sm py-3 rounded-xl transition-colors active:scale-[0.98]"
            >
              {busy ? '发布中…' : `确认发布${entries.length > 0 ? `（${entries.length} 个文件）` : ''}`}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
