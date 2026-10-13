import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "sandbox",
  plugins: [react()],
  server: { port: 3000, strictPort: true },
});
