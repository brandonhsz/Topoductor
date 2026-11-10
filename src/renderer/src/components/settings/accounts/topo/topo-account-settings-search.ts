import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../../search/settings-search-keywords'

export const getTopoAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.topoAccount.account', 'Topo account'),
    description: translate(
      'auto.components.settings.topoAccount.searchDescription',
      'Sign in or out of the account used by Artifacts and Topo Relay.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.topoAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.topoAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.topoAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.topoAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.topoAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.topoAccount.keywordRelay', 'relay'),
      ...translateSearchKeyword('auto.components.settings.topoAccount.keywordCloud', 'cloud')
    ]
  }
])
