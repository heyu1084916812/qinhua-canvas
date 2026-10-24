import { useSyncExternalStore } from 'react'
import { openGlobalSettings } from '../../state/ui/globalSettings'
import {
  completeOnboarding,
  isOnboardingDone,
  subscribeOnboarding,
} from '../../state/ui/onboarding'
import styles from './GettingStarted.module.css'

/**
 * 首次使用引导（对账 #388 / E7）：**三步，可以跳过，可以重看**。
 *
 * 三步就是"从零到出第一张图"的最短路径：配渠道 → 放生成节点 → 点生成。
 * 每一步都带一个真的能用的出口（不是只写一句话）：
 * ① 打开「全局设置 → 模型服务」；② 说明生成节点从哪来；③ 说明生成按钮 / R 键在哪。
 *
 * 为什么挂在 AppShell（而不是画布页）：新用户第一次打开可能落在首页 / 项目页，
 * 引导不该等他先摸到画布才出现。看没看过只认本机标记（见 state/ui/onboarding）。
 */
const STEPS: { title: string; body: string; action?: { label: string; run: () => void } }[] = [
  {
    title: '① 添加模型服务',
    body: '模型服务 = 你要用哪家的模型。填地址与令牌、勾上模型之后，画布上的生成才点得亮。令牌只存在你自己的机器上。',
    action: { label: '打开模型服务', run: () => openGlobalSettings('channels') },
  },
  {
    title: '② 在画布上放一个生成节点',
    body: '左侧工具栏的「＋」里选生成节点；提示词节点接在它上游，出图就会按提示词来。',
  },
  {
    title: '③ 点生成',
    body: '选中节点后点面板里的「生成」，或者直接按 R。出好的图落在节点上，可以继续改图、做视频、导出。',
  },
]

export function GettingStarted() {
  const done = useSyncExternalStore(subscribeOnboarding, isOnboardingDone, isOnboardingDone)
  if (done) return null

  return (
    <div
      className={styles.scrim}
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
      data-getting-started
    >
      <div className={styles.card}>
        <header className={styles.head}>
          <h2 className={styles.title}>三分钟上手</h2>
          <p className={styles.sub}>从零到第一张图，就三步。</p>
        </header>
        <ol className={styles.list}>
          {STEPS.map((step) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepTitle}>{step.title}</span>
              <span className={styles.stepBody}>{step.body}</span>
              {step.action ? (
                <button
                  type="button"
                  className={styles.stepBtn}
                  data-onboarding-action
                  onClick={() => {
                    step.action?.run()
                    completeOnboarding()
                  }}
                >
                  {step.action.label}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        <div className={styles.foot}>
          <button
            type="button"
            className={styles.skip}
            data-onboarding-skip
            onClick={completeOnboarding}
          >
            跳过
          </button>
          <button
            type="button"
            className={styles.done}
            data-onboarding-done
            onClick={completeOnboarding}
          >
            知道了，开始用
          </button>
        </div>
        <p className={styles.hint}>想再看一次：设置 → 帮助 → 重看新手引导。</p>
      </div>
    </div>
  )
}
