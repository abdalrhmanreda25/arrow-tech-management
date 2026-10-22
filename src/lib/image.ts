'use client'

/**
 * Image handling without Cloud Storage: the browser shrinks the picture on a
 * canvas and returns a JPEG data URL small enough to live in a Firestore
 * document (1 MiB limit). Same approach as market-neurons-tasks/lib/avatar.js.
 */

export const MAX_INPUT_BYTES = 15 * 1024 * 1024

/** Largest width/height that fits inside `max` while keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max: number) {
  if (width <= max && height <= max) return { width: Math.round(width), height: Math.round(height) }
  const scale = max / Math.max(width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

interface Options {
  /** Longest side in pixels (or the square side when `square`). */
  max: number
  square?: boolean
  /** Aim for a data URL at most this many characters long. */
  target: number
  /** Refuse anything still longer than this after compressing. */
  limit: number
}

function load(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    img.src = url
  })
}

export async function compressImage(file: File, opts: Options) {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file (PNG, JPEG, WebP or GIF).')
  if (file.size > MAX_INPUT_BYTES) throw new Error('That image is larger than 15 MB.')
  const img = await load(file)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')

  if (opts.square) {
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    canvas.width = canvas.height = Math.min(opts.max, side)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
  } else {
    const size = fitWithin(img.naturalWidth, img.naturalHeight, opts.max)
    canvas.width = size.width
    canvas.height = size.height
    ctx.imageSmoothingQuality = 'high'
    // JPEG has no transparency; paint white so transparent PNGs do not turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  }

  // Step quality down, then size, until it fits.
  let quality = 0.85
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > opts.target && quality > 0.45) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  while (dataUrl.length > opts.target && canvas.width > 320) {
    const prev = document.createElement('canvas')
    prev.width = canvas.width
    prev.height = canvas.height
    prev.getContext('2d')!.drawImage(canvas, 0, 0)
    canvas.width = Math.round(canvas.width * 0.8)
    canvas.height = Math.round(canvas.height * 0.8)
    ctx.drawImage(prev, 0, 0, canvas.width, canvas.height)
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > opts.limit) throw new Error('That image is too detailed to store. Try a smaller crop.')
  return { dataUrl, width: canvas.width, height: canvas.height }
}

/** Profile photo: 256px square, about 15-25 KB. */
export const AVATAR = { max: 256, square: true, target: 60_000, limit: 140_000 }

/** Item screenshot: up to 1600px, about 300 KB, always well under Firestore's 1 MiB. */
export const SCREENSHOT = { max: 1600, target: 420_000, limit: 680_000 }

/** How many screenshots one item keeps; each costs a document read when the item opens. */
export const MAX_IMAGES_PER_ITEM = 6
