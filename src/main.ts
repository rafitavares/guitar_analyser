import "./styles/theme.css";
import { registerRoute, startRouter } from "./state/router.ts";
import { renderHome } from "./ui/screens/home.ts";
import { renderInstrumentForm } from "./ui/screens/instrumentForm.ts";
import { renderProtocolChecklist } from "./ui/screens/protocolChecklist.ts";
import { renderCalibration } from "./ui/screens/calibration.ts";
import { renderTestMenu } from "./ui/screens/testMenu.ts";
import { renderSustainContinuous } from "./ui/screens/sustainContinuous.ts";
import { renderResonanceContinuous } from "./ui/screens/resonanceContinuous.ts";
import { renderSessionSummary } from "./ui/screens/sessionSummary.ts";
import { renderSavedSessions } from "./ui/screens/savedSessions.ts";
import { renderCompareA } from "./ui/screens/compareA.ts";
import { renderCompareB } from "./ui/screens/compareB.ts";
import { renderAbout } from "./ui/screens/about.ts";

registerRoute("/", () => renderHome());
registerRoute("/instrument", () => void renderInstrumentForm());
registerRoute("/protocol", () => renderProtocolChecklist());
registerRoute("/calibration", () => renderCalibration());
registerRoute("/tests", () => renderTestMenu());
registerRoute("/summary", () => renderSessionSummary());
registerRoute("/sessions", () => void renderSavedSessions());
registerRoute("/compare-a", () => void renderCompareA());
registerRoute("/compare-b", () => void renderCompareB());
registerRoute("/about", () => renderAbout());
registerRoute("/test/sustain", () => void renderSustainContinuous());
registerRoute("/test/resonance", () => void renderResonanceContinuous());

startRouter();
