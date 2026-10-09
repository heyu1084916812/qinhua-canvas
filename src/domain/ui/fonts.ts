/**
 * 自定义字体（用户 2026-10-09：「我能加入字体吗？可以的话设置那个地方给我加一个这个功能」）。
 *
 * ## 定位
 *
 * 它属于**本机界面偏好**：只改界面的 `--font-sans`，不动任何画布内容、
 * 不改生成参数、也不动导出结果。
 *
 * ## 为什么不用上传：字体文件就地加载
 *
 * 浏览器有 `FontFace` API —— 把用户选中的字体文件读成 ArrayBuffer，
 * 用 `new FontFace(family, buffer)` 注册即可。因此：
 *   - 字体**不出本机**（不上传、不进生成请求）；
 *   - 不需要任何后端或字体服务；
 *   - 卸载应用时随本地数据一起消失。
 *
 * ## 本文件是纯函数层
 *
 * 只做"校验 + 拼 CSS + 认格式"这类可单测的事；真正落库与 DOM 注入在
 * `state/project/fontStore.ts` 与 `app/providers/FontProvider.tsx`。
 * 这层不 import React、不碰 DOM，符合架构 §2.2 的分层约束。
 */

/** 允许导入的字体格式（按扩展名判定，桌面壳里也没有 mime 可依） */
export const FONT_FORMATS = ['ttf', 'otf', 'woff', 'woff2'] as const
export type FontFormat = (typeof FONT_FORMATS)[number]

/** 单文件大小上限：20MB。中文字体动辄 10MB+，太小会拦掉正常字体 */
export const FONT_SIZE_MAX = 20 * 1024 * 1024

/** 一次最多保存多少个自定义字体（本地库不是字体管理器，给个上限免得失控） */
export const FONT_COUNT_MAX = 20

/**
 * 字重槽位（用户 2026-10-09：「他只有一份字体怎么控制粗细呢？」）。
 *
 * **一份字体文件只承载一个字重** —— 这是字体格式的事实，不是实现偷懒：
 * - 导入"常规体"→ 记 400；想真加粗，再给同一个字族导入"粗体"→ 记 700；
 * - 只导入一份时，浏览器会**合成**（faux）粗体：能看出层次，但边缘会发虚；
 * - **可变字体**（一个文件含 100–900 全部字重）例外，见 `detectVariableFont`。
 */
export type FontWeight = 400 | 700
export const FONT_WEIGHTS: readonly FontWeight[] = [400, 700]

/** 用户字体：只记录元数据，字节另存 */
export interface UserFont {
  id: string
  /** 用户在界面上看到的名称（默认取文件名，可改） */
  name: string
  /**
   * 真正注册进 CSS 的字族名。
   *
   * ⚠️ **不用用户填的名字**：用户可能填 `Inter`、`微软雅黑`、甚至带引号或分号，
   * 直接拼进 `font-family` 会破坏样式表。这里用稳定的内部字族名
   * （形如 `qh-font-<id>`），用户改显示名不影响已注册的字体。
   */
  family: string
  format: FontFormat
  /** 字节数，用于展示与上限校验 */
  size: number
  createdAt: number
  /** 这一份文件是常规体还是粗体（老数据缺字段按 400） */
  weight: FontWeight
  /**
   * 是否"一个文件含全部字重"的可变字体。
   *
   * - `true`：`@font-face` 声明成 `100 900`，浏览器直接用它的字重轴；
   * - `false`：只声明这一个字重（另一个字重靠导入粗体文件，或由浏览器合成）；
   * - `null`：**认不出**（woff / woff2 的表是压缩的，不做解压猜测）→ 按静态处理。
   */
  variable: boolean | null
}

export type FontValidationError =
  | { kind: 'empty' }
  | { kind: 'too-large'; size: number; max: number }
  | { kind: 'unsupported'; ext: string }

export type FontValidationResult =
  | { ok: true; format: FontFormat }
  | { ok: false; error: FontValidationError }

/** 取小写扩展名（不含点）。没有扩展名时返回空串 */
export function extOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(fileName ?? '').trim())
  return m ? m[1]!.toLowerCase() : ''
}

/**
 * 校验一个待导入的字体文件。
 *
 * 判据只有三条（都给出**可行动**的错误，而不是"不支持的文件"）：
 * ① 文件不能为空；② 不能超过 `FONT_SIZE_MAX`；③ 扩展名必须是四种之一。
 */
export function validateFontFile(input: { name: string; size: number }): FontValidationResult {
  const size = Number(input?.size ?? 0)
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: { kind: 'empty' } }
  if (size > FONT_SIZE_MAX) {
    return { ok: false, error: { kind: 'too-large', size, max: FONT_SIZE_MAX } }
  }
  const ext = extOf(input?.name ?? '')
  if (!(FONT_FORMATS as readonly string[]).includes(ext)) {
    return { ok: false, error: { kind: 'unsupported', ext } }
  }
  return { ok: true, format: ext as FontFormat }
}

/** 可读的错误文案（界面直接用，不在这里拼 DOM） */
export function describeFontError(error: FontValidationError): string {
  switch (error.kind) {
    case 'empty':
      return '这个文件是空的，换一个再试'
    case 'too-large':
      return `字体文件太大（${formatMB(error.size)}，上限 ${formatMB(error.max)}）`
    case 'unsupported':
      return error.ext
        ? `不支持的格式 .${error.ext}，只支持 ${FONT_FORMATS.join(' / ')}`
        : `认不出这个文件格式，只支持 ${FONT_FORMATS.join(' / ')}`
  }
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 稳定的内部字族名。只允许字母数字与短横线，绝不采用用户输入 */
export function fontFamilyOf(id: string): string {
  const safe = String(id ?? '').replace(/[^a-zA-Z0-9-]/g, '')
  return `qh-font-${safe || 'unknown'}`
}

/**
 * 把"表里存着的字族名"合法化。
 *
 * 与 `fontFamilyOf` 的分工：那个是**从 id 推导**（新导入走它），这个只用于
 * **读回旧行 / 粗体行共享的字族名** —— 同样是内部名，绝不允许用户输入直接进 CSS。
 * 认不出（空 / 全是非法字符）返回 null，由调用方回落到 `fontFamilyOf(id)`。
 */
export function sanitizeFamily(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const safe = raw.replace(/[^a-zA-Z0-9-]/g, '')
  if (!safe) return null
  return safe.startsWith('qh-font-') ? safe : `qh-font-${safe}`
}

/**
 * 字体文件里有没有 `fvar` 表（== 可变字体）。
 *
 * 只对 **ttf / otf** 下结论：这两种就是裸 sfnt，表目录在文件头 12 字节之后；
 * woff / woff2 的表被压缩过，不解压就"看不到"——那一档返回 `null`（认不出），
 * 而不是猜一个"不是"（猜错会让可变字体白丢字重轴）。
 */
export function detectVariableFont(bytes: ArrayBuffer, format: FontFormat): boolean | null {
  if (format !== 'ttf' && format !== 'otf') return null
  if (bytes.byteLength < 12) return null
  const view = new DataView(bytes)
  const numTables = view.getUint16(4)
  if (numTables <= 0 || numTables > 512) return null
  if (12 + numTables * 16 > bytes.byteLength) return null
  for (let i = 0; i < numTables; i += 1) {
    const off = 12 + i * 16
    const tag =
      String.fromCharCode(view.getUint8(off)) +
      String.fromCharCode(view.getUint8(off + 1)) +
      String.fromCharCode(view.getUint8(off + 2)) +
      String.fromCharCode(view.getUint8(off + 3))
    if (tag === 'fvar') return true
  }
  return false
}

/** `FontFace` 的 `format()` 取值：woff2 要写成 `woff2`，其余同名 */
export function cssFormatOf(format: FontFormat): string {
  return format
}

/**
 * 生成用于注入 `<style>` 的 `@font-face` 规则。
 *
 * ⚠️ **`src` 用 blob: URL**（调用方先 `URL.createObjectURL`）：
 * 不用 `data:` 是因为中文字体 base64 后会膨胀约 33%，且字符串会常驻内存。
 * blob URL 由 `FontProvider` 在卸载时统一 `revokeObjectURL`。
 */
export function fontFaceRule(font: UserFont, srcUrl: string): string {
  /**
   * ⚠️ 字重必须**如实声明**（2026-10-09 修）：
   *
   * 旧版无条件写 `font-weight:100 900`，对静态字体等于告诉浏览器"粗体也有" ——
   * 于是 `font-weight:600/700` 的请求全部落到同一份常规字形上，**标题和正文一样粗**
   * （这正是用户问"只有一份字体怎么控制粗细"时看到的现象）。
   * 现在：静态字体只声明它自己的槽位（另一个字重由浏览器合成 / 导入粗体文件补上），
   * 可变字体才声明整段区间。
   */
  const weight = font.variable === true ? '100 900' : String(font.weight)
  return (
    `@font-face{font-family:'${font.family}';` +
    `src:url('${srcUrl}') format('${cssFormatOf(font.format)}');` +
    `font-display:swap;font-style:normal;font-weight:${weight};}`
  )
}

/** 界面用的字体名：系统栈 / 自定义字体二选一 */
export type FontChoice =
  | { kind: 'system' }
  | { kind: 'custom'; fontId: string }

/**
 * 把用户选择翻译成真正写进 `--font-sans` 的值。
 *
 * **自定义字体永远排在系统栈前面**：万一这个字体缺字（中文常见），
 * 浏览器会自动回落到后面的系统字体，不会出现"整屏方块"。
 */
export function fontStackFor(choice: FontChoice, fonts: readonly UserFont[]): string {
  const SYSTEM = '"Segoe UI Variable", "Microsoft YaHei UI", "PingFang SC", sans-serif'
  if (choice.kind === 'system') return SYSTEM
  const font = fonts.find((f) => f.id === choice.fontId)
  if (!font) return SYSTEM
  /* 用 `font.family` 而不是按 id 现推：常规体与粗体**共享同一个字族名**，
     这样 CSS 请求 700 时浏览器才找得到那一份粗体（只选中常规体的 id 也够用）。 */
  return `'${font.family}', ${SYSTEM}`
}

/** 界面上的一个"字体" = 一个**字族**（常规 + 可选粗体两份文件） */
export interface FontFamilyGroup {
  family: string
  /** 常规体（没有 400 时取最早导入的那份，保证列表不丢条目） */
  regular: UserFont
  bold: UserFont | null
}

/**
 * 把"按文件存的"列表**按字族分组**给界面用。
 *
 * 为什么要分组：界面上的"一个字体"要能同时回答两件事 —— 用哪份常规体、
 * 有没有配套粗体。底层仍是一份文件一行（删除 / 替换 / 体积统计都以文件为单位），
 * 分组只是**展示层**的折叠，不引入第二张表。
 */
export function fontFamiliesOf(fonts: readonly UserFont[]): FontFamilyGroup[] {
  const byFamily = new Map<string, UserFont[]>()
  for (const font of fonts) {
    const list = byFamily.get(font.family)
    if (list) list.push(font)
    else byFamily.set(font.family, [font])
  }
  const out: FontFamilyGroup[] = []
  for (const [family, list] of byFamily) {
    const regular = list.find((f) => f.weight === 400) ?? list[0]
    if (!regular) continue
    const bold = list.find((f) => f.weight === 700 && f.id !== regular.id) ?? null
    out.push({ family, regular, bold })
  }
  return out.sort((a, b) => a.regular.createdAt - b.regular.createdAt)
}

/** 是否还能再导入一个（上限保护） */
export function canAddFont(count: number): boolean {
  return count < FONT_COUNT_MAX
}

/** 从文件名推一个默认显示名：去掉扩展名，其余原样（用户可改） */
export function defaultFontName(fileName: string): string {
  const base = String(fileName ?? '').replace(/\.[A-Za-z0-9]+$/, '').trim()
  return base || '自定义字体'
}
