import { Loading } from '../Loading/Loading'

/** First-launch screen shown while the Swedish seed imports into IndexedDB. */
export function SeedLoading() {
  return <Loading caption="Fetching your words…" />
}
