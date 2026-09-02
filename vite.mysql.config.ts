import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [
    react(), 
    // Add Node.js polyfills for browser environment
    nodePolyfills({
      // Whether to polyfill specific Node.js globals and modules
      globals: {
        Buffer: true, // Polyfill for the Buffer class
        global: true,
        process: true,
      },
      // Whether to polyfill Node.js builtins
      protocolImports: true,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Define environment variables
  define: {
    "process.env.USE_MYSQL": JSON.stringify("true"),
  },
  optimizeDeps: {
    // Exclude all Node.js-specific modules that shouldn't run in browser
    exclude: ['sequelize', 'pg-hstore', 'wkx', 'fs', 'path', 'util', 'mysql2'],
  },
  // Completely exclude Sequelize and related packages from frontend bundle
  ssr: {
    external: ['sequelize', 'mysql2', 'pg-hstore', 'wkx'],
  },
  // Build configuration with proper Node.js module handling
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
      // External modules that should not be bundled
      external: ['sequelize', 'mysql2', 'pg-hstore', 'wkx'],
    },
  },
}));
