import { useState, type Dispatch, type SetStateAction } from 'react'
import { normalizeVideoEditResolution } from '../../domain/storyboard/videoEdit'
import { normalizeVideoExtendSettings } from '../../domain/storyboard/videoExtend'
import { normalizeVideoUpscaleSettings } from '../../domain/storyboard/videoUpscale'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'

export interface ShotVideoToolsController {
  upscaleOpen: boolean
  setUpscaleOpen: Dispatch<SetStateAction<boolean>>
  upscaleTargetIndex: number
  setUpscaleTargetIndex: Dispatch<SetStateAction<number>>
  upscaleResolution: string
  setUpscaleResolution: Dispatch<SetStateAction<string>>
  upscaleFrameRate: number | null
  setUpscaleFrameRate: Dispatch<SetStateAction<number | null>>
  videoEraseOpen: boolean
  setVideoEraseOpen: Dispatch<SetStateAction<boolean>>
  videoEraseTargetIndex: number
  setVideoEraseTargetIndex: Dispatch<SetStateAction<number>>
  videoEditOpen: boolean
  setVideoEditOpen: Dispatch<SetStateAction<boolean>>
  videoEditTargetIndex: number
  setVideoEditTargetIndex: Dispatch<SetStateAction<number>>
  videoEditInstruction: string
  setVideoEditInstruction: Dispatch<SetStateAction<string>>
  videoEditResolution: string
  setVideoEditResolution: Dispatch<SetStateAction<string>>
  videoEditUseReference: boolean
  setVideoEditUseReference: Dispatch<SetStateAction<boolean>>
  videoExtendOpen: boolean
  setVideoExtendOpen: Dispatch<SetStateAction<boolean>>
  videoExtendTargetIndex: number
  setVideoExtendTargetIndex: Dispatch<SetStateAction<number>>
  videoExtendInstruction: string
  setVideoExtendInstruction: Dispatch<SetStateAction<string>>
  videoExtendResolution: string
  setVideoExtendResolution: Dispatch<SetStateAction<string>>
  videoExtendDuration: number | null
  setVideoExtendDuration: Dispatch<SetStateAction<number | null>>
  currentUpscaleTarget: ShotCardModel['videoUpscaleTargets'][number] | undefined
  currentVideoEraseTarget: ShotCardModel['videoEraseTargets'][number] | undefined
  currentVideoEditTarget: ShotCardModel['videoEditTargets'][number] | undefined
  currentVideoExtendTarget: ShotCardModel['videoExtendTargets'][number] | undefined
  canReferenceShotImage: boolean
  upscaleBusy: boolean
  videoErasing: boolean
  videoEditing: boolean
  videoExtending: boolean
  openUpscale: () => void
  openVideoEdit: () => void
  openVideoExtend: () => void
}

export function useShotVideoTools(
  model: ShotCardModel,
  _actions: ShotCardActions,
): ShotVideoToolsController {
  const {
    shot,
    laidOut,
    videoUpscaleTargets,
    videoUpscaleBusyShotId,
    videoEraseTargets,
    videoEraseBusyShotId,
    videoEditTargets,
    videoEditBusyShotId,
    videoExtendTargets,
    videoExtendBusyShotId,
  } = model
  const [upscaleOpen, setUpscaleOpen] = useState(false)
  const [upscaleTargetIndex, setUpscaleTargetIndex] = useState(0)
  const [upscaleResolution, setUpscaleResolution] = useState('1080p')
  const [upscaleFrameRate, setUpscaleFrameRate] = useState<number | null>(30)
  const [videoEraseOpen, setVideoEraseOpen] = useState(false)
  const [videoEraseTargetIndex, setVideoEraseTargetIndex] = useState(0)
  const [videoEditOpen, setVideoEditOpen] = useState(false)
  const [videoEditTargetIndex, setVideoEditTargetIndex] = useState(0)
  const [videoEditInstruction, setVideoEditInstruction] = useState('')
  const [videoEditResolution, setVideoEditResolution] = useState('480p')
  const [videoEditUseReference, setVideoEditUseReference] = useState(false)
  const [videoExtendOpen, setVideoExtendOpen] = useState(false)
  const [videoExtendTargetIndex, setVideoExtendTargetIndex] = useState(0)
  const [videoExtendInstruction, setVideoExtendInstruction] = useState('')
  const [videoExtendResolution, setVideoExtendResolution] = useState('720P')
  const [videoExtendDuration, setVideoExtendDuration] = useState<number | null>(5)

  const currentUpscaleTarget =
    videoUpscaleTargets[Math.min(upscaleTargetIndex, videoUpscaleTargets.length - 1)]
  const currentVideoEraseTarget =
    videoEraseTargets[Math.min(videoEraseTargetIndex, videoEraseTargets.length - 1)]
  const currentVideoEditTarget =
    videoEditTargets[Math.min(videoEditTargetIndex, videoEditTargets.length - 1)]
  const currentVideoExtendTarget =
    videoExtendTargets[Math.min(videoExtendTargetIndex, videoExtendTargets.length - 1)]
  const canReferenceShotImage =
    Boolean(shot.imageHash) &&
    laidOut &&
    Boolean(currentVideoEditTarget?.supportsReferenceImage)

  const openUpscale = () => {
    const target = videoUpscaleTargets[0]
    if (!target) return
    const normalized = normalizeVideoUpscaleSettings(target.model)
    setUpscaleTargetIndex(0)
    setUpscaleResolution(normalized.resolution)
    setUpscaleFrameRate(normalized.frameRate)
    setUpscaleOpen(true)
  }

  const openVideoEdit = () => {
    const target = videoEditTargets[0]
    if (!target) return
    setVideoEditTargetIndex(0)
    setVideoEditInstruction('')
    setVideoEditResolution(normalizeVideoEditResolution(target.model))
    setVideoEditUseReference(
      Boolean(target.supportsReferenceImage && shot.imageHash && laidOut),
    )
    setVideoEditOpen(true)
  }

  const openVideoExtend = () => {
    const target = videoExtendTargets[0]
    if (!target) return
    const normalized = normalizeVideoExtendSettings(target.model)
    setVideoExtendTargetIndex(0)
    setVideoExtendInstruction('延续当前镜头内容与运动，保持人物、场景和画风一致')
    setVideoExtendResolution(normalized.resolution)
    setVideoExtendDuration(normalized.duration)
    setVideoExtendOpen(true)
  }

  return {
    upscaleOpen,
    setUpscaleOpen,
    upscaleTargetIndex,
    setUpscaleTargetIndex,
    upscaleResolution,
    setUpscaleResolution,
    upscaleFrameRate,
    setUpscaleFrameRate,
    videoEraseOpen,
    setVideoEraseOpen,
    videoEraseTargetIndex,
    setVideoEraseTargetIndex,
    videoEditOpen,
    setVideoEditOpen,
    videoEditTargetIndex,
    setVideoEditTargetIndex,
    videoEditInstruction,
    setVideoEditInstruction,
    videoEditResolution,
    setVideoEditResolution,
    videoEditUseReference,
    setVideoEditUseReference,
    videoExtendOpen,
    setVideoExtendOpen,
    videoExtendTargetIndex,
    setVideoExtendTargetIndex,
    videoExtendInstruction,
    setVideoExtendInstruction,
    videoExtendResolution,
    setVideoExtendResolution,
    videoExtendDuration,
    setVideoExtendDuration,
    currentUpscaleTarget,
    currentVideoEraseTarget,
    currentVideoEditTarget,
    currentVideoExtendTarget,
    canReferenceShotImage,
    upscaleBusy: videoUpscaleBusyShotId === shot.id,
    videoErasing: videoEraseBusyShotId === shot.id,
    videoEditing: videoEditBusyShotId === shot.id,
    videoExtending: videoExtendBusyShotId === shot.id,
    openUpscale,
    openVideoEdit,
    openVideoExtend,
  }
}
