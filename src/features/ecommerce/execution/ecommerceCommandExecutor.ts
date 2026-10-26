import type { StoragePort } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'
import type { EcommerceCanvasRepository } from '../../../state/project/ecommerceCanvasRepository'
import type { EcommerceTaskRepository } from '../../../state/project/ecommerceTaskRepository'
import type { EcommerceExecutionCommand } from './ecommercePlacement'

export interface EcommerceCommandDeps {
  storage: StoragePort
  taskRepo: EcommerceTaskRepository
  canvasRepo: EcommerceCanvasRepository
  now?: () => number
}

/**
 * 顺序执行 Placement 命令。
 *
 * 单条落库失败不会阻断后续命令：生成已经成功时，结果投影或日志补写失败
 * 只能留下真实警告，不能把整次付费生成改判失败，更不能触发重发。
 */
export async function executeEcommerceCommands(
  commands: readonly EcommerceExecutionCommand[],
  deps: EcommerceCommandDeps,
): Promise<string[]> {
  const now = deps.now ?? (() => Date.now())
  const warnings: string[] = []

  for (const command of commands) {
    try {
      switch (command.kind) {
        case 'result.status': {
          const row = await deps.taskRepo.result(command.resultId)
          if (!row) throw new Error(`电商结果不存在：${command.resultId}`)
          const { errorText: _oldError, ...rest } = row
          await deps.taskRepo.updateResult({
            ...rest,
            status: command.status,
            updatedAt: now(),
            ...(command.errorText ? { errorText: command.errorText } : {}),
          })
          break
        }
        case 'result.commit': {
          const primary = command.assets[0]
          if (!primary) throw new Error('生成成功但没有返回可落库的产物')
          const at = now()
          for (const asset of command.assets) {
            await deps.storage.put(
              'assets',
              {
                id: asset.hash,
                hash: asset.hash,
                mime: asset.mime,
                bytes: asset.bytes,
                ...(asset.width ? { width: asset.width } : {}),
                ...(asset.height ? { height: asset.height } : {}),
                ...(asset.url ? { url: asset.url } : {}),
                createdAt: at,
              } as never,
            )
          }
          const row = await deps.taskRepo.result(command.resultId)
          if (!row) throw new Error(`电商结果不存在：${command.resultId}`)
          const { errorText: _oldError, ...rest } = row
          await deps.taskRepo.updateResult({
            ...rest,
            status: 'done',
            assetHash: primary.hash,
            mime: primary.mime,
            ...(primary.width ? { width: primary.width } : {}),
            ...(primary.height ? { height: primary.height } : {}),
            updatedAt: at,
          })
          break
        }
        case 'runRecord.finalize': {
          await deps.storage.put('runRecords', command.record as never)
          if (command.status) {
            const row = await deps.taskRepo.result(command.resultId)
            if (!row) throw new Error(`电商结果不存在：${command.resultId}`)
            const { errorText: _oldError, ...rest } = row
            await deps.taskRepo.updateResult({
              ...rest,
              status: command.status,
              updatedAt: now(),
              ...(command.errorText ? { errorText: command.errorText } : {}),
            })
          }
          break
        }
        case 'projection.sync': {
          await deps.taskRepo.reconcileFromRunRecords(command.projectId)
          await deps.taskRepo.refreshTaskStatus(command.taskId)
          await deps.canvasRepo.sync(command.projectId)
          break
        }
      }
    } catch (error) {
      warnings.push(`${command.kind}: ${errorTextOf(error)}`)
    }
  }

  return warnings
}
