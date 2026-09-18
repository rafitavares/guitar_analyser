import { defineConfig } from "vite";

// Publicado em GitHub Pages como projeto (não pages de usuário/organização),
// então os assets precisam do prefixo do nome do repositório.
export default defineConfig({
  base: "/guitar_analyser/",
});
