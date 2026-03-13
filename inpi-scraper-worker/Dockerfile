# Usa a imagem base super leve do Node
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Imagem oficial do Puppeteer com dependências do Chromium já embutidas e otimizadas
FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /app

# Copia do builder os arquivos compilados e os pacotes
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
RUN npm install --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Retorna para o usuário sem privilégios da imagem do Puppeteer por segurança
USER pptruser

EXPOSE 8080
CMD ["node", "dist/index.js"]
