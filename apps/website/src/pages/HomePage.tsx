import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { HeroSection } from '../components/home/HeroSection'
import { TreeSection } from '../components/home/TreeSection'
import { ModulesOverview } from '../components/home/ModulesOverview'
import { HowItWorks } from '../components/home/HowItWorks'
import { StatsSection } from '../components/home/StatsSection'
import { TestimonialsSection } from '../components/home/TestimonialsSection'
import { IntegrationsSection } from '../components/home/IntegrationsSection'
import { CTABanner } from '../components/home/CTABanner'

export function HomePage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        <HeroSection />
        <TreeSection />
        <ModulesOverview />
        <HowItWorks />
        <StatsSection />
        <TestimonialsSection />
        <IntegrationsSection />
        <CTABanner />
      </main>
      <Footer />
    </div>
  )
}
