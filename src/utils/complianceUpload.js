// Shared upload helpers for Compliance Inbox + Import routes.

export const UPLOAD_JOB_TONES = {
  queued: { bg: 'bg-gray-100', text: 'text-gray-700' },
  uploading: { bg: 'bg-blue-100', text: 'text-blue-700' },
  server_pending: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  completed: { bg: 'bg-green-100', text: 'text-green-800' },
  failed: { bg: 'bg-red-100', text: 'text-red-700' },
}

export async function collectFilesFromDataTransfer(dataTransfer) {
  const out = []
  if (!dataTransfer?.items) {
    return Array.from(dataTransfer?.files || [])
  }
  for (const item of Array.from(dataTransfer.items)) {
    const entry = item.webkitGetAsEntry?.()
    if (!entry) {
      const f = item.getAsFile()
      if (f) out.push(f)
    } else if (entry.isFile) {
      const f = await new Promise((resolve) => entry.file(resolve))
      if (f) out.push(f)
    } else if (entry.isDirectory) {
      const nested = await collectDirectoryFiles(entry)
      out.push(...nested)
    }
  }
  return out
}

async function collectDirectoryFiles(dirEntry) {
  const files = []
  const queue = [dirEntry]
  while (queue.length > 0) {
    const cur = queue.shift()
    const reader = cur.createReader()
    while (true) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve))
      if (!batch || batch.length === 0) break
      for (const entry of batch) {
        if (entry.isFile) {
          const file = await new Promise((resolve) => entry.file(resolve))
          if (file) files.push(file)
        } else if (entry.isDirectory) {
          queue.push(entry)
        }
      }
      if (batch.length < 100) break
    }
  }
  return files
}
