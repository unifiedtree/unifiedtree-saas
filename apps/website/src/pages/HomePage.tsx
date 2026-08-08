import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { HeroSection } from '../components/home/HeroSection'
import { TreeSection } from '../components/home/TreeSection'
import { StickyShowcase } from '../components/home/StickyShowcase'
import { ModulesOverview } from '../components/home/ModulesOverview'
import { HowItWorks } from '../components/home/HowItWorks'
import { StatsSection } from '../components/home/StatsSection'
import { TestimonialsSection } from '../components/home/TestimonialsSection'
import { IntegrationsOrbit } from '../components/home/IntegrationsOrbit'
import { CTABanner } from '../components/home/CTABanner'

export function HomePage() {
  return (
    // NOTE: no `overflow-hidden` anywhere up this tree. An overflow-hidden
    // ancestor becomes the scrollport for StickyShowcase's sticky rail and
    // silently kills the pin. Use overflow-x-clip if clipping is ever needed.
    <div className="min-h-screen">
      {/* tone="dark": the hero is now a deep emerald valley, so the header
          starts transparent and only turns solid on scroll. */}
      <Navbar tone="dark" />
      <main>
        <HeroSection />
        <TreeSection />
        <StickyShowcase />
        <ModulesOverview />
        <HowItWorks />
        <StatsSection />
        <TestimonialsSection />
        <IntegrationsOrbit />
        <CTABanner />
      </main>
      <Footer />
    </div>
  )
}
