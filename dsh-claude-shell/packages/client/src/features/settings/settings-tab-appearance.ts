import * as React from 'react'
import { BRAND_CLAUDE, BRAND_DEEPSEEK, PALETTE_CLAUDE, PALETTE_DEEPSEEK, PALETTE_HOST, TYPEFACE_CLAUDE, TYPEFACE_HOST } from '../../constants'
import { settingsCopy } from '../../core/i18n'
import type { Prefs } from '../../constants'
import type { SettingsTab, SettingsView } from './settings-controls'

/**
 * The settings page's Appearance tab: the brand mark, the colours and the
 * typefaces.
 *
 * The mark and the colours are two independent choices: the cards below pick
 * which art the sidebar and the account avatar draw, and the Colours row picks
 * the palette every surface is painted from, that art's ink included. The brand
 * choice renders as a grid of large cards, each carrying the brand's own mark.
 */
export function createSettingsAppearanceTab(): SettingsTab {
  function brandPicker(prefs: Prefs, write: SettingsView['write']) {
    const brandOptions = [
      { value: BRAND_DEEPSEEK, label: settingsCopy('brandDeepseek', 'DeepSeek') },
      { value: BRAND_CLAUDE, label: settingsCopy('brandClaude', 'Claude') },
    ]
    // One card per brand: the brand's own mark above its name, the active
    // card outlined in the brand accent. The stylesheet picks the mark off
    // the logo's data-brand, so a new brand is one option here plus one
    // rule in settings.css.
    return React.createElement(
      'div',
      { className: 'dsh-claude-shell-brand-picker', role: 'group' },
      brandOptions.map(option => React.createElement(
        'button',
        {
          key: option.value,
          type: 'button',
          className: 'dsh-claude-shell-brand-card',
          'data-active': option.value === prefs.brand ? '' : undefined,
          'aria-pressed': option.value === prefs.brand ? 'true' : 'false',
          onClick: () => { if (option.value !== prefs.brand) write({ brand: option.value }) },
        },
        React.createElement('span', { className: 'dsh-claude-shell-brand-card-logo', 'data-brand': option.value }),
        React.createElement('span', { className: 'dsh-claude-shell-brand-card-name' }, option.label),
      )),
    )
  }

  function rows(view: SettingsView) {
    const prefs = view.prefs
    const write = view.write
    const controls = view.controls
    const paletteOptions = [
      { value: PALETTE_CLAUDE, label: settingsCopy('paletteClaude', 'Claude') },
      { value: PALETTE_DEEPSEEK, label: settingsCopy('paletteDeepseek', 'DeepSeek') },
      { value: PALETTE_HOST, label: settingsCopy('paletteHost', 'Follow the host') },
    ]
    const typefaceOptions = [
      { value: TYPEFACE_CLAUDE, label: settingsCopy('typefaceClaude', 'Claude') },
      { value: TYPEFACE_HOST, label: settingsCopy('typefaceHost', 'Follow the host') },
    ]
    return [
      {
        rank: 10,
        node: controls.row(
          'brand',
          settingsCopy('brandTitle', 'Brand mark'),
          settingsCopy('brandDesc', 'Which mark the sidebar and the account avatar draw: the Claude starburst with its wordmark, or DeepSeek\'s whale. The colours come from the row below.'),
          brandPicker(prefs, write),
          true,
        ),
      },
      {
        rank: 20,
        node: controls.row(
          'palette',
          settingsCopy('paletteTitle', 'Colours'),
          settingsCopy('paletteDesc', 'Claude and DeepSeek are the skin\'s own two palettes, and each paints every colour it draws. Follow the host leaves the colours to DSH and to other theme plugins (a wallpaper plugin, say), and the skin keeps only its layout and controls.'),
          controls.segment(paletteOptions, prefs.palette, value => { write({ palette: value }) }),
        ),
      },
      {
        rank: 30,
        node: controls.row(
          'typeface',
          settingsCopy('typefaceTitle', 'Typefaces'),
          settingsCopy('typefaceDesc', 'Claude uses the Anthropic faces (or the lookalike Inter and Noto Serif when they are missing) and JetBrains Mono for code; Follow the host keeps the fonts DSH or another plugin sets.'),
          controls.segment(typefaceOptions, prefs.typeface, value => { write({ typeface: value }) }),
        ),
      },
    ]
  }
  return { id: 'appearance', label: () => settingsCopy('tabAppearance', 'Appearance'), rows }
}
