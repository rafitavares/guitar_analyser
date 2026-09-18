import "./styles/theme.css";
import { registerRoute, startRouter } from "./state/router.ts";
import { renderHome } from "./ui/screens/home.ts";
import { renderInstrumentForm } from "./ui/screens/instrumentForm.ts";
import { renderProtocolChecklist } from "./ui/screens/protocolChecklist.ts";
import { renderCalibration } from "./ui/screens/calibration.ts";
import { renderTestMenu } from "./ui/screens/testMenu.ts";
import { renderTestRunner } from "./ui/screens/testRunner.ts";
import { renderSessionSummary } from "./ui/screens/sessionSummary.ts";
import { renderSavedSessions } from "./ui/screens/savedSessions.ts";
import { renderCompareA } from "./ui/screens/compareA.ts";
import { renderCompareB } from "./ui/screens/compareB.ts";
import { renderAbout } from "./ui/screens/about.ts";
import type { TestId } from "./types/index.ts";

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

const TEST_IDS: TestId[] = ["sustain", "harmonicPortrait", "inharmonicity", "beating", "hnr", "semitoneSweep"];
for (const id of TEST_IDS) {
  registerRoute(`/test/${id}`, () => void renderTestRunner(id));
}

startRouter();
