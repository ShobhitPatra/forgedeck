import { Footer } from '@/components/footer'
import { Nav } from '@/components/nav'
import { Artifacts } from '@/components/sections/artifacts'
import { Closer } from '@/components/sections/closer'
import { Hero } from '@/components/sections/hero'
import { Safety } from '@/components/sections/safety'

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Artifacts />
        <Safety />
        <Closer />
      </main>
      <Footer />
    </>
  )
}
