import styles from './FilterChip.module.css'

interface Option<T extends string> {
  value: T
  label: string
}

/** A filter chip showing its current value; tapping opens a menu of options. (SPEC §7.3) */
export function FilterChip<T extends string>({
  label,
  value,
  options,
  open,
  onToggle,
  onChange,
}: {
  label: string
  value: T
  options: readonly Option<T>[]
  open: boolean
  onToggle: () => void
  onChange: (value: T) => void
}) {
  const current = options.find((o) => o.value === value)
  const isDefault = options[0]?.value === value

  return (
    <div class={styles.wrap}>
      <button class={`${styles.chip} ${isDefault ? '' : styles.active}`} onClick={onToggle}>
        {label}: {current?.label ?? ''} ▾
      </button>
      {open ? (
        <ul class={styles.menu}>
          {options.map((o) => (
            <li key={o.value}>
              <button
                class={`${styles.item} ${o.value === value ? styles.itemActive : ''}`}
                onClick={() => onChange(o.value)}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
