# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma

# Install ffmpeg for audio, curl + iconv for INPI scraping
RUN apk add --no-cache ffmpeg curl gnu-libiconv
ENV LD_PRELOAD=/usr/lib/preloadable_libiconv.so

ENV PORT=3000
EXPOSE 3000

CMD npx prisma db push --accept-data-loss && node dist/server.js
