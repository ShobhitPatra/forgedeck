import { Ledger, LedgerRow } from '@/components/ledger'
import { copy } from '@/content/copy'

const EFFECT_CLASS = {
  read: 'text-read',
  write: 'text-write',
  irreversible: 'text-irreversible',
} as const

type SafetyItem = (typeof copy.safety.items)[number]

function title(item: SafetyItem) {
  if ('title' in item) return item.title
  return (
    <span className="flex flex-wrap gap-x-3 font-mono text-[13px] font-normal">
      {item.effects.map((effect) => (
        <span key={effect} className={EFFECT_CLASS[effect]}>
          {effect}
        </span>
      ))}
    </span>
  )
}

export function Safety() {
  return (
    <Ledger heading={copy.safety.heading}>
      {copy.safety.items.map((item) => (
        <LedgerRow key={item.body} title={title(item)}>
          {item.body}
        </LedgerRow>
      ))}
    </Ledger>
  )
}
