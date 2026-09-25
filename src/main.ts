import "./styles/theme.css";
import { registerRoute, startRouter } from "./state/router.ts";
import { renderHome } from "./ui/screens/home.ts";
import { renderSustainTest } from "./ui/screens/sustainTest.ts";
import { renderVolumeTest } from "./ui/screens/volumeTest.ts";
import { renderHarmonicsTest } from "./ui/screens/harmonicsTest.ts";
import { renderSavedResults } from "./ui/screens/savedResults.ts";
import { renderAbout } from "./ui/screens/about.ts";

registerRoute("/", () => renderHome());
registerRoute("/test/sustain", () => renderSustainTest());
registerRoute("/test/volume", () => renderVolumeTest());
registerRoute("/test/harmonics", () => renderHarmonicsTest());
registerRoute("/results", () => void renderSavedResults());
registerRoute("/about", () => renderAbout());

startRouter();
