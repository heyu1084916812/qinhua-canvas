import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import { ShotUpscalePanel } from './ShotUpscalePanel'
import type { ShotVideoToolsController } from './ShotVideoTools'
import { ShotVideoEditPanel } from './ShotVideoEditPanel'
import { ShotVideoErasePanel } from './ShotVideoErasePanel'
import { ShotVideoExtendPanel } from './ShotVideoExtendPanel'

export function ShotVideoPanels({
  model,
  actions,
  tools,
}: {
  model: ShotCardModel
  actions: ShotCardActions
  tools: ShotVideoToolsController
}) {
  return (
    <>
      <ShotUpscalePanel model={model} actions={actions} tools={tools} />
      <ShotVideoErasePanel model={model} actions={actions} tools={tools} />
      <ShotVideoEditPanel model={model} actions={actions} tools={tools} />
      <ShotVideoExtendPanel model={model} actions={actions} tools={tools} />
    </>
  )
}
