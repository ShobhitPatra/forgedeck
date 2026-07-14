export function Layer({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`border-t border-hairline px-6 py-20 sm:px-10 ${className}`}>
      <div className="mx-auto max-w-4xl">{children}</div>
    </section>
  )
}
