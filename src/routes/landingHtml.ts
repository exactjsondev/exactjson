// Barrel re-export for modular Swiss Grid SSR UI (src/ui/*)
// IMPORTANT: Never import @x402/* or @coinbase/x402 in this file to keep GET / cold starts < 10ms.

export { renderLandingHtml } from "../ui/homePage";
export {
  renderMcpGuideHtml,
  renderNotFoundHtml,
  renderPaywallHtml,
} from "../ui/protocolPages";
export { renderSetupHtml } from "../ui/setupPage";
export {
  renderAboutHtml,
  renderContactHtml,
  renderDocsHtml,
  renderPricingHtml,
  renderPrivacyHtml,
} from "../ui/subPages";
