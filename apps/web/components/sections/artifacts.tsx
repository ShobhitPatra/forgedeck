import { Ledger, LedgerRow } from '@/components/ledger'
import { copy } from '@/content/copy'

export function Artifacts() {
  return (
    <Ledger heading={copy.artifacts.heading}>
      {copy.artifacts.items.map((item) => (
        <LedgerRow key={item.title} title={item.title}>
          {item.body}
        </LedgerRow>
      ))}
    </Ledger>
  )
}
