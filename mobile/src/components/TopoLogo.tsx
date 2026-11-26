import Svg, { Path } from 'react-native-svg'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'

type Props = {
  size?: number
  color?: string
}

// Desktop's resources/logo.svg mole: eyes are cut out, so it reads on any surface in one color.
export function TopoLogo({ size = 24, color = colors.textPrimary }: Props) {
  useMobileColorScheme()
  const width = size * (100 / 64)
  return (
    <Svg width={width} height={size} viewBox="0 0 100 64">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M6 60 A44 44 0 0 1 94 60 Z M31 40 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 Z M59 40 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 Z"
      />
    </Svg>
  )
}
