import { useEffect, useMemo, useState } from 'react'
import { getNodeDefinition } from '../../workbenches/canvas/nodes/registry'
import { NodeFrame } from '../../workbenches/canvas/frame/NodeFrame'
import { CanvasToolbar } from '../../workbenches/canvas/toolbar/CanvasToolbar'
import menuStyles from '../../workbenches/canvas/menu/ContextMenu.module.css'
import { CanvasStoreProvider } from '../../workbenches/canvas/storeContext'
import { createCanvasStore } from '../../state/workbenches/canvas/store'
import { createMemoryPlatform } from '../../platform/memory/index'
import { ProjectCard, HomeEmptyState } from '../../pages/HomePage/HomePage'
import { useGraph } from '../../workbenches/canvas/storeContext'
import { makeNode, makeProject, genData, groupData, batchData } from './fixtures'
import { PREVIEW_ASSET_HASHES } from './assets'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { ProjectListItem } from '../../domain/project/project'
import type { RunMode } from '../../domain/canvas/model/runRecord'
import styles from './PreviewPage.module.css'

const HEADER_H = 32

/** 工具栏陈列卡各自持有独立 store，共用一个内存平台即可（不落库、不影响其它卡片） */
const previewPlatform = createMemoryPlatform()

/** 对比节点陈列用上游素材（由 assets.ts 写入内存 assets 表） */
const PREVIEW_ASSETS: string[] = [...PREVIEW_ASSET_HASHES]

/**
 * 工具栏陈列卡：直接驱动真实 CanvasToolbar，但它需要 CanvasStore 的选中态。
 * 这里用一次性 store + 预设 selection 复现三种启用状态，避免为陈列再造一个假组件。
 */
function ToolbarCard({ label, count = 0 }: { label: string; count?: number }) {
  const store = useMemo(() => createCanvasStore({ platform: previewPlatform, projectId: 'preview' }), [])
  useEffect(() => {
    const ids = Array.from({ length: count }, (_, i) => `sel-${i}`)
    for (const id of ids) {
      store.dispatch({
        kind: 'node.create',
        projectId: 'preview',
        type: 'prompt',
        at: { x: 0, y: 0 },
        id,
      })
    }
    store.setSelection(ids)
  }, [store, count])
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.toolbarStage}>
        <CanvasStoreProvider store={store}>
          <CanvasToolbar onCreateNode={() => {}} />
        </CanvasStoreProvider>
      </div>
    </div>
  )
}

/**
 * 右键菜单陈列卡：静态展示两类菜单的结构（节点菜单 / 画布空白菜单），
 * 直接复用生产 ContextMenu.module.css，确保陈列室与真实弹层视觉一致。
 */
function ContextMenuCard({
  label,
  items,
}: {
  label: string
  items: { label: string; separatorAfter?: boolean }[]
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.stage}>
        <div
          className={menuStyles.menu}
          style={{ position: 'relative', left: 0, top: 0 }}
          role="menu"
          data-context-menu-preview
        >
          {items.map((it, i) => (
            <div key={it.label}>
              <div className={menuStyles.item} role="menuitem">
                {it.label}
              </div>
              {it.separatorAfter && i < items.length - 1 && <span className={menuStyles.sep} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 节点视图的通用陈列卡（工具栏之外的其它卡片共用） */
interface CardProps {
  label: string
  node: NodeSnapshot
  selected?: boolean
  running?: boolean
  globalRunning?: boolean
  stale?: boolean
  runMode?: RunMode
  error?: string | null
  upstreamAssetHashes?: string[]
}

function Card({
  label,
  node,
  selected,
  running,
  globalRunning,
  stale,
  runMode = 'idle',
  error = null,
  upstreamAssetHashes,
}: CardProps) {
  const def = getNodeDefinition(node.type)
  const View = def.View
  const graph = useGraph()
  // 容器类节点需要真实的子节点快照（视图不读图，由这里充当 NodeLayer 的角色注入）
  const childNodes = graph.nodes.filter((n) => n.parentId === node.id)
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.stage}>
        <NodeFrame
          node={node}
          selected={!!selected}
          scale={1}
          ports={def.ports}
          minSize={def.sizing.min}
          onFramePointerDown={() => {}}
          onResize={() => {}}
          onRename={() => {}}
        >
          <View
            node={node}
            size={{ w: node.w, h: Math.max(0, node.h - HEADER_H) }}
            scale={1}
            selected={!!selected}
            running={!!running}
            globalRunning={!!globalRunning}
            stale={!!stale}
            runMode={runMode}
            error={error}
            upstreamAssetHashes={upstreamAssetHashes}
            childNodes={childNodes}
            renderChild={
              childNodes.length > 0
                ? (child) => (
                    <NodeFrame
                      key={child.id}
                      node={{ ...child, x: 0, y: 0 }}
                      selected={false}
                      scale={1}
                      ports={getNodeDefinition(child.type).ports}
                      minSize={getNodeDefinition(child.type).sizing.min}
                      onFramePointerDown={() => {}}
                      onResize={() => {}}
                      onRename={() => {}}
                    >
                      <ChildView node={child} />
                    </NodeFrame>
                  )
                : undefined
            }
            emit={() => {}}
          />
        </NodeFrame>
      </div>
    </div>
  )
}

/** 陈列室里的容器子节点：只渲染内容区，不带选中 / 运行态（视觉回归只需静态外观） */
function ChildView({ node }: { node: NodeSnapshot }) {
  const View = getNodeDefinition(node.type).View
  return (
    <View
      node={node}
      size={{ w: node.w, h: Math.max(0, node.h - HEADER_H) }}
      scale={1}
      selected={false}
      running={false}
      stale={false}
      runMode="idle"
      error={null}
      emit={() => {}}
    />
  )
}

type HomeCardState = 'default' | 'menu' | 'rename' | 'confirm'

/** 首页项目卡片陈列：各交互态并排，供视觉回归批量截图 */
function HomeCard({
  label,
  project,
  initial = 'default',
}: {
  label: string
  project: ProjectListItem
  initial?: HomeCardState
}) {
  const [menuOpen, setMenuOpen] = useState(initial === 'menu')
  const [confirming, setConfirming] = useState(initial === 'confirm')
  const [renaming, setRenaming] = useState(initial === 'rename')
  const [renameValue, setRenameValue] = useState(project.name)

  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.homeStage}>
        <ProjectCard
          project={project}
          confirming={confirming}
          menuOpen={menuOpen}
          renaming={renaming}
          renameValue={renameValue}
          onOpen={() => {}}
          onRenameChange={setRenameValue}
          onRenameCommit={() => setRenaming(false)}
          onCancelRename={() => setRenaming(false)}
          onRequestDelete={() => setConfirming(true)}
          onConfirmDelete={() => setConfirming(false)}
          onCancelDelete={() => setConfirming(false)}
          onToggleMenu={() => setMenuOpen((v) => !v)}
          onCloseMenu={() => setMenuOpen(false)}
          onStartRename={() => setRenaming(true)}
          onDuplicate={() => {}}
          onExport={() => {}}
        />
      </div>
    </div>
  )
}

/**
 * 组件陈列室（架构 §5.7）。展示节点组件与首页组件在各状态下的并排预览，
 * 供视觉回归批量截图（产品文档 §14.2「视觉回归」）。
 */
export function PreviewPage() {
  const homeProject = () => makeProject({ name: '产品海报', nodeCount: 12 })

  return (
    <div className={styles.page}>
      <h1 className={styles.h1}>组件陈列室 · 轻画（M0–M2）</h1>
      <p className={styles.desc}>
        各组件状态并排预览。打磨流程：改组件 → 看本页 → 比对截图 → 提交（架构 §5.7）。
      </p>

      <h2 className={styles.h2}>首页 · 项目卡片（产品文档 §5.3）</h2>
      <div className={styles.grid}>
        <HomeCard label="默认" project={homeProject()} />
        <HomeCard label="菜单展开" project={homeProject()} initial="menu" />
        <HomeCard label="重命名中" project={homeProject()} initial="rename" />
        <HomeCard label="删除确认" project={homeProject()} initial="confirm" />
        <HomeCard label="空项目（0 节点）" project={makeProject({ name: '未命名项目', nodeCount: 0 })} />
        <HomeCard
          label="超长名称截断"
          project={makeProject({ name: '一个非常非常非常长的项目名称用于验证单行截断', nodeCount: 128 })}
        />
      </div>

      <h2 className={styles.h2}>首页 · 空状态（产品文档 §5.6）</h2>
      <div className={styles.emptyStage}>
        <HomeEmptyState onCreate={() => {}} />
      </div>

      <h2 className={styles.h2}>节点类型（默认态）</h2>
      <div className={styles.grid}>
        <Card label="提示词节点" node={makeNode('prompt', { title: '提示词' })} />
        <Card label="生成节点" node={makeNode('generation', { title: '生成' })} />
        <Card label="对比节点" node={makeNode('compare', { title: '对比' })} />
        <Card label="画板节点" node={makeNode('board', { title: '画板' })} />
      </div>

      <h2 className={styles.h2}>对比节点 · 状态矩阵（产品文档 §6.10 / M3-1）</h2>
      <div className={styles.grid}>
        <Card label="空态（上游不足 2 张）" node={makeNode('compare', { title: '对比' })} />
        <Card
          label="双图上叠（默认分割 0.5）"
          node={makeNode('compare', {
            title: '对比',
            w: 280,
            h: 220,
            data: { splitRatio: 0.5 },
          })}
          upstreamAssetHashes={PREVIEW_ASSETS}
        />
        <Card
          label="分割偏左（0.25）"
          node={makeNode('compare', { title: '对比', w: 280, h: 220, data: { splitRatio: 0.25 } })}
          upstreamAssetHashes={PREVIEW_ASSETS}
        />
        <Card
          label="分割偏右（0.75）"
          node={makeNode('compare', { title: '对比', w: 280, h: 220, data: { splitRatio: 0.75 } })}
          upstreamAssetHashes={PREVIEW_ASSETS}
        />
        <Card label="选中" node={makeNode('compare', { title: '对比', w: 280, h: 220 })} selected />
      </div>

      <h2 className={styles.h2}>分组节点 · 状态矩阵（产品文档 §6.11 / M3-2）</h2>
      <div className={styles.grid}>
        <Card label="空态（拖入提示词或生成结果）" node={makeNode('group', { title: '分组' })} />
        <Card
          label="1 个素材（吸附第 1 单元）"
          node={makeNode('group', {
            title: '分组',
            w: 272,
            h: 218,
            data: groupData({ childIds: ['gp-1-c1'] }),
            id: 'gp-1',
          })}
        />
        <Card
          label="2 个素材（一行两单元）"
          node={makeNode('group', {
            title: '分组',
            w: 448,
            h: 358,
            data: groupData({ childIds: ['gp-2-c1', 'gp-2-c2'] }),
            id: 'gp-2',
          })}
        />
        <Card
          label="4 个素材（2×2 网格）"
          node={makeNode('group', {
            title: '分组',
            w: 448,
            h: 358,
            data: groupData({ childIds: ['gp-4-c1', 'gp-4-c2', 'gp-4-c3', 'gp-4-c4'] }),
            id: 'gp-4',
          })}
        />
        <Card
          label="含提示词 + 素材"
          node={makeNode('group', {
            title: '分组',
            w: 448,
            h: 358,
            data: groupData({ childIds: ['gp-2-c1', 'gp-2-c2'] }),
            id: 'gp-p',
          })}
        />
        <Card
          label="选中（虚线边框可见）"
          node={makeNode('group', {
            title: '分组',
            w: 448,
            h: 358,
            data: groupData({ childIds: ['gp-2-c1', 'gp-2-c2'] }),
            id: 'gp-2',
          })}
          selected
        />
      </div>

      <h2 className={styles.h2}>批量节点 · 状态矩阵（产品文档 §6.12 / M3-3）</h2>
      <div className={styles.grid}>
        <Card label="空态（拖入素材或提示词）" node={makeNode('batch', { title: '批量' })} />
        <Card
          label="2 个素材（一行两单元）"
          node={makeNode('batch', {
            title: '批量',
            w: 448,
            h: 358,
            data: batchData({ childIds: ['bp-2-c1', 'bp-2-c2'], contentType: 'media' }),
            id: 'bp-2',
          })}
        />
        <Card
          label="4 个素材（2×2 网格）"
          node={makeNode('batch', {
            title: '批量',
            w: 448,
            h: 358,
            data: batchData({ childIds: ['bp-4-c1', 'bp-4-c2', 'bp-4-c3', 'bp-4-c4'], contentType: 'media' }),
            id: 'bp-4',
          })}
        />
        <Card
          label="3 条提示词（提示词集合）"
          node={makeNode('batch', {
            title: '批量',
            w: 448,
            h: 358,
            data: batchData({ childIds: ['bp-p-c1', 'bp-p-c2', 'bp-p-c3'], contentType: 'prompt' }),
            id: 'bp-p',
          })}
        />
        <Card
          label="选中（虚线边框可见）"
          node={makeNode('batch', {
            title: '批量',
            w: 448,
            h: 358,
            data: batchData({ childIds: ['bp-2-c1', 'bp-2-c2'], contentType: 'media' }),
            id: 'bp-2',
          })}
          selected
        />
      </div>

      <h2 className={styles.h2}>工具栏 · 状态矩阵（产品文档 §6.5 / M3-4）</h2>
      <div className={styles.grid}>
        <ToolbarCard label="未选中（对齐 / 整理禁用）" />
        <ToolbarCard label="选中 2 个（对齐可用）" count={2} />
        <ToolbarCard label="选中 3 个（等距分布可用）" count={3} />
      </div>

      <h2 className={styles.h2}>右键菜单 · 状态矩阵（产品文档 §4.1 / M3-5）</h2>
      <div className={styles.grid}>
        <ContextMenuCard
          label="节点菜单（生成 / 批量节点含「生成」）"
          items={[
            { label: '生成', separatorAfter: true },
            { label: '复制' },
            { label: '重命名', separatorAfter: true },
            { label: '删除' },
          ]}
        />
        <ContextMenuCard
          label="画布空白菜单（6 类新建 + 重置视图）"
          items={[
            { label: '提示词' },
            { label: '生成' },
            { label: '对比' },
            { label: '分组' },
            { label: '批量' },
            { label: '画板', separatorAfter: true },
            { label: '重置视图' },
          ]}
        />
      </div>

      <h2 className={styles.h2}>提示词节点 · 状态矩阵</h2>
      <div className={styles.grid}>
        <Card label="默认" node={makeNode('prompt', { title: '提示词' })} />
        <Card label="选中" node={makeNode('prompt', { title: '提示词' })} selected />
        <Card label="运行中" node={makeNode('prompt', { title: '提示词' })} running runMode="single" />
        <Card label="错误" node={makeNode('prompt', { title: '提示词' })} error="生成失败：渠道超时" />
        <Card label="陈旧" node={makeNode('prompt', { title: '提示词' })} stale />
      </div>

      <h2 className={styles.h2}>生成节点 · 状态矩阵（产品文档 §6.8 / M2-3）</h2>
      <div className={styles.grid}>
        <Card label="默认（空态）" node={makeNode('generation', { title: '生成' })} />
        <Card
          label="已配置渠道+模型"
          node={makeNode('generation', {
            title: '生成',
            data: genData({ channelId: 'ch-preview', model: 'gpt-image-2', prompt: '屋顶的猫' }),
          })}
        />
        <Card label="运行中（按钮 ✕ 可取消）" node={makeNode('generation', { title: '生成' })} running runMode="single" />
        <Card label="全局运行中（按钮 ◌ 禁用）" node={makeNode('generation', { title: '生成' })} globalRunning />
        <Card label="错误" node={makeNode('generation', { title: '生成' })} error="模型不可用" />
        <Card label="陈旧" node={makeNode('generation', { title: '生成' })} stale />
      </div>

      <h2 className={styles.h2}>结果组 · 网格矩阵（产品文档 §6.9 / M2-3）</h2>
      <div className={styles.grid}>
        <Card
          label="1 张（单节点）"
          node={makeNode('generation', { data: genData({ prompt: '单张' }), w: 260, h: 300 })}
        />
      </div>
    </div>
  )
}
