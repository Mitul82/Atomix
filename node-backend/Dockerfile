FROM node:24.14.1-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

FROM node:24.14.1-alpine AS runner

WORKDIR /app

COPY --chown=node:node --from=builder /app/package*.json ./

COPY --chown=node:node --from=builder /app/dist ./dist

RUN npm ci --omit-dev --legacy-peer-deps && npm install pm2 -g

RUN npm cache clean --force

USER node

EXPOSE 3000

CMD ["pm2-runtime", "dist/app.js", "-i", "max", "--node-args", "--max-old-space-size=1024"]