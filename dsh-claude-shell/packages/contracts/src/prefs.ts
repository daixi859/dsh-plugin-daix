/**
 * The preference defaults, shared by both halves (D46): the host half's Config
 * is generated from this table (packages/host/src/settings.ts, D10) and the
 * browser half reads it as the value each preference holds until the settings
 * form answers.
 */
export const PREFS_DEFAULT = Object.freeze({
  brand: 'claude',
  motion: 'system',
  collapseFooter: true,
  autoPopover: 'account',
  username: '',
  palette: 'claude',
  typeface: 'claude',
  viewTabs: true,
  headerBand: true,
})
