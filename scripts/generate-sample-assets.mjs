import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const outputDirectory = resolve(import.meta.dirname, '../apps/web/public/assets/sample')
mkdirSync(outputDirectory, { recursive: true })

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function writePng(filename, image) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc((image.width * 4 + 1) * image.height)
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (image.width * 4 + 1)
    rows[rowStart] = 0
    Buffer.from(image.pixels.buffer, image.pixels.byteOffset + y * image.width * 4, image.width * 4).copy(rows, rowStart + 1)
  }
  writeFileSync(resolve(outputDirectory, filename), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

function createImage(width, height, background = [0, 0, 0, 0]) {
  const pixels = new Uint8Array(width * height * 4)
  const image = { width, height, pixels }
  fillRect(image, 0, 0, width, height, background)
  return image
}

function blendPixel(image, x, y, color) {
  x = Math.round(x)
  y = Math.round(y)
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const index = (y * image.width + x) * 4
  const alpha = (color[3] ?? 255) / 255
  const inverse = 1 - alpha
  image.pixels[index] = Math.round(color[0] * alpha + image.pixels[index] * inverse)
  image.pixels[index + 1] = Math.round(color[1] * alpha + image.pixels[index + 1] * inverse)
  image.pixels[index + 2] = Math.round(color[2] * alpha + image.pixels[index + 2] * inverse)
  image.pixels[index + 3] = Math.round((alpha + image.pixels[index + 3] / 255 * inverse) * 255)
}

function fillRect(image, x, y, width, height, color) {
  for (let row = Math.max(0, y); row < Math.min(image.height, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(image.width, x + width); column += 1) blendPixel(image, column, row, color)
  }
}

function ellipse(image, centerX, centerY, radiusX, radiusY, color) {
  for (let y = Math.floor(centerY - radiusY); y <= Math.ceil(centerY + radiusY); y += 1) {
    for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x += 1) {
      const distance = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2
      if (distance <= 1) blendPixel(image, x, y, color)
    }
  }
}

function polygon(image, points, color) {
  const minY = Math.floor(Math.min(...points.map((point) => point[1])))
  const maxY = Math.ceil(Math.max(...points.map((point) => point[1])))
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = []
    for (let index = 0; index < points.length; index += 1) {
      const first = points[index]
      const second = points[(index + 1) % points.length]
      if ((first[1] <= y && second[1] > y) || (second[1] <= y && first[1] > y)) {
        intersections.push(first[0] + (y - first[1]) * (second[0] - first[0]) / (second[1] - first[1]))
      }
    }
    intersections.sort((left, right) => left - right)
    for (let index = 0; index < intersections.length; index += 2) {
      for (let x = Math.ceil(intersections[index]); x <= Math.floor(intersections[index + 1]); x += 1) blendPixel(image, x, y, color)
    }
  }
}

function line(image, x1, y1, x2, y2, width, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
  for (let step = 0; step <= steps; step += 1) {
    const t = steps ? step / steps : 0
    ellipse(image, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, width / 2, color)
  }
}

function seeded(seed) {
  let value = seed >>> 0
  return () => {
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function makeTabletop() {
  const image = createImage(512, 512, [25, 28, 24, 255])
  const random = seeded(713)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const grain = Math.floor((random() - 0.5) * 18)
      blendPixel(image, x, y, [35 + grain, 39 + grain, 34 + grain, 110])
    }
  }
  for (let index = 0; index < 42; index += 1) {
    const y = Math.floor(random() * 512)
    line(image, 0, y, 512, y + (random() - 0.5) * 7, 1, [10, 12, 10, 42])
  }
  writePng('tabletop.png', image)
}

function makePaper() {
  const image = createImage(1280, 820, [218, 214, 199, 255])
  const random = seeded(20260728)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const edge = Math.min(x, y, image.width - x, image.height - y)
      const grain = Math.floor((random() - 0.5) * 16) - (edge < 28 ? Math.floor((28 - edge) * 0.35) : 0)
      blendPixel(image, x, y, [218 + grain, 214 + grain, 199 + grain, 125])
    }
  }
  for (let index = 0; index < 95; index += 1) {
    const x = random() * 1280
    const y = random() * 820
    ellipse(image, x, y, 1 + random() * 3, 1 + random() * 2, [70, 73, 65, 18])
  }
  line(image, 390, 0, 430, 820, 3, [92, 88, 73, 16])
  line(image, 392, 0, 432, 820, 1, [255, 255, 245, 25])
  writePng('paper-board.png', image)
}

function makeDog() {
  const image = createImage(256, 256)
  const ink = [49, 48, 40, 255]
  const yellow = [219, 163, 56, 255]
  ellipse(image, 132, 148, 78, 46, ink)
  ellipse(image, 132, 145, 72, 40, yellow)
  ellipse(image, 78, 112, 43, 46, ink)
  ellipse(image, 79, 111, 38, 40, yellow)
  polygon(image, [[49, 80], [32, 35], [73, 67]], ink)
  polygon(image, [[109, 72], [128, 35], [116, 91]], ink)
  polygon(image, [[52, 77], [37, 44], [71, 70]], [171, 109, 44, 255])
  polygon(image, [[106, 72], [124, 44], [115, 88]], [171, 109, 44, 255])
  ellipse(image, 58, 107, 5, 6, ink)
  ellipse(image, 91, 101, 5, 6, ink)
  ellipse(image, 73, 127, 20, 13, [239, 197, 111, 255])
  ellipse(image, 64, 121, 6, 4, ink)
  line(image, 185, 135, 225, 102, 13, ink)
  line(image, 185, 134, 222, 103, 7, yellow)
  for (const x of [90, 145, 174]) {
    line(image, x, 172, x - 3, 219, 18, ink)
    line(image, x, 172, x - 3, 217, 11, yellow)
  }
  line(image, 43, 231, 204, 231, 3, [45, 44, 38, 90])
  writePng('yellow-dog.png', image)
}

function makeRepairRoom() {
  const image = createImage(256, 256)
  const ink = [50, 51, 45, 255]
  polygon(image, [[42, 104], [128, 43], [220, 104]], ink)
  polygon(image, [[51, 101], [128, 52], [210, 101]], [91, 105, 94, 255])
  fillRect(image, 55, 100, 150, 120, ink)
  fillRect(image, 61, 106, 138, 108, [160, 157, 136, 255])
  fillRect(image, 112, 144, 46, 70, ink)
  fillRect(image, 119, 151, 32, 63, [76, 82, 72, 255])
  fillRect(image, 74, 122, 28, 28, ink)
  fillRect(image, 79, 127, 18, 18, [184, 205, 199, 255])
  line(image, 123, 91, 155, 123, 9, ink)
  line(image, 153, 91, 121, 123, 9, ink)
  ellipse(image, 121, 91, 10, 10, ink)
  ellipse(image, 155, 91, 10, 10, ink)
  writePng('repair-room.png', image)
}

function makeBeach() {
  const image = createImage(256, 256)
  const ink = [50, 51, 45, 255]
  ellipse(image, 130, 211, 101, 20, [197, 164, 92, 210])
  line(image, 126, 74, 126, 205, 8, ink)
  polygon(image, [[32, 105], [126, 41], [223, 105]], ink)
  polygon(image, [[42, 100], [126, 49], [213, 100]], [217, 91, 73, 255])
  polygon(image, [[126, 49], [126, 100], [181, 100]], [235, 221, 191, 255])
  line(image, 58, 184, 94, 151, 7, ink)
  line(image, 94, 151, 120, 185, 7, ink)
  writePng('scavenger-beach.png', image)
}

function makeFinish() {
  const image = createImage(256, 256)
  const ink = [44, 46, 41, 255]
  polygon(image, [[32, 115], [126, 35], [226, 115]], ink)
  polygon(image, [[43, 111], [126, 47], [214, 111]], [180, 77, 92, 255])
  fillRect(image, 51, 110, 158, 113, ink)
  fillRect(image, 58, 117, 144, 99, [99, 104, 91, 255])
  fillRect(image, 104, 154, 52, 62, [35, 37, 33, 255])
  ellipse(image, 180, 148, 13, 13, [216, 165, 57, 255])
  line(image, 74, 137, 91, 154, 5, [225, 218, 196, 255])
  line(image, 91, 137, 74, 154, 5, [225, 218, 196, 255])
  writePng('sample-finish.png', image)
}

makeTabletop()
makePaper()
makeDog()
makeRepairRoom()
makeBeach()
makeFinish()
