# Stage 1: Build
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

# Stage 2: Production
FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

# Install ffmpeg, curl and chromium for INPI scraping
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    chromium \
    chromium-common \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatspi2.0-0 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/bin/chromium /usr/bin/chromium-browser \
    && ln -sf /usr/bin/chromium /usr/bin/google-chrome-stable \
    && ln -sf /usr/bin/chromium /usr/bin/google-chrome
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app /tmp
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV CHROME_BIN=/usr/bin/google-chrome-stable
ENV CHROME_PATH=/usr/bin/google-chrome-stable

ENV PORT=3000
EXPOSE 3000

USER appuser

CMD npx prisma migrate deploy && node dist/server.js
