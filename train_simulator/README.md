# Traction Converter Simulator

**Author: Rafael Tavares**

Railway traction converter simulator based on the `simulator.xlsm` spreadsheet. It reproduces the
start-up sequence (pantograph, MCB, DC link pre-charge, line contactor, inverter) and runs the train
with animated diagrams and live charts, using the same PWM, pre-charge and ripple formulas as the Excel file.

## Single-file version (nothing to install)

`dist/traction_simulator.html` is one file (~150 KB) that opens with a double click in any browser
(Chrome, Edge, Firefox, Safari), works offline and can be shared by e-mail, Teams or WhatsApp.
In this version the engine runs in JavaScript (`static/js/engine.js`), a port of `sim/engine.py` that
`tests/test_js_port.py` validates against the Python engine (same states, events, waveforms and spectrum).

To rebuild after changing the code: `python build_standalone.py`.

## Python version

```bash
cd train_simulator
pip install -r requirements.txt
python app.py              # opens http://127.0.0.1:8050
```

Options: `--port 8080`, `--no-browser`. Works offline (uPlot is bundled in `static/vendor`).

## Features

**Simulator tab**
- **START** (automatic mode) runs the same sequence as the Excel `CommandButton1_Click` macro:
  pantograph raises → MCB closes → ChCt closes and the DC link charges through Rpre (RC curve from the
  *Pre-charge* sheet) → at 95 % the CtL closes and the ChCt opens → stabilization (in AC the 4QC regulates
  3000 V) → inverter enables and magnetizes → traction up to the target speed.
- **STOP** brakes (regenerative + mechanical blending), disables the inverter, opens CtL and MCB and lowers the pantograph.
- **EMERGENCY** opens everything and applies full mechanical braking. **RESET** clears faults (train at standstill).
- **Manual mode**: click the pantograph, MCB, CtL, ChCt, 4QC and inverter on the diagram. Protections:
  closing CtL without pre-charge causes inrush and trips the MCB; the inverter will not enable with the DC
  link below 60 %; undervoltage blocks the inverter; the VLU (brake chopper) clamps overvoltage during regeneration.
  Drive with the master controller (traction/brake, ↑/↓ keys) or with **frequency + amplitude** (like the Excel
  scroll bars), with automatic V/f or free amplitude (weak flux = less torque).
- **Topologies**: 3 kV DC catenary (line filter L) or 25 kV 50 Hz AC (transformer + 4QC, 100 Hz ripple);
  2-level or 3-level NPC inverter; "Excel" modulation (spreadsheet formulas) or "classic".
- Charts: DC link voltage/current, phase U PWM (reference × carrier), line voltage U–V and three-phase currents,
  harmonic spectrum with THD, train dynamics and a 40 ms zoom of the DC link ripple.

**Excel Lab tab** — direct reproduction of the hidden *PWM Level2/3*, *Pre-charge* and *Ripple SImulator*
sheets, with the same limits as the spreadsheet scroll bars.

## Fidelity to the Excel file

`sim/excel_models.py` translates the formulas column by column. The tests compare against the values saved in the spreadsheet:

```bash
pip install pytest openpyxl
SIMULATOR_XLSM=/path/simulator.xlsm pytest tests
```

Notes on the spreadsheet:
- The Excel "PWM Level 2" compares |ref| with a 0…1500 carrier and outputs 0/±1500 — in practice this is
  **unipolar** PWM (3 pole-voltage levels). The "classic" mode shows true bipolar 2-level PWM (±Vdc/2) and
  3-level NPC with phase-disposition carriers.
- The "Ripple SImulator" uses `|sin(2π·100·t)|`, which has a 5 ms period (200 Hz ripple). The live simulator
  uses a 50 Hz grid → 100 Hz ripple, which is the physical case of a single-phase bridge.
- With C = 1 mF (value from the *Pre-charge* sheet) the 4QC second-harmonic ripple is large at full power;
  real trains use a larger capacitance and a 2f resonant filter.

The train and motor data (200 t, 120 kN, 1.2 MW, gear ratio) are typical values, not from the Excel file;
they live in `Config` in `sim/engine.py` (and `newConfig` in `static/js/engine.js`).

## Structure

```
app.py                 Flask server + API (/api/state, /api/command, /api/lab/*)
sim/excel_models.py    faithful port of the Excel formulas
sim/engine.py          state machine, DC link, inverter, motor and train dynamics
static/                user interface (SVG + uPlot)
static/js/engine.js    JS port of the engine (single-file version)
build_standalone.py    builds dist/traction_simulator.html
tests/                 validation against Excel and JS × Python
```

---
© Rafael Tavares
