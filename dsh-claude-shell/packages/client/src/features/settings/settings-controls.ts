import * as React from 'react'
import { switchRowFeatures } from '../../core/feature'
import { settingsCopy } from '../../core/i18n'
import { createSlidingPill } from '../../shared/sliding-pill'
import type { Prefs } from '../../constants'
import type { SettingsTabId } from '../../core/feature'

/**
 * The settings page's controls: the segmented control, the switch, the row
 * shell and the indented sub-row. Every tab builds its rows from these, so
 * the page reads as one control set whichever tab is open.
 *
 * The segmented controls carry the skin-owned `.dsh-claude-shell-segments` /
 * `.dsh-claude-shell-segment` classes and the shared sliding highlight.
 */

/** Skin-owned class names of the segmented control, so nothing couples to hashed CSS-module classes. */
export const SEGMENTS_CLASS = 'dsh-claude-shell-segments'
export const SEGMENT_CLASS = 'dsh-claude-shell-segment'

/** One choice of a segmented control. */
export interface SegmentOption {
  value: string
  label: string
}

/** The control builders createSettingsControls returns. */
export type SettingsControls = ReturnType<typeof createSettingsControls>

/** What a tab's rows are built from on every render of the page (settings.ts). */
export interface SettingsView {
  prefs: Prefs
  write(patch: Partial<Prefs>): void
  controls: SettingsControls
  username: {
    value: string
    onChange(e: React.ChangeEvent<HTMLInputElement>): void
    onBlur(): void
    onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void
  }
}

/** One row of a tab, with its place among the tab's rows and the switch rows the manifests add (D42). */
export interface SettingsRow {
  rank: number
  node: React.ReactNode
}

/** One tab of the settings page: its id, its strip label and the rows it writes itself. */
export interface SettingsTab {
  id: SettingsTabId
  label(): string
  rows(view: SettingsView): SettingsRow[]
}

/**
 * The tab's whole row list: its own rows and the switch rows of the features
 * whose manifests place one here, in rank order.
 */
export function tabRows(tab: SettingsTab, view: SettingsView) {
  const rows = [...tab.rows(view), ...switchRows(tab.id, view)]
  return rows.sort((a, b) => a.rank - b.rank).map(row => row.node)
}

/**
 * The on/off and choice rows the manifests declare for a tab: without
 * `choices` the row carries a switch, with them a segmented control.
 */
function switchRows(tab: SettingsTabId, view: SettingsView): SettingsRow[] {
  const controls = view.controls
  return switchRowFeatures(tab).map(feature => {
    const pref = feature.pref
    const row = feature.switchRow
    const stored = view.prefs[pref]
    const write = (value: string | boolean) => { view.write({ [pref]: value }) }
    const control = row.choices === undefined
      ? controls.toggle(stored !== false, write)
      : controls.segment(
        row.choices.map(choice => ({ value: choice.value, label: settingsCopy(choice.label.key, choice.label.fallback) })),
        String(stored),
        write,
      )
    return {
      rank: row.rank,
      node: controls.row(
        pref,
        settingsCopy(row.title.key, row.title.fallback),
        settingsCopy(row.desc.key, row.desc.fallback),
        control,
      ),
    }
  })
}

/**
 * One segmented control on the page, carrying the shared sliding highlight
 * (packages/client/src/shared/sliding-pill.ts). The group is React's, so the pill is
 * placed from a layout effect after every render — before the frame is
 * painted — and taken off when the group unmounts. `role` defaults to a
 * plain group; the tab strip passes `tablist`.
 */
export function ClaudeShellSegmentGroup(props: { role?: string, className?: string, children?: React.ReactNode }) {
  const group = React.useRef<HTMLDivElement>(null)
  const pill = React.useRef<ReturnType<typeof createSlidingPill> | null>(null)
  React.useLayoutEffect(() => {
    pill.current = createSlidingPill('[data-active]')
    return () => {
      pill.current!.release()
      pill.current = null
    }
  }, [])
  React.useLayoutEffect(() => {
    pill.current!.sync(group.current)
  })
  const className = props.className ? `${SEGMENTS_CLASS} ${props.className}` : SEGMENTS_CLASS
  return React.createElement('div', { ref: group, className, role: props.role || 'group' }, props.children)
}

/**
 * The control builders. They hold no state of their own: every value and
 * every write arrives through the arguments, so one set serves every tab.
 * @returns { segment, toggle, row }.
 */
export function createSettingsControls() {
  /** A segmented control. */
  function segment(options: SegmentOption[], active: string, onPick: (value: string) => void) {
    const buttons: React.ReactElement[] = []
    for (let i = 0; i < options.length; i++) {
      buttons.push(React.createElement(
        'button',
        {
          key: options[i].value,
          type: 'button',
          className: SEGMENT_CLASS,
          'data-active': options[i].value === active ? '' : undefined,
          'aria-pressed': options[i].value === active ? 'true' : 'false',
          onClick: (value => () => {
            if (value !== active) onPick(value)
          })(options[i].value),
        },
        options[i].label,
      ))
    }
    return React.createElement(ClaudeShellSegmentGroup, null, buttons)
  }

  /** An on/off switch. */
  function toggle(on: boolean, onPick: (value: boolean) => void) {
    return React.createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-claude-shell-settings-switch',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'data-on': on ? '' : undefined,
        onClick() { onPick(!on) },
      },
      React.createElement('span', { className: 'dsh-claude-shell-settings-switch-knob' }),
    )
  }

  /**
   * One row: title and description on the left, the control on the right.
   * A block row stacks its control under the text across the row's full
   * width. A row carrying a segmented control is marked as such: that control
   * is wide, and the stylesheet keeps it on the right while it fits and gives it
   * the next line when it does not (settings.css).
   */
  function row(key: string, title: string, description: React.ReactNode, control: React.ReactNode, block?: boolean) {
    const classes = ['dsh-claude-shell-settings-row']
    if (block) classes.push('dsh-claude-shell-settings-row-block')
    else if (React.isValidElement(control) && control.type === ClaudeShellSegmentGroup) classes.push('dsh-claude-shell-settings-row-segment')
    return React.createElement(
      'div',
      { className: classes.join(' '), key },
      React.createElement(
        'div',
        { className: 'dsh-claude-shell-settings-row-text' },
        React.createElement('div', { className: 'dsh-claude-shell-settings-row-title' }, title),
        React.createElement('div', { className: 'dsh-claude-shell-settings-row-desc' }, description),
      ),
      control,
    )
  }

  return { segment, toggle, row }
}
