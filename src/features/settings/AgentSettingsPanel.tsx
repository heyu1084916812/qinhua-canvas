import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useSkillsOptional } from '../../app/providers/SkillStoreProvider'
import type { AgentDeliveryMode } from '../../domain/agent/delivery'
import { createPresetStore } from '../../state/project/presetStore'
import {
  closeGlobalSettings,
  openGlobalSettings,
  type AgentSettingsTab,
} from '../../state/ui/globalSettings'
import {
  getAgentDeliveryMode,
  setAgentDeliveryMode,
  subscribeAgentDeliveryMode,
} from '../../state/ui/agentDelivery'
import { AgentMemoryPanel } from './AgentMemoryPanel'
import styles from './AgentSettingsPanel.module.css'

const TABS: readonly { id: AgentSettingsTab; label: string }[] = [
  { id: 'basic', label: '基础' },
  { id: 'model', label: '模型' },
  { id: 'tools', label: '工具' },
  { id: 'skills', label: '技能' },
  { id: 'memory', label: '记忆' },
  { id: 'advanced', label: '高级' },
]

const TOOL_GROUPS = [
  {
    title: 'Harness 内部',
    detail: '任务规划、上下文整理、状态汇报与受限子任务。',
    tools: ['任务计划', '上下文整理', '运行状态', '检查点'],
  },
  {
    title: '画布',
    detail: '读取图、创建与修改节点、连线、生成、裁剪与视觉验收。',
    tools: [
      'readGraph',
      'applyPlan',
      'updateNode',
      'moveNodes',
      'resizeNodes',
      'deleteNodes',
      'arrangeNodes',
      'deleteEdges',
      'compareNodes',
      'sliceImage',
      'splitGrid',
      'runNode',
      'runFrom',
      'readResult',
      'visualReview',
    ],
  },
  {
    title: '宿主服务',
    detail: '素材、技能、记忆、套件、日志和模型路由由轻画托管。',
    tools: ['素材读取', '技能', '记忆', 'ContextBundle', 'RunRecord', 'RoutePlan'],
  },
] as const

function DeliverySettings() {
  const platform = usePlatform()
  const presets = useMemo(() => createPresetStore(platform.storage), [platform])
  const mode = useSyncExternalStore(
    subscribeAgentDeliveryMode,
    getAgentDeliveryMode,
    getAgentDeliveryMode,
  )
  const [status, setStatus] = useState('')

  useEffect(() => {
    let alive = true
    void presets
      .loadAgentDeliveryMode()
      .then((next) => {
        if (alive) setAgentDeliveryMode(next)
      })
      .catch(() => {
        if (alive) setStatus('读取失败，当前使用“引导”')
      })
    return () => {
      alive = false
    }
  }, [presets])

  const choose = async (next: AgentDeliveryMode) => {
    setAgentDeliveryMode(next)
    setStatus('')
    try {
      await presets.saveAgentDeliveryMode(next)
    } catch {
      setStatus('保存失败，本次运行仍按当前选择')
    }
  }

  return (
    <section className={styles.section} data-agent-settings-basic>
      <div className={styles.sectionHead}>
        <h3>运行中的消息</h3>
        <p>Agent 正在工作时，新消息默认立即引导当前任务。</p>
      </div>
      <div className={styles.preferenceRow}>
        <span>发送方式</span>
        <div className={styles.segmented} data-agent-delivery-mode={mode}>
          {([
            { value: 'steer', label: '引导' },
            { value: 'queue', label: '排队' },
          ] as const).map((item) => (
            <button
              key={item.value}
              type="button"
              className={mode === item.value ? styles.choiceOn : styles.choice}
              data-agent-delivery-mode-option={item.value}
              aria-pressed={mode === item.value}
              onClick={() => void choose(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.hint}>
        引导会立即调整当前任务；排队会等当前回合结束后再发送。按 Ctrl/Cmd+Enter
        可临时切换一次。
      </p>
      {status ? (
        <p className={styles.status} role="status">
          {status}
        </p>
      ) : null}
    </section>
  )
}

export function AgentSettingsPanel({
  tab,
  onTabChange,
}: {
  tab: AgentSettingsTab
  onTabChange: (tab: AgentSettingsTab) => void
}) {
  const navigate = useNavigate()
  const skills = useSkillsOptional()

  const onTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    else return
    event.preventDefault()
    const next = TABS[nextIndex]
    onTabChange(next.id)
    requestAnimationFrame(() => {
      document.getElementById(`agent-settings-tab-${next.id}`)?.focus()
    })
  }

  return (
    <div className={styles.panel} data-agent-settings>
      <div className={styles.tabs} role="tablist" aria-label="Agent 设置分类">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            id={`agent-settings-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="agent-settings-panel"
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? styles.tabOn : styles.tab}
            data-agent-settings-tab={item.id}
            onClick={() => onTabChange(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id="agent-settings-panel"
        className={styles.tabBody}
        role="tabpanel"
        aria-labelledby={`agent-settings-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'basic' ? <DeliverySettings /> : null}

        {tab === 'model' ? (
          <section className={styles.section} data-agent-settings-model>
            <div className={styles.sectionHead}>
              <h3>
                模型与路由
                <span className={styles.previewBadge}>方案预览</span>
              </h3>
              <p>
                Harness 尚未接入；当前仍由经典 Agent 使用现有模型服务。下面是接入后的唯一口径。
              </p>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>唯一入口</dt>
                <dd>全局设置 → 模型服务</dd>
              </div>
              <div>
                <dt>Agent 内部提供者</dt>
                <dd>
                  <code>qinghua-local</code>
                </dd>
              </div>
              <div>
                <dt>参与范围</dt>
                <dd>只使用已启用渠道和已勾选 Key 分组</dd>
              </div>
            </dl>
            <button
              type="button"
              className={styles.inlineButton}
              onClick={() => openGlobalSettings('channels')}
            >
              打开模型服务
            </button>
          </section>
        ) : null}

        {tab === 'tools' ? (
          <section className={styles.section} data-agent-settings-tools>
            <div className={styles.sectionHead}>
              <h3>
                工具权限
                <span className={styles.previewBadge}>方案预览</span>
              </h3>
              <p>Harness 接入后按来源分组；当前经典 Agent 继续使用既有工具集。</p>
            </div>
            <div className={styles.toolGroups}>
              {TOOL_GROUPS.map((group) => (
                <section key={group.title} className={styles.toolGroup}>
                  <div className={styles.toolHead}>
                    <h4>{group.title}</h4>
                    <span>{group.tools.length}</span>
                  </div>
                  <p>{group.detail}</p>
                  <div className={styles.toolNames}>
                    {group.tools.map((tool) => (
                      <code key={tool}>{tool}</code>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        ) : null}

        {tab === 'skills' ? (
          <section className={styles.section} data-agent-settings-skills>
            <div className={styles.sectionHead}>
              <h3>技能</h3>
              <p>技能决定 Agent 用哪套流程规划画布，不复制正文到 Agent 设置。</p>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>可用技能</dt>
                <dd>{skills.loading ? '读取中…' : `${skills.skills.length} 个`}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>全局技能库 + 用户导入</dd>
              </div>
            </dl>
            <button
              type="button"
              className={styles.inlineButton}
              onClick={() => {
                closeGlobalSettings()
                navigate('/skills')
              }}
            >
              打开技能库
            </button>
          </section>
        ) : null}

        {tab === 'memory' ? <AgentMemoryPanel /> : null}

        {tab === 'advanced' ? (
          <section className={styles.section} data-agent-settings-advanced>
            <div className={styles.sectionHead}>
              <h3>运行与诊断</h3>
              <p>运行记录、路由与存储仍由轻画统一管理。</p>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>付费请求</dt>
                <dd>只由现有路由与执行器发送；超时或结果不明不自动重发</dd>
              </div>
              <div>
                <dt>对话记录</dt>
                <dd>按项目与会话隔离，重启后保留</dd>
              </div>
              <div>
                <dt>运行日志</dt>
                <dd>记录渠道、Key 分组、实际模型、尝试阶段与失败原因</dd>
              </div>
            </dl>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.inlineButton}
                onClick={() => openGlobalSettings('allLogs')}
              >
                打开日志
              </button>
              <button
                type="button"
                className={styles.inlineButton}
                onClick={() => openGlobalSettings('storage')}
              >
                打开存储
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
