/**
 * 格的生成留痕与版本回退（M6-15，纯函数）。
 *
 * 这一组函数回答三个问题：
 *   ① 新的一次生成怎么进历史？      → `panelRunFromRecord` + `appendPanelRun`
 *   ② 哪一版是当前生效的？          → `livePanelRun`
 *   ③ 怎么回到某一版？              → `restorePanelRun`（+ `canRestorePanelRun` 守门）
 *
 * ── 三条不变量（少一条就会退化成「有历史但没用」）──
 *
 * 1. **只增不减**。任何操作都不删留痕（产品文档 §6.21）。历史是「发生过的事」，
 *    不是「可编辑的列表」——删掉一条就等于把那一版产物变成孤儿（`assets` 表里
 *    的字节还在，却再没有指针指向它）。
 *
 * 2. **版本号由历史自身推出**，不由调用方给（`nextPanelRunVersion`）。理由见
 *    `comicProject.ts` 里 `ComicPanelRun` 的说明：留痕住在聚合对象内部，聚合对象
 *    就是版本号的权威。调用方给号会出现两条 v3、或者跳号，而这类错误**在界面上
 *    看起来很正常**（行数对得上），要等到「回退到了 v3 结果回到另一版」才暴露。
 *
 * 3. **回退本身也是一次新版本**。`restorePanelRun` 把目标版本的输入与产物写回，
 *    然后**追加一条新留痕**，而不是把面板指针「拨回去」。于是历史永远是一条只增的
 *    时间线，没有「重写历史」这种状态，也就不需要 undo 栈来兜底——comic 目前
 *    `canUndo()` 恒为 false（见 `state/workbenches/comic/store.ts`）。
 *
 * 纯度：只依赖 `domain/comic/model` 与 `domain/shared`，无 IO、无时间、无随机
 * （时间与 id 由调用方传入，见 `PanelRunStart`）。
 */

import type { ComicPanel, ComicPanelRun, ComicShot } from '../model/comicProject'
import type { RunRecord } from '../../shared/execution/runRecord'
import { imageInputsOf } from '../../shared/execution/inputs'
import { asComicPanelParams } from './panelRun'

/**
 * 新留痕的载荷：与 `ComicPanelRun` 同形，**唯独没有 `version`**。
 *
 * 这个 Omit 不是为了省事，而是把不变量 2 变成类型层面的约定：调用方**拿不到**
 * 指定版本号的途径，版本只能由 `appendPanelRun` 从历史推出。
 */
export type PanelRunInput = Omit<ComicPanelRun, 'version'>

/** 回退需要的外部输入（时间与 id 都是副作用，故由调用方给，domain 保持纯函数） */
export interface PanelRunStart {
  /** 这次回退所产生的那条新留痕的 id */
  newRunId: string
  createdAt: number
}

/** 下一个版本号 = 历史里最大版本 + 1（空历史从 1 起） */
export function nextPanelRunVersion(runs: readonly ComicPanelRun[]): number {
  let max = 0
  for (const r of runs) if (r.version > max) max = r.version
  return max + 1
}

/**
 * 追加一条留痕；同 id 已存在则返回**原格引用**（幂等）。
 *
 * 幂等不是洁癖：引擎的 `record` 命令与产物写回走的是同一次 `writeBack`，
 * 而 comic 的 store 是「防抖整对象落库」——重放、或者未来引入重试时，
 * 同一条记录被追加两次会让历史里出现两个孪生版本（版本号还不同），
 * 用户完全无从分辨哪条才是那一次。
 */
export function appendPanelRun(panel: ComicPanel, input: PanelRunInput): ComicPanel {
  if (panel.runs.some((r) => r.id === input.id)) return panel
  const run: ComicPanelRun = { ...input, version: nextPanelRunVersion(panel.runs) }
  return { ...panel, runs: [...panel.runs, run] }
}

/**
 * 这一版能回退吗？
 *
 * 只有**成功且有产物**的版本可回退。失败 / 取消的那一次没有画面——把它写回
 * `assetHash` 等于「回退到一张不存在的图」，只能得到空白格；而「把它的输入快照
 * 写回、产物保持不动」又是另一种语义（恢复配置 ≠ 恢复画面），混在同一条路径里
 * 会让「回退」这个词一次表示两件事。因此：失败版本**如实留痕但不给回退入口**，
 * 界面上灰掉并说明原因。
 */
export function canRestorePanelRun(run: ComicPanelRun): boolean {
  return run.status === 'succeeded' && run.outputHashes.length > 0
}

/**
 * 当前生效的版本 = 版本号最大且「有产物」的那一条；没有则 null。
 *
 * 注意它与 `panel.assetHash` 的分工：`assetHash` 是**画面**的真相（渲染只看它），
 * 本函数是**历史**的真相（列表里给哪一行打「当前」标记）。二者在正常情况下一致；
 * 唯一会分叉的场景是「某次生成成功但渠道没回图」（产物为空、assetHash 被清），
 * 此时画面为空、而历史仍指向上一个真正出过图的版本。
 */
export function livePanelRun(runs: readonly ComicPanelRun[]): ComicPanelRun | null {
  let best: ComicPanelRun | null = null
  for (const r of runs) {
    if (!canRestorePanelRun(r)) continue
    if (!best || r.version > best.version) best = r
  }
  return best
}

/**
 * 回退到某一版：写回画面输入与产物，并**把这次回退追加为新版本**（不变量 3）。
 *
 * 写回什么：画面描述 / 景别 / 机位 / 出场角色 / 渠道 / 模型 / 产物。
 * 刻意**不写回**：
 *   - 对白贴纸：不烘进图，回退画面不该动对白（与 `panel.setAsset` 同一原则）；
 *   - 转场 `transition`：它是「与上一格的叙事关系」，不是画面输入，回退画面时
 *     没有理由改叙事的连接方式。
 *
 * 源版本不存在、或不可回退（失败 / 无产物）时返回**原格引用** —— 让 store 侧
 * 靠 `next !== prev` 判出「这次没改动」，既不空写库、也不产生一条假的留痕。
 */
export function restorePanelRun(
  panel: ComicPanel,
  runId: string,
  start: PanelRunStart,
): ComicPanel {
  const src = panel.runs.find((r) => r.id === runId)
  if (!src || !canRestorePanelRun(src)) return panel

  // 转场不在快照里（见上），故按「保留面板当前转场」重建 shot
  const shot: ComicShot = { framing: src.framing, angle: src.angle }
  if (panel.shot.transition) shot.transition = panel.shot.transition

  const restored: ComicPanel = {
    ...panel,
    scene: src.scene,
    shot,
    // 复制而非共享引用：模型虽然全线不可变，但让面板与历史条目共用同一个数组，
    // 等于把「两处永远同步」变成一个必须靠纪律维持的假设，不值当
    characterIds: [...src.characterIds],
    channelId: src.channelId,
    model: src.model,
    assetHash: src.outputHashes[0],
    runs: [
      ...panel.runs,
      {
        ...src,
        id: start.newRunId,
        version: nextPanelRunVersion(panel.runs),
        createdAt: start.createdAt,
        // 回退没有调用渠道：如实记 0，而不是抄源版本的耗时（那会凭空多出一次「生成」）
        durationMs: 0,
      },
    ],
  }
  return restored
}

/**
 * 共享 `RunRecord`（引擎产出）→ comic 的留痕载荷。
 *
 * **id 直接沿用 `record.id`**（引擎的 `createId('rec')`）——不另起一个 id：同一次
 * 调用在「引擎的记录」与「格的留痕」里是同一个东西，id 相同既省一次随机、
 * 又让「这条留痕对应哪次执行」可以直接对表；配合 `appendPanelRun` 的幂等，
 * 同一条记录重复落一次也不会变成两个版本。
 *
 * 参考图取 `imageInputsOf(record.inputs)` 的口径（去重 + 上限 4），与渠道层
 * 真正上传的那几张**完全一致**——展示「参考图 ×n」时不会多算被截掉的。
 */
export function panelRunFromRecord(record: RunRecord): PanelRunInput {
  const params = asComicPanelParams(record.params)
  return {
    id: record.id,
    createdAt: record.createdAt,
    status: record.status,
    outputHashes: [...record.outputHashes],
    scene: params.scene,
    framing: params.framing,
    angle: params.angle,
    characterIds: [...params.characterIds],
    channelId: params.channelId,
    model: params.model,
    referenceHashes: imageInputsOf(record.inputs).map((i) => i.assetHash),
    fingerprint: record.fingerprint,
    durationMs: record.durationMs,
  }
}
