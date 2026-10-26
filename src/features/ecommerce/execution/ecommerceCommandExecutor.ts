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
 * 单条落库失败不会触发模型重发。若模型已经成功但素材字节没写进去，
 * 结果必须停在「生成成功、保存失败」的可恢复失败态；后续成功 RunRecord
 * 只证明上游调用成功，不能把缺失的产物改判为 done。
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
          const { errorText: _oldError, recovery: _oldRecovery, ...rest } = row
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
          const row = await deps.taskRepo.result(command.resultId)
          if (!row) throw new Error(`电商结果不存在：${command.resultId}`)
          const at = now()
          try {
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
                  projectId: row.projectId,
                } as never,
              )
            }
          } catch (error) {
            const current = await deps.taskRepo.result(command.resultId)
            if (current) {
              const {
                errorText: _oldError,
                recovery: _oldRecovery,
                assetHash: _oldAssetHash,
                mime: _oldMime,
                width: _oldWidth,
                height: _oldHeight,
                ...rest
              } = current
              await deps.taskRepo.updateResult({
                ...rest,
                status: 'failed',
                recovery: 'retry-save',
                errorText: `生成已成功，但素材保存失败：${errorTextOf(error)}。请重试保存结果，不要重新生成。`,
                updatedAt: at,
              })
            }
            throw new Error(`素材保存失败：${errorTextOf(error)}`)
          }
          const { errorText: _oldError, recovery: _oldRecovery, ...rest } = row
          await deps.taskRepo.updateResult({
            ...rest,
            status: 'done',
            assetHash: primary.hash,
            mime: primary.mime,
            prompt: command.prompt,
            model: command.model,
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
            const { errorText: _oldError, recovery: _oldRecovery, ...rest } = row
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
