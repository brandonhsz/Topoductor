import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useRouter } from 'expo-router'
import { ChevronLeft, Keyboard, RefreshCw } from 'lucide-react-native'
import { NavBar } from '../components/nav-bar/NavBar'
import { NavBarButton } from '../components/nav-bar/NavBarButton'
import { TextField } from '../components/composer-input/TextField'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors, feedback, pressedStyle, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useHostClient } from '../transport/connection/host-client-hooks'
import {
  loadRemoteDesktopCredential,
  saveRemoteDesktopCredential
} from './remote-desktop-credential-store'
import { remoteDesktopDocumentSource } from './remote-desktop-document-source'
import {
  RemoteDesktopSessionController,
  type RemoteDesktopViewState
} from './remote-desktop-session-controller'
import {
  parseRemoteDesktopDocumentEvent,
  type RemoteDesktopDocumentCommand,
  type RemoteDesktopSpecialKey
} from './remote-desktop-webview-protocol'

const SPECIAL_KEYS: readonly RemoteDesktopSpecialKey[] = [
  'escape',
  'tab',
  'left',
  'up',
  'down',
  'right'
]

function specialKeyLabels(
  t: ReturnType<typeof useMobileTranslation>
): Record<RemoteDesktopSpecialKey, { label: string; accessibilityLabel: string }> {
  const escape = t('remoteDesktop.keys.escape', 'Esc')
  const tab = t('remoteDesktop.keys.tab', 'Tab')
  return {
    escape: { label: escape, accessibilityLabel: escape },
    tab: { label: tab, accessibilityLabel: tab },
    left: { label: '←', accessibilityLabel: t('remoteDesktop.keys.left', 'Left arrow') },
    up: { label: '↑', accessibilityLabel: t('remoteDesktop.keys.up', 'Up arrow') },
    down: { label: '↓', accessibilityLabel: t('remoteDesktop.keys.down', 'Down arrow') },
    right: { label: '→', accessibilityLabel: t('remoteDesktop.keys.right', 'Right arrow') }
  }
}

export function MobileRemoteDesktopScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { client, state: connectionState } = useHostClient(hostId)
  const webViewRef = useRef<WebView>(null)
  const controllerRef = useRef<RemoteDesktopSessionController | null>(null)
  const [documentLoaded, setDocumentLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<RemoteDesktopViewState>({ phase: 'connecting' })
  const [source] = useState(() => remoteDesktopDocumentSource(colors.bgBase))

  const post = useCallback((command: RemoteDesktopDocumentCommand) => {
    webViewRef.current?.postMessage(JSON.stringify(command))
  }, [])

  const connected = connectionState === 'connected'
  useEffect(() => {
    if (!client || !connected || !documentLoaded) {
      return
    }
    const controller = new RemoteDesktopSessionController({
      client,
      post,
      loadCredential: () => loadRemoteDesktopCredential(hostId),
      saveCredential: (credential) => saveRemoteDesktopCredential(hostId, credential),
      onState: setView
    })
    controllerRef.current = controller
    controller.start()
    return () => {
      controller.dispose()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [attempt, client, connected, documentLoaded, hostId, post])

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseRemoteDesktopDocumentEvent(event.nativeEvent.data)
    if (!message) {
      return
    }
    if (message.type === 'loaded') {
      setDocumentLoaded(true)
      return
    }
    controllerRef.current?.handleDocumentEvent(message)
  }, [])

  const reconnect = useCallback(() => setAttempt((value) => value + 1), [])
  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace(`/h/${encodeURIComponent(hostId)}`)
    }
  }, [hostId, router])
  const toggleKeyboard = useCallback(() => {
    webViewRef.current?.requestFocus()
    post({ type: 'focusKeyboard' })
  }, [post])

  const isLive = view.phase === 'connected'
  const keyLabels = specialKeyLabels(t)
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavBar
        leading={
          <NavBarButton
            icon={ChevronLeft}
            onPress={leave}
            accessibilityLabel={t('common.back', 'Back')}
          />
        }
        title={t('remoteDesktop.title', 'Remote desktop')}
        trailing={
          <View style={styles.trailing}>
            {isLive ? (
              <NavBarButton
                icon={Keyboard}
                onPress={toggleKeyboard}
                accessibilityLabel={t('remoteDesktop.keyboard', 'Keyboard')}
              />
            ) : null}
            <NavBarButton
              icon={RefreshCw}
              onPress={reconnect}
              accessibilityLabel={t('remoteDesktop.reconnect', 'Reconnect')}
            />
          </View>
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.flex}>
          <WebView
            ref={webViewRef}
            source={source}
            style={styles.webview}
            originWhitelist={['*']}
            javaScriptEnabled
            scrollEnabled={false}
            bounces={false}
            nestedScrollEnabled
            // The keyboard button focuses the document's input from a native press.
            keyboardDisplayRequiresUserAction={false}
            hideKeyboardAccessoryView
            onMessage={handleMessage}
            onLoadStart={() => setDocumentLoaded(false)}
          />
          {view.phase === 'connected' ? null : (
            <RemoteDesktopOverlay
              view={connected ? view : { phase: 'connecting' }}
              onReconnect={reconnect}
              onSubmit={(credential) =>
                void controllerRef.current?.submitCredentials(credential, true)
              }
            />
          )}
        </View>
        {isLive ? (
          <ScrollView
            horizontal
            style={styles.keyRow}
            contentContainerStyle={[styles.keyRowContent, { paddingBottom: insets.bottom }]}
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
          >
            {SPECIAL_KEYS.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={keyLabels[key].accessibilityLabel}
                style={({ pressed }) => [styles.keyCap, pressed && pressedStyle]}
                onPress={() => post({ type: 'key', key })}
              >
                <Text style={styles.keyCapText}>{keyLabels[key].label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  )
}

function RemoteDesktopOverlay({
  view,
  onReconnect,
  onSubmit
}: {
  view: Exclude<RemoteDesktopViewState, { phase: 'connected' }>
  onReconnect: () => void
  onSubmit: (credential: { username: string; password: string }) => void
}) {
  const t = useMobileTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  if (view.phase === 'connecting') {
    return (
      <View style={styles.overlay}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={styles.overlayText}>{t('remoteDesktop.connecting', 'Connecting…')}</Text>
      </View>
    )
  }
  if (view.phase === 'error') {
    return (
      <View style={styles.overlay}>
        <Text style={styles.errorText}>{view.message}</Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.primaryButton, pressed && pressedStyle]}
          onPress={onReconnect}
        >
          <Text style={styles.primaryButtonText}>{t('remoteDesktop.reconnect', 'Reconnect')}</Text>
        </Pressable>
      </View>
    )
  }
  const canSubmit = password.length > 0 && (!view.needsUsername || username.trim().length > 0)
  const submit = () => {
    if (canSubmit) {
      onSubmit({ username: username.trim(), password })
    }
  }
  return (
    <View style={[styles.overlay, styles.form]}>
      <Text style={styles.overlayText}>
        {view.needsUsername
          ? t(
              'remoteDesktop.credentialsAccount',
              'Sign in with an account on this computer. It is saved on this phone.'
            )
          : t(
              'remoteDesktop.credentialsPassword',
              'Enter the screen sharing password. It is saved on this phone.'
            )}
      </Text>
      {view.needsUsername ? (
        <TextField
          accessibilityLabel={t('remoteDesktop.username', 'Username')}
          placeholder={t('remoteDesktop.username', 'Username')}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          returnKeyType="next"
        />
      ) : null}
      <TextField
        accessibilityLabel={t('remoteDesktop.password', 'Password')}
        placeholder={t('remoteDesktop.password', 'Password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {view.error ? <Text style={styles.errorText}>{view.error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.primaryButton,
          !canSubmit && styles.disabled,
          pressed && pressedStyle
        ]}
        onPress={submit}
      >
        <Text style={styles.primaryButtonText}>{t('remoteDesktop.connect', 'Connect')}</Text>
      </Pressable>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  flex: {
    flex: 1
  },
  trailing: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bgBase
  },
  form: {
    alignItems: 'stretch'
  },
  overlayText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    lineHeight: 20,
    textAlign: 'center'
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    lineHeight: 20,
    textAlign: 'center'
  },
  primaryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceBright
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  disabled: {
    opacity: feedback.disabledOpacity
  },
  keyRow: {
    flexGrow: 0,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  keyRowContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm
  },
  keyCap: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  keyCapText: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  }
}))
