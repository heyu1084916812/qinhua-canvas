import { InterfacePanel } from './InterfacePanel'

/**
 * 「外观 → 主题与颜色」。
 *
 * 只放本机主题偏好；节点文字字号在「画布外观」，字体在「字体与文字」。
 */
export function ThemePanel() {
  return (
    <div data-theme-panel>
      <InterfacePanel />
    </div>
  )
}
