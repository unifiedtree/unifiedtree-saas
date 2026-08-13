import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { HeroSection } from '../components/home/HeroSection'
import { StickyShowcase } from '../components/home/StickyShowcase'
import { TreeSection } from '../components/home/TreeSection'
import { ModulesOverview } from '../components/home/ModulesOverview'
import { WhyDifferent } from '../components/home/WhyDifferent'
import { HowItWorks } from '../components/home/HowItWorks'
import { StatsSection } from '../components/home/StatsSection'
import { TestimonialsSection } from '../components/home/TestimonialsSection'
import { CTABanner } from '../components/home/CTABanner'

export function HomePage() {
  return (
    // NOTE: no `overflow-hidden` anywhere up this tree. An overflow-hidden
    // ancestor becomes the scrollport for StickyShowcase's sticky behaviour
    // and silently kills it. Use overflow-x-clip if clipping is ever needed.
    <div className="min-h-screen">
      {/* tone="dark": the hero is a deep emerald valley, so the header starts
          transparent and only turns solid once scrolled past it. */}
      <Navbar tone="dark" />
      <main>
        <HeroSection />
        <StickyShowcase />
        <TreeSection />
        <ModulesOverview />
        {/* The contrast section sits right after the module grid: the reader has
            just seen WHAT we do, so this is the moment to say why it is not the
            ERP they have been sold before. */}
        <WhyDifferent />
        <HowItWorks />
        <StatsSection />
        <TestimonialsSection />
        <CTABanner />
      </main>
      <Footer />
    </div>
  )
}
