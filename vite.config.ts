import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI lives in ui/ and imports the game straight from src/
export default defineConfig({
  root: "ui",
  plugins: [react()],
});
