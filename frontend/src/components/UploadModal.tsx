import { useRef, useState } from 'react'
import { X, UploadCloud, FileImage, FileVideo, CheckCircle2, Loader2 } from 'lucide-react'

// ⚠️ 替换为你的腾讯云 COS Bucket 域名
const COS_BASE_URL = 'https://xingyue-1317852266.cos.ap-beijing.myqcloud.com'

interface Props {
  onClose: () => void
  onUploaded: () => void
}

type Step = 'idle' | 'uploading-cos' | 'saving' | 'done' | 'error'

export default function UploadModal({ onClose, onUploaded }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [progress, setProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const ACCEPTED = 'image/jpeg,image/png,image/gif,video/mp4,video/quicktime,video/webm'

  function detectMediaType(f: File): 'photo' | 'video' {
    return f.type.startsWith('video/') ? 'video' : 'photo'
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !title.trim()) return
    setErrorMsg('')

    try {
      // 1. 获取预签名上传地址
      setStep('uploading-cos')
      setProgress(10)

      const authRes = await fetch('/api/upload/auth')
      if (!authRes.ok) throw new Error(`获取上传授权失败 (${authRes.status})`)
      const { upload_url, key } = (await authRes.json()) as { upload_url: string; key: string }

      setProgress(20)

      // 2. PUT 文件到腾讯云 COS（XMLHttpRequest 以便跟踪进度）
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', upload_url)
        xhr.setRequestHeader('Content-Type', file.type)
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(20 + Math.round((ev.loaded / ev.total) * 65))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`COS 上传失败 (${xhr.status})`))
        }
        xhr.onerror = () => reject(new Error('网络错误，COS 上传中断'))
        xhr.send(file)
      })

      setProgress(90)

      // 3. 拼接完整媒体 URL
      const media_url = `${COS_BASE_URL}/${key}`
      const media_type = detectMediaType(file)

      // 4. 存入后端数据库
      setStep('saving')
      const saveRes = await fetch('/api/moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          media_url,
          media_type,
        }),
      })
      if (!saveRes.ok) {
        const detail = await saveRes.text()
        throw new Error(`保存失败 (${saveRes.status})：${detail}`)
      }

      setProgress(100)
      setStep('done')

      // 短暂停留后关闭并刷新
      setTimeout(onUploaded, 800)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  const busy = step === 'uploading-cos' || step === 'saving'

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      {/* Panel */}
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

        {/* Success state */}
        {step === 'done' ? (
          <div className="flex flex-col items-center gap-3 py-14 text-emerald-500">
            <CheckCircle2 size={48} strokeWidth={1.5} />
            <p className="text-base font-medium">发布成功！</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
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

            {/* File picker */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                媒体文件 <span className="text-rose-400">*</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                onChange={handleFileChange}
                disabled={busy}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="w-full flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-rose-300 bg-slate-50 hover:bg-rose-50 transition-colors py-5 disabled:opacity-50"
              >
                <UploadCloud size={28} className="text-slate-300" />
                <span className="text-sm text-slate-400">
                  {file ? file.name : '点击选择图片或视频'}
                </span>
              </button>
            </div>

            {/* Preview */}
            {preview && file && (
              <div className="rounded-xl overflow-hidden border border-slate-100">
                {detectMediaType(file) === 'photo' ? (
                  <img src={preview} alt="preview" className="w-full max-h-52 object-cover" />
                ) : (
                  <video src={preview} controls className="w-full max-h-52 bg-black" />
                )}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-xs text-slate-400">
                  {detectMediaType(file) === 'photo' ? (
                    <FileImage size={13} />
                  ) : (
                    <FileVideo size={13} />
                  )}
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
            )}

            {/* Progress bar */}
            {busy && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 size={13} className="animate-spin" />
                  {step === 'uploading-cos' ? '正在上传文件…' : '正在保存动态…'}
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-rose-400 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {step === 'error' && errorMsg && (
              <p className="text-xs text-red-500 bg-red-50 rounded-xl px-4 py-2.5">{errorMsg}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy || !file || !title.trim()}
              className="w-full bg-rose-500 hover:bg-rose-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium text-sm py-3 rounded-xl transition-colors active:scale-[0.98]"
            >
              {busy ? '发布中…' : '发布动态'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
