import { useMemo, type ReactNode } from 'react'
import { useChannels } from '../providers/ChannelStoreProvider'
import { usePlatform } from '../providers/PlatformProvider'
import { createChannelRepository } from '../../state/project/channelRepository'
import { createStoryboardStore } from '../../state/project/storyboardStore'
import { createGenerationClient } from '../../platform/generation'
import { StoryboardExecutionProvider } from '../../features/storyboard/execution/StoryboardExecutionProvider'

/**
 * 漫剧执行宿主：只接线平台、渠道和漫剧文档，不挂画布 Store。
 *
 * R3 先作为 headless Provider 存在；现有控制器仍走旧画布路径，直到 R4 逐个迁移。
 */
export function StoryboardExecutionHost({
  projectId,
  children,
}: {
  projectId: string
  children?: ReactNode
}) {
  const platform = usePlatform()
  const channels = useChannels()
  const channelRepo = useMemo(
    () => createChannelRepository(platform.storage, platform.credentials),
    [platform.credentials, platform.storage],
  )
  const documents = useMemo(
    () => createStoryboardStore(platform.storage),
    [platform.storage],
  )
  const generation = useMemo(
    () =>
      createGenerationClient({
        platform,
        catalog: () => channels.protocolCatalog(),
        loadToken: (credentialRef) => channelRepo.loadToken(credentialRef),
      }),
    [channelRepo, channels, platform],
  )

  return (
    <StoryboardExecutionProvider
      projectId={projectId}
      storage={platform.storage}
      assets={platform.assets}
      documents={documents}
      generation={generation}
      channels={() => channels.getState().channels}
    >
      {children}
    </StoryboardExecutionProvider>
  )
}
