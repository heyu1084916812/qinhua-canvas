import logoUrl from '../assets/logo-loop.svg'

/**
 * 猫画动态 Logo（用户 2026-09-27：侧栏与首页都用「猫画那个动态图标」）。
 *
 * 用 `<img>` 加载 SVG 而不是把路径内联进组件，理由是**动画在 SVG 内部**：
 * 文件里自带 `<animateTransform>`（眨眼 + 轻微摆动）。两种方式都能播，
 * 但内联会把这些 id（`logo` / `eyes` / `left-eye`…）带进文档 ——
 * 同一个页面放两处（侧栏 + 首页）就会**id 冲突**，
 * 而 `<img>` 里的 SVG 是独立文档，天然隔离。
 *
 * 尺寸由外部给：它出现在两处（侧栏 28px、首页大一些），
 * 组件本身不写死宽高，只保证「正方、等比、不裁切」。
 */
export function CatLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      className={className}
      /*
       * 装饰性图形：它是品牌标记，旁边已有文字与 aria-label。
       * 留着默认 alt（= 文件名）会让读屏念出一串路径。
       */
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
