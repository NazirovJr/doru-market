interface Env {
  readonly apiBaseUrl: string
}

const DEFAULT_API_BASE_URL = 'http://localhost:3000'

export function getClientEnv(): Env {
  const raw: unknown = import.meta.env.VITE_API_BASE_URL
  if (typeof raw === 'string' && raw.length > 0) {
    return { apiBaseUrl: raw }
  }
  return { apiBaseUrl: DEFAULT_API_BASE_URL }
}

type HttpClientOptions = RequestInit

export async function httpRequest(path: string, init: HttpClientOptions = {}): Promise<Response> {
  const url = `${getClientEnv().apiBaseUrl}${path}`
  // eslint-disable-next-line no-restricted-globals -- этот файл И ЕСТЬ разрешённый слой api.
  return fetch(url, init)
}
