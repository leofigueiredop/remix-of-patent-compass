# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist

# Install ffmpeg for audio processing (required by fluent-ffmpeg)
RUN apk add --no-cache ffmpeg

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
