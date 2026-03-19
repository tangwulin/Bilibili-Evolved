import { formatDuration, formatFileSize, formatPercent } from '@/core/utils/formatters'

export function formatProgress(received: number, total: number, speed: number) {
  const fReceived = formatFileSize(received)
  const fTotal = total > 0 ? ` / ${formatFileSize(total)}` : ''
  const percent = total > 0 ? ` @ ${formatPercent(received / total)}` : ''
  let remTime = ''
  let fSpeed = ''
  if (total > received && speed > 0) {
    fSpeed = ` (${formatFileSize(speed)}/s)`
    remTime = ` - ${formatDuration((total - received) / speed)}`
  }

  return `${fReceived}${fTotal}${percent}${fSpeed}${remTime}`
}

export async function getStreamWithProgress(
  url: string,
  onProgress: (received: number, total: number, speed: number) => void,
) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('浏览器不支持 ReadableStream')
  }

  const length = parseInt(response.headers.get('Content-Length') || '0')
  let received = 0
  let lastTime = Date.now()
  let lastReceived = 0

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length
      const now = Date.now()
      const deltaTime = (now - lastTime) / 1000
      if (deltaTime > 1) {
        const speed = (received - lastReceived) / deltaTime
        onProgress(received, length, speed)
        lastTime = now
        lastReceived = received
      }
      controller.enqueue(chunk)
    },
    flush() {
      onProgress(received, length, 0)
    },
  })

  return {
    stream: response.body.pipeThrough(transformStream),
    length,
  }
}

export async function downloadToOPFS(
  url: string,
  fileName: string,
  onProgress: (received: number, total: number, speed: number) => void,
) {
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('浏览器不支持 ReadableStream')
  }

  const length = parseInt(response.headers.get('Content-Length') || '0')
  let received = 0
  let lastTime = Date.now()
  let lastReceived = 0

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length
      const now = Date.now()
      const deltaTime = (now - lastTime) / 1000
      if (deltaTime > 1) {
        const speed = (received - lastReceived) / deltaTime
        onProgress(received, length, speed)
        lastTime = now
        lastReceived = received
      }
      controller.enqueue(chunk)
    },
    flush() {
      onProgress(received, length, 0)
    },
  })

  await response.body.pipeThrough(transformStream).pipeTo(writable)
  return fileHandle
}
