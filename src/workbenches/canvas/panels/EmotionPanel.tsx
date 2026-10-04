import { useState, useSyncExternalStore } from 'react'
import { presetOf, panelModelOptions, toLogicalName } from '../../../domain/project/modelCatalog'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import { COUNT_OPTIONS, RATIO_OPTIONS } from './CreationPanel'
import { EmotionBox } from './EmotionBox'
import { ParamPicker } from './ParamPicker'
import type { PanelEvent, PanelModel } from './panelModel'
import shell from './PanelShell.module.css'
import styles from './EmotionPanel.module.css'

/**
 * 情绪面板 —— **独立的一块浮层**（用户 2026-10-05 第 1 条：「情绪调节是单独的一个面板，
 * 不是放在创作面板里面，参考图一，最上方参数旁边可以加上一个生成模型的选择」）。
 *
 * 它与创作面板是**同一位置的两种模式**（都挂在节点下方、同一套外壳几何）：
 * - 节点上选了情绪 → 显示本面板；
 * - ✕（或清掉情绪）→ 回到创作面板。
 *
 * 两处别再各画一套：外壳用共享的 `PanelShell.module.css`，
 * 情绪本体（角色预览 + 25 点位 + 定位）用 `EmotionBox`。
 *
 * 头排照参考图一：`✕ 情绪调节` 在左，右边依次是**生成模型**（前端展示的生图模型）、
 * **比例**、**张数**、**生成**。那三枚参数与创作面板读写的都是**节点上同一份 data**
 * （`model` / `ratio` / `count`），不是本面板自己的一份 —— 换面板不会丢设置。
 */
export function EmotionPanel({
  model,
  data,
  running,
  onEvent,
  onClose,
}: {
  model: PanelModel
  data: { model?: string; channelId?: string; ratio?: string; count?: number }
  running: boolean
  onEvent: (event: PanelEvent) => void
  /** 关掉本面板（= 清掉情绪，回到创作面板） */
  onClose: () => void
}) {
  const channels = useChannels()
  /** 与创作面板同一条订阅方式：设置页改完渠道，这里立刻反映 */
  const allChannels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const togglePicker = (key: string) => setOpenPicker((cur) => (cur === key ? null : key))
  const shownModel = data.model ?? ''
  const shownLogicalModel = toLogicalName(allChannels, shownModel)
  /** 与创作面板同一份「前端生图模型清单」（固定显示名在前，渠道模型在后） */
  const modelOptions = panelModelOptions(allChannels, 'image', data.channelId || undefined).map(
    (name) => {
      const preset = presetOf(name)
      return {
        value: name,
        label: name,
        ...(preset ? { icon: <ModelIcon vendor={preset.vendor} /> } : {}),
      }
    },
  )
  const ratio = data.ratio ?? ''
  const count = String(data.count ?? 1)
  const canRun = Boolean(shownLogicalModel) && Boolean(data.channelId)

  return (
    <div
      className={shell.panel}
      data-emotion-panel
      /**
       * ⚠️ **必须吃掉 pointerdown**：这块面板与创作面板都渲染在 `CanvasSurface` 内部
       * （浮层要靠 surface 的局部屏幕坐标定位），而 surface 的 `onPointerDown` 把
       * 「不在菜单里的按下」当成**空白单击** —— 点面板上的任何按钮都会清空选中 ⇒
       * 面板当场消失（实测：点比例 chip 后面板没了，浮层自然也没开）。
       * 创作面板一直有这一句，情绪面板从它里面搬出来时**漏了**，这一条是那次修复的钉子。
       */
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        /** Esc：先收参数浮层，再关面板（与创作面板同一套逐层收的口径） */
        if (e.key !== 'Escape') return
        e.preventDefault()
        if (openPicker) setOpenPicker(null)
        else onClose()
      }}
    >
      <EmotionBox
        emotion={model.emotion ?? ''}
        characterHash={model.thumbs.find((t) => t.assetHash)?.assetHash}
        onPick={(id) => onEvent({ type: 'setEmotion', emotion: id })}
        onClose={onClose}
        header={
          <>
            <ParamPicker
              name="emotionModel"
              ariaLabel="生图模型"
              label={shownLogicalModel || '生图模型'}
              options={modelOptions}
              value={shownLogicalModel}
              variant="list"
              open={openPicker === 'emotionModel'}
              onToggle={() => togglePicker('emotionModel')}
              onClose={() => setOpenPicker(null)}
              onSelect={(v) => onEvent({ type: 'setModel', model: v })}
            />
            <ParamPicker
              name="emotionRatio"
              ariaLabel="画面比例"
              label={ratio || '比例'}
              options={RATIO_OPTIONS.map((r) => ({ value: r, label: r }))}
              value={ratio}
              variant="ratioGrid"
              open={openPicker === 'emotionRatio'}
              onToggle={() => togglePicker('emotionRatio')}
              onClose={() => setOpenPicker(null)}
              onSelect={(v) => onEvent({ type: 'setRatio', ratio: v })}
            />
            <ParamPicker
              name="emotionCount"
              ariaLabel="生成数量"
              label={`${count} 张`}
              options={COUNT_OPTIONS.map((c) => ({ value: String(c), label: `${c} 张` }))}
              value={count}
              variant="pill"
              open={openPicker === 'emotionCount'}
              onToggle={() => togglePicker('emotionCount')}
              onClose={() => setOpenPicker(null)}
              onSelect={(v) => onEvent({ type: 'setCount', count: Number(v) })}
            />
            <button
              type="button"
              className={styles.run}
              data-emotion-run
              disabled={running || !canRun}
              title={canRun ? '按当前情绪生成' : '先在渠道里选好模型'}
              aria-label="生成"
              /**
               * 情绪走**局部改脸**（用户 2026-10-05 第五批第 1 条）：识别人脸 → 裁局部 →
               * 改图 → 融合回原图，而不是把整张图重画一遍。
               */
              onClick={() => onEvent({ type: running ? 'cancel' : 'runEmotion' })}
            >
              {running ? '停止' : '生成'}
            </button>
          </>
        }
      />
    </div>
  )
}
