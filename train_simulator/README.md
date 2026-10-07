# Simulador de Conversor de Tração (Python + navegador)

Versão em Python do `simulator.xlsm`: o cálculo roda em Python (Flask + numpy) e a
interface abre no navegador, com esquema elétrico animado, trem em movimento e gráficos ao vivo.

## Como rodar

```bash
cd train_simulator
pip install -r requirements.txt
python app.py              # abre http://127.0.0.1:8050
```

Opções: `--port 8080`, `--no-browser`. Funciona offline (o uPlot fica em `static/vendor`).

## O que tem

**Aba Simulador**
- **START** (modo automático) executa a mesma sequência da macro `CommandButton1_Click`:
  pantógrafo sobe → MCB fecha → ChCt fecha e o DC link carrega via Rpre (curva RC da aba *Pre-charge*)
  → ao atingir 95 % o CtL fecha e o ChCt abre → estabilização (no AC o 4QC regula em 3000 V)
  → inversor habilita e magnetiza → tração até a velocidade alvo.
- **STOP** freia (regenerativo + mecânico de complemento), desliga o inversor, abre CtL, MCB e baixa o pantógrafo.
- **EMERGÊNCIA** abre tudo e aplica freio mecânico máximo. **RESET** limpa falhas (com o trem parado).
- **Modo manual**: clique no pantógrafo, MCB, CtL, ChCt, 4QC e inversor no esquema. Há proteções:
  fechar o CtL sem pré-carga gera inrush e desarma o MCB; inversor não habilita com DC link < 60 %;
  subtensão bloqueia o inversor; a VLU (chopper) grampeia sobretensão na regeneração.
  Controle por manipulador (tração/freio, setas ↑/↓) ou por **frequência + amplitude** (como as barras do Excel),
  com V/f automático ou amplitude livre (fluxo fraco = menos torque).
- **Topologias**: catenária 3 kV DC (filtro L) ou 25 kV 50 Hz AC (trafo + 4QC, ripple de 100 Hz);
  inversor 2 níveis ou 3 níveis NPC; modulação "Excel" (fórmulas da planilha) ou "clássica".
- Gráficos: DC link (tensão/corrente), PWM fase U (referência × portadora), tensão de linha U–V e correntes
  trifásicas, espectro harmônico com THD, dinâmica do trem e zoom de 40 ms do ripple do DC link.

**Aba Laboratório Excel** — reprodução direta das abas ocultas *PWM Level2/3*, *Pre-charge* e
*Ripple SImulator*, com os mesmos limites das barras de rolagem.

## Fidelidade ao Excel

`sim/excel_models.py` traduz as fórmulas coluna a coluna. Os testes comparam com os valores salvos na planilha:

```bash
pip install pytest openpyxl
SIMULATOR_XLSM=/caminho/simulator.xlsm pytest tests
```

Observações sobre a planilha:
- O "PWM Level 2" do Excel compara |ref| com uma portadora 0…1500 e gera 0/±1500 — na prática é PWM
  **unipolar** (3 níveis de tensão de polo). O modo "clássica" mostra o 2 níveis bipolar real (±Vdc/2) e o
  3 níveis NPC com portadoras em disposição de fase.
- O "Ripple SImulator" usa `|sin(2π·100·t)|`, que tem período de 5 ms (ripple de 200 Hz). No simulador ao vivo
  usei a rede de 50 Hz → ripple de 100 Hz, que é o caso físico de uma ponte monofásica.
- Com C = 1 mF (valor da aba *Pre-charge*) o ripple de 2ª harmônica do 4QC fica grande em potência plena;
  trens reais usam C maior e filtro ressonante de 2f.

## Estrutura

```
app.py                 servidor Flask + API (/api/state, /api/command, /api/lab/*)
sim/excel_models.py    port fiel das fórmulas do Excel
sim/engine.py          máquina de estados, DC link, inversor, motor e dinâmica do trem
static/                interface (SVG + uPlot)
tests/                 validação contra os valores do Excel
```
