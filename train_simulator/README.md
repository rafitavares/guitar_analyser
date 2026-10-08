# Traction Converter Simulator

**Author: Rafael Tavares**

Interactive simulator of railway traction converters for all common European supply systems and
on-board energy sources. The complete converter is modelled module by module — line converter,
harmonic filter, DC link, VLU, energy storage converter, auxiliary converters and motor converter —
and the train runs with realistic start-up sequences, protections and driving dynamics.

## Running it

**Single file (nothing to install):** open `dist/traction_simulator.html` in any browser
(Chrome, Edge, Firefox, Safari). It works offline and can be shared as one file.

**Local server:** `python app.py` (Python 3.8+, no packages needed) opens `http://127.0.0.1:8050`.

After changing the code, rebuild the single file with `python build_standalone.py`
and run the tests with `node --test tests/engine.test.cjs`.

## Systems

| System | Supply (EN 50163) | Converter chain |
|---|---|---|
| DC overhead line | 600 V, 750 V, 1.5 kV, 3 kV | Pantograph → HSCB → line filter (HF) → pre-charge / CtL → DC link → MC, VLU, HBU, HWR |
| Third rail DC | 600 V, 750 V | Collector shoes → HSCB → line filter → pre-charge / CtL → DC link → … |
| AC overhead line | 15 kV 16.7 Hz, 25 kV 50 Hz | Pantograph → VCB → transformer → pre-charge / CtL → line converter (4QC) → DC link with 2f harmonic filter → … |
| Diesel-electric | — | Diesel engine → generator → line converter (active rectifier) → DC link → … (rheostatic braking in the VLU) |
| Battery (ESS) | — | Battery → pre-charge / main contactor → ESC (grid-forming DC/DC) → DC link → … |
| Hydrogen fuel cell + ESS | — | Battery + ESC (grid-forming) and PEM fuel cells + FC converter with energy management |
| Auxiliary converter only | all EN 50163 supplies | Line chain (+ 4QC on AC) → DC link → HBU, HWR |

Energy storage (ESC + LTO battery) can be added to the overhead-line, third-rail and diesel systems:
it stores braking energy, shaves traction peaks and keeps the train running when the pantograph is lowered.

## Modules

- **LC — line converter**: 4QC on AC (single-phase power pulsation simulated, unity power factor), active rectifier on diesel.
- **HF — harmonic filter**: LC line filter on DC (with active damping of its resonance), 2f series-resonant filter on AC.
- **DC link**: time-domain simulation at 0.25 ms, pre-charge resistor, discharge resistor.
- **VLU**: brake chopper with hysteresis, resistor thermal model and derating.
- **ESC / FC converter**: bidirectional DC/DC with battery OCV and internal resistance, PEM polarization curve, H₂ consumption.
- **HBU**: 3AC 400 V 50 Hz train bus (HVAC depends on ambient temperature, lighting, battery charger, air compressor cycling).
- **HWR**: variable-frequency cooling fans driven by converter and motor temperatures.
- **MC — motor converter**: 2-level or 3-level NPC, SVPWM asynchronous → synchronous (21, 15, 9, 3 pulses — multiples of 3 for three-phase symmetry, amplitude-compensated) → block (six-step),
  induction motors solved with the T-equivalent circuit (slip, current, power factor, efficiency, breakdown torque).

## Physics and data sources

- Supply voltage limits from **EN 50163** (Umin2, Umin1, Un, Umax1, Umax2).
- DC lines: substation spacing, line resistance, receptivity for regenerated energy, line current limitation (power ∝ voltage).
- Train: Davis running resistance, gradient, Curtius–Kniffler adhesion (dry / wet / contaminated rail), blended braking.
- Protections: breaker overcurrent (fast, inside the 0.25 ms step), DC link over/undervoltage, IGBT and motor thermal derating.

Vehicle, motor and converter ratings are **typical engineering values**, not data from a specific product.
They are defined in `static/js/engine.js` (`VEHICLES` and `makeDesign`).

## Structure

```
static/js/engine.js    simulation engine (systems, modules, motor, PWM, train dynamics)
static/js/schematic.js modular single-line diagram
static/js/scene.js     animated train view
static/js/app.js       user interface
static/js/data.js      "System data" tab (modules, EN 50163, effort curves, energy meters)
app.py                 local web server (standard library only)
build_standalone.py    builds dist/traction_simulator.html
tests/                 engine regression tests (Node.js)
```

---
© Rafael Tavares
