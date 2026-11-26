// Desktop's main.css tokens per scheme; keep mobile on these instead of introducing inline colors.

export type MobileColorScheme = 'light' | 'dark'

const darkColors = {
  // --background, --sidebar, --secondary, --border
  bgBase: '#14110f',
  bgPanel: '#1c1815',
  bgRaised: '#2a2420',
  borderSubtle: 'rgba(255, 235, 210, 0.08)',
  editorSurface: '#1e1a17',
  // Sheets sit a step above the screen, their groups a step above the sheet (the desktop's sidebar and secondary).
  sheetSurface: '#1c1815',
  sheetGroup: '#2a2420',
  // A translucent grey that reads on any surface: off switches, and chips or picked segments on a sheet group.
  translucentFill: 'rgba(130, 118, 106, 0.36)',
  // --chat-composer-surface painted over --chat-canvas, and --chat-composer-border.
  composerSurface: '#282421',
  composerBorder: 'rgba(255, 235, 210, 0.09)',
  composerControl: '#2a2420',
  // A text field's edge, 3:1 on the screen, a sheet and a sheet group (WCAG 1.4.11).
  inputBorder: '#7d7268',
  skillToken: '#8ab4f8',
  skillTokenSurface: 'rgba(59, 130, 246, 0.2)',
  // Your own message: --chat-user-surface and --chat-user-border over --chat-canvas, text in --chat-foreground-strong.
  chatUserSurface: '#2a2420',
  chatUserBorder: 'rgba(255, 235, 210, 0.06)',
  chatForegroundStrong: '#ddd6cf',

  // --foreground, --muted-foreground, --chat-foreground-faint
  textPrimary: '#f2ebe3',
  textSecondary: '#b0a497',
  textMuted: '#8f8780',

  // --primary: the filled primary-action surface.
  surfaceBright: '#ece4da',
  // A list screen's floating create (+) button: the accent, as on Home, since a pale disc glares on the dark page.
  createActionFill: '#f2a93b',
  onCreateActionFill: '#1a1208',

  accent: '#f2a93b',
  // Desktop's dark --primary (helmet amber) and --primary-foreground ink; light uses clay with white.
  onAccent: '#1a1208',

  // --status-success, --status-warning, --destructive
  statusGreen: '#86efac',
  statusAmber: '#eab308',
  statusRed: '#ff6568',
  // Desktop's --destructive-foreground: dark ink on the light-red dark fill.
  onStatusRed: '#450a0a',
  // Match desktop’s merge CTA fill and text.
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  // Desktop's merged-PR purple (`dark:text-purple-300`).
  statusPurple: '#d8b4fe',
  gitDecorationAdded: '#81b88b',
  gitDecorationDeleted: '#c74e39',
  // Desktop's `--diff-*-ground` and `--diff-*-gutter` mixes.
  diffAddedBg: 'rgba(129, 184, 139, 0.16)',
  diffDeletedBg: 'rgba(199, 78, 57, 0.18)',
  diffAddedGutter: 'rgba(129, 184, 139, 0.3)',
  diffDeletedGutter: 'rgba(199, 78, 57, 0.32)',
  // Desktop's `--chat-diff-*`: decoration mixed toward foreground for tinted rows.
  chatDiffAdded: '#a5ccac',
  chatDiffRemoved: '#d68273',

  // Monaco's `vs-dark`; function and meta come from VS Code Dark+, which Monaco lacks.
  syntaxComment: '#608b4e',
  syntaxKeyword: '#569cd6',
  syntaxString: '#ce9178',
  syntaxNumber: '#b5cea8',
  syntaxType: '#3dc9b0',
  syntaxFunction: '#dcdcaa',
  syntaxVariable: '#74b0df',
  syntaxMeta: '#c586c0',

  // Terminal WebView background (Tokyonight) — separate from app chrome
  terminalBg: '#1a1b26'
}

export type MobilePalette = { readonly [K in keyof typeof darkColors]: string }

const lightColors: MobilePalette = {
  bgBase: '#fbf8f4',
  bgPanel: '#f7f2ec',
  bgRaised: '#f3ede5',
  borderSubtle: '#e6ddd1',
  editorSurface: '#fffdfa',
  // Light inverts it: a grey sheet under white groups, as iOS does.
  sheetSurface: '#f3ede5',
  sheetGroup: '#fffdfa',
  translucentFill: 'rgba(130, 118, 106, 0.16)',
  composerSurface: '#fffdfa',
  composerBorder: 'rgba(28, 23, 19, 0.11)',
  composerControl: '#f3ede5',
  // Desktop's light --ring is under 3:1 on its background, so both schemes share one warm grey.
  inputBorder: '#7d7268',
  skillToken: '#1d4ed8',
  skillTokenSurface: 'rgba(59, 130, 246, 0.12)',
  chatUserSurface: '#f3ede5',
  chatUserBorder: 'rgba(28, 23, 19, 0.07)',
  chatForegroundStrong: '#2e2925',

  textPrimary: '#1c1713',
  textSecondary: '#6e6257',
  textMuted: '#6e6257',

  surfaceBright: '#2a221c',
  createActionFill: '#b4561a',
  onCreateActionFill: '#ffffff',

  accent: '#b4561a',
  onAccent: '#ffffff',

  statusGreen: '#147638',
  statusAmber: '#ca8a04',
  statusRed: '#e40014',
  onStatusRed: '#ffffff',
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  statusPurple: '#9333ea',
  gitDecorationAdded: '#587c0c',
  gitDecorationDeleted: '#ad0707',
  diffAddedBg: 'rgba(88, 124, 12, 0.13)',
  diffDeletedBg: 'rgba(173, 7, 7, 0.11)',
  diffAddedGutter: 'rgba(88, 124, 12, 0.26)',
  diffDeletedGutter: 'rgba(173, 7, 7, 0.22)',
  chatDiffAdded: '#415a0b',
  chatDiffRemoved: '#7c0808',

  // Monaco's `vs`; function and meta from VS Code Light+.
  syntaxComment: '#008000',
  syntaxKeyword: '#0000ff',
  syntaxString: '#a31515',
  syntaxNumber: '#098658',
  syntaxType: '#008080',
  syntaxFunction: '#795e26',
  syntaxVariable: '#001188',
  syntaxMeta: '#af00db',

  terminalBg: '#1a1b26'
}

const palettes: Record<MobileColorScheme, MobilePalette> = { dark: darkColors, light: lightColors }

export function paletteForScheme(scheme: MobileColorScheme): MobilePalette {
  return palettes[scheme]
}

// Live object rewritten in place on a scheme change; read it at render time, never copy at module scope.
export const colors: MobilePalette = { ...darkColors }

let currentScheme: MobileColorScheme = 'dark'
const schemeListeners = new Set<() => void>()

export function getMobileColorScheme(): MobileColorScheme {
  return currentScheme
}

export function applyMobileColorScheme(scheme: MobileColorScheme): void {
  if (scheme === currentScheme) {
    return
  }
  currentScheme = scheme
  Object.assign(colors, palettes[scheme])
  for (const listener of schemeListeners) {
    listener()
  }
}

export function subscribeMobileColorScheme(listener: () => void): () => void {
  schemeListeners.add(listener)
  return () => {
    schemeListeners.delete(listener)
  }
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24
} as const

// Three shape types: one radius for what you tap, one for what holds content, and concentric nesting.
export const radii = {
  /** Everything you tap: buttons, icon buttons, text fields, pickers, segmented controls, key caps. */
  control: 12,
  /** Labels and round buttons: badges, chips, status pills, dots, avatars, and the composer's own buttons. */
  pill: 999,
  /** Everything that holds content: cards, groups, sheets, banners, code boxes, multi-line boxes, menus. */
  surface: 16,
  /** Layers floating over content: the composer box and dialogs. */
  floating: 24,
  /** Square icon tiles. */
  tile: 10,
  /** Inline code, check squares and tiny icons. */
  mark: 4
} as const

/** A shape inside another keeps its curve parallel to the parent's: the parent radius minus the gap between them. */
export function concentricRadius(parentRadius: number, inset: number): number {
  return Math.max(radii.mark, parentRadius - inset)
}

export const typography = {
  titleSize: 18,
  bodySize: 14,
  metaSize: 12,
  monoFamily: 'monospace' as const
} as const

// One press and one disabled look for every control; fills on press use colors.translucentFill.
export const feedback = {
  pressedOpacity: 0.7,
  disabledOpacity: 0.4
} as const

/** The pressed look for a button: `style={({ pressed }) => [styles.button, pressed && pressedStyle]}`. */
export const pressedStyle = { opacity: feedback.pressedOpacity } as const
