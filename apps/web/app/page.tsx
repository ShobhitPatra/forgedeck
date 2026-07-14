import { Footer } from '@/components/footer'
import { Nav } from '@/components/nav'
import { Artifacts } from '@/components/sections/artifacts'
import { Closer } from '@/components/sections/closer'
import { HandWrite } from '@/components/sections/hand-write'
import { Hero } from '@/components/sections/hero'
import { HumanNote } from '@/components/sections/human-note'
import { Proof } from '@/components/sections/proof'
import { Safety } from '@/components/sections/safety'
import { SeeIt } from '@/components/sections/see-it'

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <SeeIt />
        <Artifacts />
        <Safety />
        <HandWrite />
        <Proof />
        <HumanNote />
        <Closer />
      </main>
      <Footer />
    </>
  )
}
