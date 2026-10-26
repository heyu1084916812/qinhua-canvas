import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import type { StoryboardRunAction } from '../../../domain/storyboard/runTypes'
import {
  attachShotImages,
  attachShotVideos,
  setAssetBaseHash,
  setAssetTurnaroundHash,
  updateShotLine,
  type StoryboardDoc,
} from '../../../domain/storyboard/storyboard'
import type { AssetPort, StoragePort } from '../../../platform/ports'
import {
  assetHashIsReadable,
  putGeneratedAssets,
} from '../../../platform/assets'
import { errorTextOf } from '../../../shared/result'
import type { StoryboardExecutionCommand } from './storyboardCommands'

export interface StoryboardDocumentPort {
  load(projectId: string): Promise<StoryboardDoc>
  save(doc: StoryboardDoc): Promise<void>
}

export interface StoryboardProjectionPort {
  syncProject(projectId: string): Promise<void>
}

export interface StoryboardCommandExecutionResult {
  warnings: string[]
  failures: {
    taskId: string
    subjectId: string
    errorText: string
  }[]
}

export interface StoryboardCommandExecutor {
  execute(
    commands: readonly StoryboardExecutionCommand[],
  ): Promise<StoryboardCommandExecutionResult>
}

interface StoryboardCommandExecutorDeps {
  storage: StoragePort
  assets: AssetPort
  documents: StoryboardDocumentPort
  projection?: StoryboardProjectionPort
  now?: () => number
}

function mimeMatches(action: StoryboardRunAction, mime: string): boolean {
  const normalized = mime.trim().toLowerCase()
  if (action === 'asset-base' || action === 'asset-turnaround' || action === 'shot-image') {
    return normalized.startsWith('image/')
  }
  if (action === 'speech') return normalized.startsWith('audio/')
  return normalized.startsWith('video/')
}

function applyBusinessHash(
  doc: StoryboardDoc,
  command: Extract<StoryboardExecutionCommand, { kind: 'storyboard.commit' }>,
  hash: string,
  at: number,
): StoryboardDoc {
  const { subject, action } = command
  if (subject.kind === 'asset') {
    if (action === 'asset-base') {
      return setAssetBaseHash(doc, subject.assetType, subject.assetId, hash, at)
    }
    return setAssetTurnaroundHash(doc, 'char', subject.assetId, hash, at)
  }
  if (subject.kind === 'speech') {
    const params =
      command.metadata.params && typeof command.metadata.params === 'object'
        ? (command.metadata.params as Record<string, unknown>)
        : {}
    const audioName =
      typeof params.audioName === 'string' && params.audioName.trim()
        ? params.audioName.trim()
        : `配音-${subject.lineId}.mp3`
    return updateShotLine(
      doc,
      subject.shotId,
      subject.lineId,
      { audioHash: hash, audioName },
      at,
    )
  }
  if (subject.kind === 'shot-image') {
    return attachShotImages(doc, [{ shotId: subject.shotId, hash }], at)
  }
  return attachShotVideos(doc, [{ shotId: subject.shotId, hash }], at)
}

function businessHashOf(
  doc: StoryboardDoc,
  subject: Extract<
    StoryboardExecutionCommand,
    { kind: 'storyboard.commit' }
  >['subject'],
  action: StoryboardRunAction,
): string | undefined {
  if (subject.kind === 'asset') {
    const source =
      subject.assetType === 'char' ? doc.characters : doc.scenes
    const asset = source.find((item) => item.id === subject.assetId)
    return action === 'asset-base' ? asset?.baseHash : asset?.turnaroundHash
  }
  if (subject.kind === 'speech') {
    return doc.shots
      .find((shot) => shot.id === subject.shotId)
      ?.lines.find((line) => line.id === subject.lineId)?.audioHash
  }
  const shot = doc.shots.find((item) => item.id === subject.shotId)
  return subject.kind === 'shot-image' ? shot?.imageHash : shot?.videoHash
}

function failedRecord(record: RunRecord, errorText: string): RunRecord {
  if (record.status !== 'succeeded') return record
  return {
    ...record,
    status: 'failed',
    outputHashes: [],
    errorText,
  }
}

export function createStoryboardCommandExecutor(
  deps: StoryboardCommandExecutorDeps,
): StoryboardCommandExecutor {
  const now = deps.now ?? (() => Date.now())
  const commitFailures = new Map<string, string>()

  return {
    async execute(commands) {
      const warnings: string[] = []
      const failures: StoryboardCommandExecutionResult['failures'] = []

      for (const command of commands) {
        if (command.kind === 'storyboard.commit') {
          try {
            const primary = command.assets[0]
            if (!primary) {
              throw new Error('生成成功但没有可落库的产物')
            }
            if (!mimeMatches(command.action, primary.mime)) {
              throw new Error(
                `产物 MIME ${primary.mime} 与动作 ${command.action} 不匹配`,
              )
            }

            const at = now()
            await putGeneratedAssets(
              deps.storage,
              deps.assets,
              command.projectId,
              command.assets,
              at,
            )
            if (!(await assetHashIsReadable(deps.assets, primary.hash))) {
              throw new Error(`产物 ${primary.hash} 写入后不可读`)
            }

            const latest = await deps.documents.load(command.projectId)
            const next = applyBusinessHash(latest, command, primary.hash, at)
            await deps.documents.save(next)
            const persisted = await deps.documents.load(command.projectId)
            if (businessHashOf(persisted, command.subject, command.action) !== primary.hash) {
              throw new Error('业务文档写回后校验失败')
            }
          } catch (error) {
            const errorText = errorTextOf(error)
            commitFailures.set(command.taskId, errorText)
            failures.push({
              taskId: command.taskId,
              subjectId: command.subject.id,
              errorText,
            })
          }
          continue
        }

        if (command.kind === 'runRecord.finalize') {
          const commitFailure = commitFailures.get(command.taskId)
          const record = commitFailure
            ? failedRecord(command.record, `生成成功，但业务保存失败：${commitFailure}`)
            : command.record
          try {
            await deps.storage.put('runRecords', record as never)
          } catch (error) {
            warnings.push(`runRecord.finalize: ${errorTextOf(error)}`)
          } finally {
            if (commitFailure) commitFailures.delete(command.taskId)
          }
          continue
        }

        try {
          await deps.projection?.syncProject(command.projectId)
        } catch (error) {
          warnings.push(`storyboard.projection.sync: ${errorTextOf(error)}`)
        }
      }

      return { warnings, failures }
    },
  }
}
