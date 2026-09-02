# ═══════════════════════════════════════════════════════════════
#  Stage 1 — Build React frontend
# ═══════════════════════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# Install ALL deps (needs devDependencies for vite/typescript)
COPY package*.json ./
RUN npm ci

# Copy full source and build
COPY . .
RUN npm run build

# ═══════════════════════════════════════════════════════════════
#  Stage 2 — Production runtime (Node + built frontend)
# ═══════════════════════════════════════════════════════════════
FROM node:20-alpine AS runner

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server source
COPY src/server/ ./src/server/

# Copy built frontend from Stage 1
COPY --from=builder /app/dist ./dist

# Writable uploads folder
RUN mkdir -p /app/uploads

EXPOSE 3002

ENV NODE_ENV=production

HEALTHCHECK --interval=20s --timeout=5s --start-period=45s --retries=5 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "src/server/index.js"]
