import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import type { SkinContentDefinition } from '@goose-chess/game-content'

const MAX_INPUT_PIXELS = 4096 * 4096
const MIN_SOURCE_SIZE = 256
const MAX_SOURCE_SIZE = 4096
const MIN_SUBJECT_SIZE = 128
const RUNTIME_SIZE = 512
const THUMBNAIL_SIZE = 160
const SUBJECT_MAX_WIDTH = 400
const SUBJECT_MAX_HEIGHT = 440
const SUBJECT_BOTTOM_MARGIN = 24
const ALPHA_THRESHOLD = 16
const BACKGROUND_COLOR_THRESHOLD = 48

export interface SkinProductionMetadata {
  readonly source: string
  readonly thumbnail: string
  readonly shadow: string
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly subjectWidth: number
  readonly subjectHeight: number
  readonly transparentPixelRatio: number
}

export interface ProcessedSkinDefinition extends SkinContentDefinition {
  readonly production: SkinProductionMetadata
}

export class SkinProcessingError extends Error {
  readonly status = 400

  constructor(readonly code: string, message: string) {
    super(message)
  }
}

function extensionFor(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/webp') return 'webp'
  throw new SkinProcessingError('unsupported_skin_type', '仅支持 PNG、JPEG 或 WebP 棋子图片。')
}

async function writeHashedAsset(directory: string, body: Buffer, extension: string) {
  const hash = createHash('sha256').update(body).digest('hex')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, `${hash}.${extension}`), body, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  return `/content-assets/${hash}.${extension}`
}

function inspectAlpha(body: Buffer, width: number, height: number, channels: number) {
  let transparentPixels = 0
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  let touchesEdge = false
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = body[(y * width + x) * channels + channels - 1]
      if (alpha < 250) transparentPixels += 1
      if (alpha <= ALPHA_THRESHOLD) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
    }
  }
  return {
    transparentPixelRatio: transparentPixels / (width * height),
    touchesEdge,
    bounds: right >= left && bottom >= top
      ? { left, top, width: right - left + 1, height: bottom - top + 1 }
      : null,
  }
}

function colorDistance(body: Buffer, offset: number, color: readonly number[]) {
  return Math.hypot(body[offset] - color[0], body[offset + 1] - color[1], body[offset + 2] - color[2])
}

function removeUniformEdgeBackground(body: Buffer, width: number, height: number, channels: number) {
  const cornerIndexes = [0, width - 1, (height - 1) * width, width * height - 1]
  const background = [0, 1, 2].map((channel) => Math.round(
    cornerIndexes.reduce((sum, index) => sum + body[index * channels + channel], 0) / cornerIndexes.length,
  ))
  if (cornerIndexes.some((index) => colorDistance(body, index * channels, background) > BACKGROUND_COLOR_THRESHOLD)) return false

  const pixelCount = width * height
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 0
  const enqueue = (index: number) => {
    if (visited[index] || colorDistance(body, index * channels, background) > BACKGROUND_COLOR_THRESHOLD) return
    visited[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]
    body[index * channels + channels - 1] = 0
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }
  return tail / pixelCount >= 0.01
}

async function createShadow() {
  const ellipse = Buffer.from(`
    <svg width="256" height="80" viewBox="0 0 256 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="128" cy="40" rx="100" ry="22" fill="black" fill-opacity="0.42" />
    </svg>
  `)
  return sharp({
    create: { width: 256, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: ellipse }]).blur(7).png().toBuffer()
}

export async function processSkinImage(input: {
  readonly body: Buffer
  readonly contentType: string
  readonly displayName: string
  readonly assetDirectory: string
}): Promise<ProcessedSkinDefinition> {
  const displayName = input.displayName.trim()
  if (displayName.length === 0 || displayName.length > 40) {
    throw new SkinProcessingError('invalid_skin_name', '皮肤展示名长度必须为 1 至 40 个字符。')
  }
  const sourceExtension = extensionFor(input.contentType)
  const sourceHash = createHash('sha256').update(input.body).digest('hex')
  let decoded
  try {
    decoded = await sharp(input.body, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  } catch {
    throw new SkinProcessingError('invalid_skin_image', '图片无法安全解码，请重新导出后再试。')
  }
  const { width, height, channels } = decoded.info
  if (width < MIN_SOURCE_SIZE || height < MIN_SOURCE_SIZE) {
    throw new SkinProcessingError('skin_image_too_small', `原图尺寸不能小于 ${MIN_SOURCE_SIZE}×${MIN_SOURCE_SIZE}。`)
  }
  if (width > MAX_SOURCE_SIZE || height > MAX_SOURCE_SIZE) {
    throw new SkinProcessingError('skin_image_too_large', `原图尺寸不能超过 ${MAX_SOURCE_SIZE}×${MAX_SOURCE_SIZE}。`)
  }
  let alpha = inspectAlpha(decoded.data, width, height, channels)
  if (alpha.transparentPixelRatio < 0.01) {
    if (!removeUniformEdgeBackground(decoded.data, width, height, channels)) {
      throw new SkinProcessingError('skin_background_not_transparent', '无法可靠分离当前背景，请上传透明图片或使用颜色均匀的纯色背景。')
    }
    alpha = inspectAlpha(decoded.data, width, height, channels)
  }
  if (!alpha.bounds) {
    throw new SkinProcessingError('skin_subject_missing', '图片中没有检测到可见棋子主体。')
  }
  if (alpha.touchesEdge) {
    throw new SkinProcessingError('skin_subject_cropped', '棋子主体接触图片边缘，可能存在严重裁切，请为主体保留透明边距。')
  }
  if (alpha.bounds.width < MIN_SUBJECT_SIZE || alpha.bounds.height < MIN_SUBJECT_SIZE) {
    throw new SkinProcessingError('skin_subject_too_small', `棋子主体有效尺寸不能小于 ${MIN_SUBJECT_SIZE}×${MIN_SUBJECT_SIZE}。`)
  }

  const subject = await sharp(decoded.data, {
    raw: { width, height, channels },
  }).extract(alpha.bounds).resize({
    width: SUBJECT_MAX_WIDTH,
    height: SUBJECT_MAX_HEIGHT,
    fit: 'inside',
    withoutEnlargement: true,
  }).png().toBuffer({ resolveWithObject: true })
  const runtime = await sharp({
    create: { width: RUNTIME_SIZE, height: RUNTIME_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: subject.data,
    left: Math.round((RUNTIME_SIZE - subject.info.width) / 2),
    top: RUNTIME_SIZE - SUBJECT_BOTTOM_MARGIN - subject.info.height,
  }]).png().toBuffer()
  const thumbnail = await sharp(runtime).resize({
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer()
  const shadow = await createShadow()
  const [sourceUrl, runtimeUrl, thumbnailUrl, shadowUrl] = await Promise.all([
    writeHashedAsset(input.assetDirectory, input.body, sourceExtension),
    writeHashedAsset(input.assetDirectory, runtime, 'png'),
    writeHashedAsset(input.assetDirectory, thumbnail, 'png'),
    writeHashedAsset(input.assetDirectory, shadow, 'png'),
  ])
  return {
    id: `skin-${sourceHash.slice(0, 12)}`,
    version: 1,
    title: displayName,
    name: displayName,
    atlas: runtimeUrl,
    animations: { idle: 'static', active: 'static', hop: 'static', hit: 'static' },
    anchor: { x: 0.5, y: 1 },
    shadowScale: Number(Math.max(0.65, Math.min(1.35, subject.info.width / 320)).toFixed(3)),
    production: {
      source: sourceUrl,
      thumbnail: thumbnailUrl,
      shadow: shadowUrl,
      sourceWidth: width,
      sourceHeight: height,
      subjectWidth: alpha.bounds.width,
      subjectHeight: alpha.bounds.height,
      transparentPixelRatio: Number(alpha.transparentPixelRatio.toFixed(4)),
    },
  }
}
