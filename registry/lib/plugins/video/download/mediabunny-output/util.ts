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
  let acceptRanges = false
  let contentLength = 0

  try {
    // 变通方案：直接发起带有 Range: bytes=0-0 的 GET 请求，通过 206 状态码判断是否支持分片
    const probeController = new AbortController()
    const probeResponse = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      signal: probeController.signal,
    })

    if (probeResponse.status === 206) {
      acceptRanges = true

      // 如果跨域暴露了 Content-Range，直接提取文件总大小 (例如 bytes 0-0/123456)
      const contentRange = probeResponse.headers.get('Content-Range')
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/)
        if (match) {
          contentLength = parseInt(match[1])
        }
      }
    }
    // 无论是否支持，探测到 header 之后立即中断下载，节省带宽
    probeController.abort()

    // 如果支持分片但是 Content-Range 跨域被隐藏没拿到，再发起一次普通 GET 并立即中断读取 Content-Length
    if (acceptRanges && contentLength === 0) {
      const lengthController = new AbortController()
      const lengthResponse = await fetch(url, { signal: lengthController.signal })
      contentLength = parseInt(lengthResponse.headers.get('Content-Length') || '0')
      lengthController.abort()
    }
  } catch (error) {
    console.warn('分片段支持探测请求失败，将回退到单线程下载:', error)
  }

  const MIN_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB
  const THREAD_COUNT = 4

  if (acceptRanges && contentLength > MIN_CHUNK_SIZE) {
    return new Promise<FileSystemFileHandle>((resolve, reject) => {
      // 写入专用的 Web Worker (文件锁独占 & 高速同步写入，避免主线程卡死)
      const workerCode = `
        let accessHandle = null;
        self.onmessage = async (e) => {
          const { type, fileName, contentLength, offset, data } = e.data;
          try {
            if (type === 'init') {
              const root = await navigator.storage.getDirectory();
              const fileHandle = await root.getFileHandle(fileName, { create: true });
              accessHandle = await fileHandle.createSyncAccessHandle();
              // 预先分配空间，避免写入放大
              accessHandle.truncate(contentLength);
              self.postMessage({ type: 'inited' });
            } else if (type === 'write') {
              // 高性能同步直写
              accessHandle.write(data, { at: offset });
            } else if (type === 'close') {
              accessHandle.flush();
              accessHandle.close();
              self.postMessage({ type: 'done' });
            }
          } catch (error) {
            self.postMessage({ type: 'error', error: error.message || String(error) });
          }
        };
      `

      const blob = new Blob([workerCode], { type: 'application/javascript' })
      const workerUrl = URL.createObjectURL(blob)
      const worker = new Worker(workerUrl)

      let received = 0
      let lastTime = Date.now()
      let lastReceived = 0

      worker.onmessage = async e => {
        const { type, error } = e.data

        if (type === 'inited') {
          // Worker 初始化文件句柄并预分配空间成功，主线程主导并发下载以携带页面的 Referer 权限
          try {
            const chunkSize = Math.ceil(contentLength / THREAD_COUNT)
            const tasks = []

            const downloadChunk = async (start: number, end: number) => {
              const response = await fetch(url, {
                headers: {
                  Range: `bytes=${start}-${end}`,
                },
              })

              if (!response.ok || !response.body) {
                throw new Error(`分段下载失败: ${response.status}`)
              }

              const reader = response.body.getReader()
              let currentOffset = start

              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  break
                }

                // 将数据拷贝到 Worker 进行同步写入处理 (不用完全转移所有权以防底层切片异常)
                worker.postMessage({ type: 'write', offset: currentOffset, data: value })

                currentOffset += value.length
                received += value.length

                // 主线程计算并报告进度
                const now = Date.now()
                const deltaTime = (now - lastTime) / 1000
                if (deltaTime > 1) {
                  const speed = (received - lastReceived) / deltaTime
                  onProgress(received, contentLength, speed)
                  lastTime = now
                  lastReceived = received
                }
              }
            }

            for (let i = 0; i < THREAD_COUNT; i++) {
              const start = i * chunkSize
              const end = Math.min(start + chunkSize - 1, contentLength - 1)
              if (start > end) {
                break
              }

              tasks.push(downloadChunk(start, end))
            }

            // 等待所有分片下载完毕
            await Promise.all(tasks)

            // 最后一次进度更新
            onProgress(contentLength, contentLength, 0)

            // 通知 Worker 关闭句柄保存文件
            worker.postMessage({ type: 'close' })
          } catch (err) {
            worker.terminate()
            URL.revokeObjectURL(workerUrl)
            reject(err)
          }
        } else if (type === 'done') {
          worker.terminate()
          URL.revokeObjectURL(workerUrl)
          // File was successfully written by worker, let's grab its handle
          const root = await navigator.storage.getDirectory()
          const fileHandle = await root.getFileHandle(fileName)
          resolve(fileHandle)
        } else if (type === 'error') {
          worker.terminate()
          URL.revokeObjectURL(workerUrl)
          reject(new Error(`Worker error: ${error}`))
        }
      }

      worker.onerror = err => {
        URL.revokeObjectURL(workerUrl)
        reject(err)
      }

      // 请求 Worker 初始化与预分配
      worker.postMessage({ type: 'init', fileName, contentLength })
    })
  }
  // 降级使用原本的单线程下载（不需要预分片或者小文件）
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

  // fallback 到普通的 progress handler
  const length = contentLength || parseInt(response.headers.get('Content-Length') || '0')
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
