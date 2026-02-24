# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

# Stage 2: Runtime
FROM node:22-slim

# Install Chromium and dependencies for Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install-deps chromium 2>/dev/null || true

COPY --from=builder /app/dist dist/
COPY config.example.yaml ./

# Set Playwright to use system Chromium
ENV BROWSER_BACKEND=playwright
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV BROWSER_HEADLESS=true

# Default: run the daemon
ENTRYPOINT ["node", "dist/index.js"]
CMD ["daemon"]
