import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'preact/hooks'
import { getActiveProfile, updateProfile } from '../../db/queries'
import { clearAllData, exportData, importData, isExportBundle, type ExportBundle } from '../../db/transfer'
import type { Profile } from '../../db/types'
import { Calibration } from '../Calibration/Calibration'
import styles from './ProfileScreen.module.css'

const LEVELS: Profile['claimedLevel'][] = ['below-A1', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const LEVEL_LABEL: Record<Profile['claimedLevel'], string> = {
  'below-A1': 'Below A1',
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
}

export function ProfileScreen() {
  const profile = useLiveQuery(() => getActiveProfile(), [])
  const [pendingImport, setPendingImport] = useState<ExportBundle | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [assessing, setAssessing] = useState(false)

  if (!profile) {
    return (
      <div class={styles.screen}>
        <p class={styles.muted}>No active profile. Reload to start fresh.</p>
      </div>
    )
  }

  if (assessing) {
    return (
      <Calibration
        targetLang={profile.targetLang}
        onComplete={(lvl) => {
          void updateProfile(profile.id, { claimedLevel: lvl })
          setAssessing(false)
        }}
        onCancel={() => setAssessing(false)}
      />
    )
  }

  const setLimit = (key: 'newPerDay' | 'practicePerDay', value: number) =>
    void updateProfile(profile.id, { dailyLimits: { ...profile.dailyLimits, [key]: value } })

  async function handleExport() {
    const blob = new Blob([JSON.stringify(await exportData(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `yak-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // allow re-picking the same file later
    if (!file) return
    setImportError(null)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isExportBundle(parsed)) {
        setImportError('That doesn’t look like a Yak export file.')
        return
      }
      setPendingImport(parsed)
    } catch {
      setImportError('Could not read that file.')
    }
  }

  return (
    <div class={styles.screen}>
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Level</h2>
        <div class={styles.chips}>
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              class={`${styles.chip} ${profile.claimedLevel === lvl ? styles.chipOn : ''}`}
              onClick={() => void updateProfile(profile.id, { claimedLevel: lvl })}
            >
              {LEVEL_LABEL[lvl]}
            </button>
          ))}
        </div>
        <button class={styles.link} onClick={() => setAssessing(true)}>
          Not sure? Run a quick assessment
        </button>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Daily limits</h2>
        <label class={styles.slider}>
          <span class={styles.sliderLabel}>
            New words / day <strong>{profile.dailyLimits.newPerDay}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={profile.dailyLimits.newPerDay}
            onChange={(e) => setLimit('newPerDay', Number((e.target as HTMLInputElement).value))}
          />
        </label>
        <label class={styles.slider}>
          <span class={styles.sliderLabel}>
            Practice / day <strong>{profile.dailyLimits.practicePerDay}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={500}
            step={25}
            value={profile.dailyLimits.practicePerDay}
            onChange={(e) => setLimit('practicePerDay', Number((e.target as HTMLInputElement).value))}
          />
        </label>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Data</h2>
        <button class={styles.action} onClick={() => void handleExport()}>
          Export all data
        </button>

        <label class={styles.action}>
          Import data
          <input type="file" accept="application/json" onChange={handleFile} hidden />
        </label>
        {importError ? <p class={styles.error}>{importError}</p> : null}
        {pendingImport ? (
          <div class={styles.confirm}>
            <p class={styles.muted}>Import this file — merge into, or replace, your current data?</p>
            <div class={styles.confirmRow}>
              <button class={styles.action} onClick={() => void importData(pendingImport, 'merge').then(() => setPendingImport(null))}>
                Merge
              </button>
              <button class={styles.danger} onClick={() => void importData(pendingImport, 'replace').then(() => setPendingImport(null))}>
                Replace
              </button>
              <button class={styles.action} onClick={() => setPendingImport(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {confirmClear ? (
          <div class={styles.confirm}>
            <p class={styles.muted}>This permanently deletes everything on this device.</p>
            <div class={styles.confirmRow}>
              <button class={styles.action} onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button class={styles.danger} onClick={() => void clearAllData().then(() => setConfirmClear(false))}>
                Delete everything
              </button>
            </div>
          </div>
        ) : (
          <button class={styles.dangerOutline} onClick={() => setConfirmClear(true)}>
            Clear all data
          </button>
        )}
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>About</h2>
        <p class={styles.muted}>Yak · build {__COMMIT_HASH__}</p>
        <p class={styles.muted}>Word data from the Kelly project, Wiktionary, and ipa-dict.</p>
      </section>
    </div>
  )
}
