import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from '../search/settings-search-keywords'

function fanSearchKeywords(): string[] {
  return [
    ...translateSearchKeyword('settings.fanSmart.keywordFan', 'fan'),
    ...translateSearchKeyword('settings.fanSmart.keywordFans', 'fans'),
    ...translateSearchKeyword('settings.fanSmart.keywordSmart', 'smart'),
    ...translateSearchKeyword('settings.fanSmart.keywordTemperature', 'temperature')
  ]
}

export const getGeneralFanSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('settings.fanSmart.questionsTitle', 'Ask how the Mac feels'),
    description: translate(
      'settings.fanSmart.questionsDescription',
      'In Smart fan mode, Topo now and then asks how the bottom and palm rest feel, and learns from your answers.'
    ),
    keywords: fanSearchKeywords()
  },
  {
    title: translate('settings.fanSmart.resetTitle', 'Smart fan learning'),
    description: translate(
      'settings.fanSmart.resetDescription',
      'Forget what Smart fan mode learned from your answers and go back to its starting curve.'
    ),
    keywords: [
      ...fanSearchKeywords(),
      ...translateSearchKeyword('settings.fanSmart.keywordReset', 'reset'),
      ...translateSearchKeyword('settings.fanSmart.keywordLearning', 'learning')
    ]
  }
])
