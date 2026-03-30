const PWD_KEY   = 'xinyue_pwd'
const GUEST_KEY = 'xinyue_guest'

export function getPassword(): string | null {
  return localStorage.getItem(PWD_KEY)
}

export function savePassword(pwd: string): void {
  localStorage.setItem(PWD_KEY, pwd)
  localStorage.removeItem(GUEST_KEY)   // 登录后清除访客标记
}

export function clearPassword(): void {
  localStorage.removeItem(PWD_KEY)
}

/** 进入访客模式：清除密码，写入访客标记 */
export function enterGuestMode(): void {
  localStorage.removeItem(PWD_KEY)
  localStorage.setItem(GUEST_KEY, '1')
}

/** 是否处于访客模式（无密码但已明确选择进入） */
export function isGuestMode(): boolean {
  return localStorage.getItem(GUEST_KEY) === '1'
}

export function clearGuestMode(): void {
  localStorage.removeItem(GUEST_KEY)
}

/** 后端返回 401 时抛出，供上层捕获后跳转到密码门 */
export class UnauthorizedError extends Error {
  constructor() {
    super('UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

/**
 * 统一 fetch 封装：
 * - 自动从 localStorage 读取密码并注入 X-Access-Password Header
 * - 后端返回 401 时清除密码并抛出 UnauthorizedError
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const pwd = getPassword()
  const headers = new Headers(init?.headers)
  if (pwd) headers.set('X-Access-Password', pwd)

  const res = await fetch(input, { ...init, headers })

  if (res.status === 401) {
    clearPassword()
    throw new UnauthorizedError()
  }

  return res
}

/**
 * 验证密码是否正确（不依赖 localStorage，用于密码门提交时的校验）
 * 返回 true = 正确，false = 错误
 */
export async function verifyPassword(pwd: string): Promise<boolean> {
  const res = await fetch('/api/moments/', {
    headers: { 'X-Access-Password': pwd },
  })
  return res.status !== 401
}
