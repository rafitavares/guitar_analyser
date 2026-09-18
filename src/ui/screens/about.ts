import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";

export function renderAbout(): void {
  const app = setApp(`
    ${renderHeader("Sobre", "/")}
    <div class="screen">
      <div class="card">
        <h2>O que este app faz</h2>
        <p>Este app compara o mesmo instrumento consigo mesmo ao longo do tempo, usando o microfone do celular e um protocolo de captura consistente (distância, sala, força de toque).</p>
      </div>

      <div class="card">
        <h2>O que ele NÃO faz</h2>
        <p>Não mede volume absoluto (dB SPL) nem substitui análise de laboratório com equipamento calibrado. Todos os valores de amplitude/energia são <strong>relativos</strong> à própria gravação, não uma medida física absoluta.</p>
        <p>Abaixo de ~80Hz o microfone de celular perde precisão — leve isso em conta ao interpretar cordas graves.</p>
        <p>Os dados de madeira e geometria do instrumento são rótulos para seu próprio catálogo/comparação — o app não deriva nem prevê som a partir da espécie da madeira.</p>
      </div>

      <div class="card">
        <h2>Por que a comparação pode "não bater"</h2>
        <p>Se a distância do microfone, a sala, o calibre das cordas ou a força de toque mudarem entre duas sessões, os números vão variar por causa disso — não necessariamente porque o violão mudou. Siga sempre o checklist de protocolo antes de medir.</p>
      </div>

      <div class="card">
        <h2>Privacidade</h2>
        <p>Tudo roda localmente no seu navegador. Nenhum áudio ou dado é enviado a servidores externos. As sessões ficam salvas no armazenamento local do dispositivo (IndexedDB).</p>
      </div>
    </div>
  `);
  attachHeaderEvents(app);
}
