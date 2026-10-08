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
and run the tests with `node --test tests/*.test.cjs` (`DT=0.1` repeats the Trip Lab tests at 5× time scale).

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

**Optional modules** — HF (harmonic filter), VLU, HBU, HWR and ESC can be switched on or off in the side panel to build
the exact converter you need (LC and MC are fitted whenever the system requires them). Removing a module has its
physical consequence: without VLU the braking energy the supply cannot take goes to the mechanical brake, without HWR
the converter and motors rely on natural convection and derate earlier, without the 2f filter the DC link ripple on AC
rises about tenfold, without the line filter the DC line sees the converter switching directly.

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

## Protection and Trip Lab

Every detected fault is assigned a **trip class**, and the class decides the reaction:

| Class | Typical condition | Reaction |
|---|---|---|
| Trip_SYS_0 | DC-link short circuit | everything opened at once, collector lowered, DC link fast-discharged |
| Trip_SYS_1 | welded contactor, risk of opening under load | pulses blocked, breaker and ESS contactors opened, collector lowered |
| Trip_SYS_2 | overcurrent, IGBT, earth fault, line fault | pulses blocked, breaker / line contactor opened, ESS disconnected |
| Trip_SYS_3 | DC-link undervoltage | pulses blocked, automatic restart (3 in 2 min → Trip_SYS_2) |
| OFF_SYS_1 / OFF_SYS_2 / OFF_FU | controlled disconnection without urgency | normal shutdown sequence without load (system, power circuit or one unit) |
| Trip_ESS / Trip_AUX / Trip_MC / Trip_LC (GC) | fault confined to one converter | only that converter is blocked; RESET restarts it |
| Warning | limit exceeded | indication only |

The **Trip Lab** tab injects 22 faults — ESS connection box (CtPos / CtNeg / CtCh do not close / open / move unexpectedly,
welded contactor, precharge timeout, voltage does not rise, tripline, BMS), converters (overcurrent, IGBT desaturation,
earth fault, DC-link over/undervoltage and short circuit, MC and LC/GC faults) and auxiliaries (overload, overtemperature, fan).
Each fault can be triggered immediately, after a delay, during traction or braking or in an ESS state; analog faults can be a step,
a slow ramp (warning first) or short bursts that are filtered and counted. The class of every fault can be changed.
Faults are detected physically: contactors have command, auxiliary feedback and real main contacts, the ESS pre-charge and the
DC link are simulated, and the trip recorder freezes 4 s before and 2 s after each trip.
The ESS contactor scenarios follow common practice in ESS protection concepts; the class names and reactions are a generic model, not a specific product.

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
