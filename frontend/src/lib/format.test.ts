import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatBytes, formatType, formatWhen, shortHash } from './format'

describe('formatBytes', () => {
  it('keeps small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('picks the unit after rounding', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1_048_575)).toBe('1.0 MB') // not "1024.0 KB"
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB')
  })
})

describe('formatType', () => {
  it('shows the short name of an image type', () => {
    expect(formatType('image/jpeg')).toBe('JPG')
    expect(formatType('image/png')).toBe('PNG')
    expect(formatType('image/heic')).toBe('HEIC')
  })
})

describe('shortHash', () => {
  it('keeps the start and end of a hash', () => {
    expect(shortHash('0123456789abcdef'.repeat(4))).toBe('01234567…abcdef')
  })
})

describe('formatWhen', () => {
  afterEach(() => vi.useRealTimers())

  it('reads recent times relatively, and older ones as a date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
    expect(formatWhen('2026-10-31T11:59:45Z')).toBe('Just now')
    expect(formatWhen('2026-10-31T11:55:00Z')).toMatch(/5 minutes ago/)
    expect(formatWhen('2026-10-31T09:00:00Z')).toMatch(/3 hours ago/)
    expect(formatWhen('2026-10-29T12:00:00Z')).toMatch(/2 days ago/)
    expect(formatWhen('2026-09-01T12:00:00Z')).toMatch(/2026/)
  })
})
