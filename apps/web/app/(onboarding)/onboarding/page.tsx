import { OnboardingFlow } from './onboarding-flow';

export const metadata = {
  title: 'Connect Peec · Xperimints',
};

/**
 * Welcome / onboarding page. Brand-new accounts land here straight from
 * signup; the only step today is connecting Peec MCP since every
 * downstream feature reads from it. Users can skip and connect later
 * from /integrations — the flag we flip is "have they seen the welcome
 * screen", not "do they have a Peec token".
 */
export default function OnboardingPage() {
  return <OnboardingFlow />;
}
