import { expect, test } from 'vitest'
import { BRAND_CLAUDE, BRAND_DEEPSEEK, BRAND_DEEPSEEK_LEGACY, PALETTE_CLAUDE, PALETTE_DEEPSEEK, PALETTE_HOST, PREF_DEFAULTS, USERNAME_MAX } from '../constants'
import { normalizePrefs } from './prefs'

test('an empty or unreadable value reads as the defaults', () => {
  expect(normalizePrefs({})).toEqual(PREF_DEFAULTS)
  expect(normalizePrefs(null)).toEqual(PREF_DEFAULTS)
  expect(normalizePrefs('nonsense')).toEqual(PREF_DEFAULTS)
})

test('a switch stays on unless stored as false', () => {
  expect(normalizePrefs({ viewTabs: false }).viewTabs).toBe(false)
  expect(normalizePrefs({ viewTabs: 0 }).viewTabs).toBe(true)
  expect(normalizePrefs({ viewTabs: 'false' }).viewTabs).toBe(true)
})

test('a choice outside its set reads as its default', () => {
  expect(normalizePrefs({ motion: 'reduced' }).motion).toBe('reduced')
  expect(normalizePrefs({ motion: 'sometimes' }).motion).toBe(PREF_DEFAULTS.motion)
  expect(normalizePrefs({ motion: 1 }).motion).toBe(PREF_DEFAULTS.motion)
})

test('the brand picks the mark alone, and the palette is a choice of its own', () => {
  expect(normalizePrefs({ brand: BRAND_DEEPSEEK }).brand).toBe(BRAND_DEEPSEEK)
  expect(normalizePrefs({ brand: BRAND_DEEPSEEK_LEGACY }).brand).toBe(BRAND_DEEPSEEK)
  expect(normalizePrefs({ brand: 'anthropic' }).brand).toBe(BRAND_CLAUDE)
  // The DeepSeek mark on the Claude palette stands: neither field carries the other.
  const crossed = normalizePrefs({ brand: BRAND_DEEPSEEK, palette: PALETTE_CLAUDE })
  expect(crossed.brand).toBe(BRAND_DEEPSEEK)
  expect(crossed.palette).toBe(PALETTE_CLAUDE)
})

test('the palette takes the two skin palettes and the host choice, anything else its default', () => {
  expect(normalizePrefs({ palette: PALETTE_DEEPSEEK }).palette).toBe(PALETTE_DEEPSEEK)
  expect(normalizePrefs({ palette: PALETTE_HOST }).palette).toBe(PALETTE_HOST)
  expect(normalizePrefs({ palette: 'warm' }).palette).toBe(PREF_DEFAULTS.palette)
})

test('the hover-open preference takes its earlier boolean shape', () => {
  expect(normalizePrefs({ autoPopover: true }).autoPopover).toBe('account')
  expect(normalizePrefs({ autoPopover: false }).autoPopover).toBe('off')
  expect(normalizePrefs({ autoPopover: 'account' }).autoPopover).toBe('account')
  expect(normalizePrefs({ autoPopover: 'often' }).autoPopover).toBe(PREF_DEFAULTS.autoPopover)
})

test('the username is trimmed and cut to its limit', () => {
  expect(normalizePrefs({ username: '  Ada  ' }).username).toBe('Ada')
  expect(normalizePrefs({ username: 'y'.repeat(USERNAME_MAX + 10) }).username).toHaveLength(USERNAME_MAX)
  expect(normalizePrefs({ username: 42 }).username).toBe('')
})
