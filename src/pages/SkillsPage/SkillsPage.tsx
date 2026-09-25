import { useNavigate } from 'react-router-dom'
import { SkillsPanel } from './SkillsPanel'
import styles from './SkillsPage.module.css'

/**
 * 技能库页（用户 2026-09-24）。
 *
 * 本文件只做**页面外壳**：顶栏 + 返回。技能管理的全部内容在 `SkillsPanel` ——
 * 它同时被后台设置页的「技能」分区复用（用户 2026-09-25「后台中枢」）。
 *
 * 为什么仍保留这个独立页面：画布面板在「一个技能都没有」时会深链到这里
 * （缺技能时的可点出口），而从画布跳过来时用户**期望能直接改**，
 * 不该先经过后台设置页再找分区。
 */
export function SkillsPage() {
  const navigate = useNavigate()

  return (
    <div className={styles.page} data-skills-page>
      <header className={styles.top}>
        <button type="button" className={styles.back} onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <h1 className={styles.title}>技能库</h1>
      </header>
      <SkillsPanel />
    </div>
  )
}
