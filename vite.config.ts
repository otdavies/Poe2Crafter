import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH is set by CI for GitHub Pages project sites (/<repo>/)
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
});
