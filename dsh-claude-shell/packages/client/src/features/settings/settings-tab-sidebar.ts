import { settingsCopy } from '../../core/i18n'
import type { SettingsRow, SettingsTab } from './settings-controls'

/**
 * The settings page's Sidebar tab: the footer takeover, a feature switch placed
 * here by its manifest (D42), so the tab writes no row of its own.
 */
export function createSettingsSidebarTab(): SettingsTab {
  return { id: 'sidebar', label: () => settingsCopy('tabSidebar', 'Sidebar'), rows: (): SettingsRow[] => [] }
}
