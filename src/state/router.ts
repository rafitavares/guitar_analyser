// Roteador simples baseado em hash, suficiente para um SPA single-file
// sem dependências externas.

export type RouteHandler = (params: URLSearchParams) => void;

const routes = new Map<string, RouteHandler>();
let notFoundHandler: RouteHandler = () => {
  document.querySelector("#app")!.innerHTML = "<div class='screen'><h1>Página não encontrada</h1></div>";
};

export function registerRoute(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function setNotFoundHandler(handler: RouteHandler): void {
  notFoundHandler = handler;
}

export function navigate(path: string): void {
  if (location.hash === `#${path}`) {
    render();
  } else {
    location.hash = path;
  }
}

function parseHash(): { path: string; params: URLSearchParams } {
  const raw = location.hash.slice(1) || "/";
  const [path, query] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(query || "") };
}

function render(): void {
  const { path, params } = parseHash();
  const handler = routes.get(path);
  window.scrollTo(0, 0);
  if (handler) {
    handler(params);
  } else {
    notFoundHandler(params);
  }
}

export function startRouter(): void {
  window.addEventListener("hashchange", render);
  render();
}
