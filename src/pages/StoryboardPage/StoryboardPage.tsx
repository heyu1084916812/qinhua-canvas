import { useParams } from 'react-router-dom'
import { StoryboardEmpty } from './StoryboardEmpty'
import { StoryboardProject } from './StoryboardProject'

export function StoryboardPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <StoryboardEmpty />
  return <StoryboardProject key={projectId} projectId={projectId} />
}
