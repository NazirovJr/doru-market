import { httpRequest } from '@/shared/api/http-client'

// Прямая ссылка не донесла бы Authorization до защищённого эндпоинта — поэтому fetch + blob.
export async function downloadAuthenticatedFile(path: string, filename: string): Promise<void> {
  const response = await httpRequest(path)
  if (!response.ok) {
    throw new Error(`Failed to download ${path}: HTTP ${String(response.status)}`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.click()
  URL.revokeObjectURL(objectUrl)
}
