import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    global: 'globalThis',
    'process.env': {},
    'process': 'undefined'
  },
  build: {
    target: 'es2015',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      external: [
        'sequelize', 'mysql2', 'pg', 'pg-hstore', 'sqlite3',
        'tedious', 'dotenv', 'bcrypt', 'bcryptjs', 'jsonwebtoken',
        'multer', 'compression', 'helmet', 'express', 'cors',
        'pdfkit', 'express-rate-limit'
      ],
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': [
            '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select', '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip', '@radix-ui/react-popover',
            '@radix-ui/react-scroll-area', 'lucide-react'
          ],
          'vendor-data': [
            '@tanstack/react-query', 'recharts', 'date-fns',
            'react-hook-form', '@hookform/resolvers', 'zod'
          ],
          'vendor-export': ['jspdf', 'jspdf-autotable', 'xlsx'],
        }
      }
    }
  },
  optimizeDeps: {
    exclude: [
      'sequelize', 
      'mysql2', 
      'pg', 
      'sqlite3', 
      'tedious',
      'dotenv'
    ]
  }
}));
