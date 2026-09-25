import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";

export function renderAbout(): void {
  const app = setApp(`
    ${renderHeader("Sobre", "/")}
    <div class="screen">
      <div class="card">
        <h2>O que este app faz</h2>
        <p>3 ferramentas independentes de medição acústica do violão, usando só o microfone do celular: Sustentação (tempo de decaimento do som), Volume (nível por canal do microfone) e Harmônicos (espectro da nota com pico fixo).</p>
      </div>

      <div class="card">
        <h2>O que ele NÃO faz</h2>
        <p>Não mede volume absoluto em dB SPL calibrado, nem substitui análise de laboratório — os valores de dB são relativos ao ruído ambiente medido antes de cada teste e ao próprio sinal captado, não uma escala física absoluta e comparável entre aparelhos diferentes.</p>
        <p>Abaixo de ~80Hz o microfone de celular perde precisão — leve isso em conta ao medir cordas graves.</p>
      </div>

      <div class="card">
        <h2>Por que os números podem variar entre medições</h2>
        <p>A distância do celular ao violão, a sala e a força do toque afetam diretamente os resultados. Para comparar medições ao longo do tempo, tente manter essas condições parecidas.</p>
      </div>

      <div class="card">
        <h2>Privacidade</h2>
        <p>Tudo roda localmente no seu navegador. Nenhum áudio ou dado é enviado a servidores externos. Os resultados salvos ficam no armazenamento local do dispositivo (IndexedDB).</p>
      </div>
    </div>
  `);
  attachHeaderEvents(app);
}
