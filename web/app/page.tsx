import { Hero } from "@/components/landing/hero";
import { TuiMock } from "@/components/landing/tui-mock";
import { Features } from "@/components/landing/features";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Privacy } from "@/components/landing/privacy";
import { Faq } from "@/components/landing/faq";

export default function HomePage() {
  return (
    <>
      <Hero />
      <TuiMock />
      <Features />
      <HowItWorks />
      <Privacy />
      <Faq />
    </>
  );
}
