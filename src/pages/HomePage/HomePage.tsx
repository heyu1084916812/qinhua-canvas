import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository } from '../../state/project/repository'
import { projectRoute } from '../../domain/shared/workbench'
import styles from './HomePage.module.css'

/**
 * 首页（产品文档 §5.1：`/`）。
 *
 * 2026-09-27 应用壳改版后它**变轻了**：原来那个叫「首页」的页面装着项目网格，
 * 而项目网格已按 §5.1 迁到一级「项目」页（`/projects`）。
 * 这里只留欢迎与快捷入口 —— 首页是「进门第一眼」，不是第二个项目页。
 *
 * 刻意**不画顶栏 / 品牌 / 主题切换**：那些归应用壳（§5.2）。
 */
export function HomePage() {
  const navigate = useNavigate()
  const platform = usePlatform()
  const repoRef = useRef<ReturnType<typeof createProjectRepository> | null>(null)

  /**
   * 「新建项目」= 真的把项目建出来再进画布（产品文档 §5.1：首页保留新建入口）。
   *
   * 为什么不是「跳去 /projects 让用户自己点」：那是把一个**动作**
   * 换成了「再走两步」。首页是进门第一眼，最常见的事就是开一张新画布，
   * 这条路径必须一步到位 —— 与侧栏那个「+ 新建项目」同一个语义。
   *
   * 未选模板 = 空白画布：模板是**可选的**起点，不该成为新建的前置条件。
   */
  const createBlank = async () => {
    const repo = (repoRef.current ??= createProjectRepository(platform.storage))
    const created = await repo.create({ workbench: 'canvas' })
    navigate(projectRoute('canvas', created.id))
  }

  return (
    <div className={styles.page} data-home-page>
      <div className={styles.inner}>
        <h1 className={styles.title}>轻画</h1>
        <p className={styles.subtitle}>给图片与视频生成用的无限画布</p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-home-new
            onClick={() => void createBlank()}
          >
            新建项目
          </button>
          {/*
            「我的项目」是次入口：要看/管理已有项目、想从模板开始时走这条。
          */}
          <button
            type="button"
            className={styles.ghost}
            data-home-projects
            onClick={() => navigate('/projects')}
          >
            我的项目
          </button>
        </div>
      </div>
    </div>
  )
}
