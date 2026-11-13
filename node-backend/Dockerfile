FROM node:24.14.1-alpine AS builder

WORKDIR /app

COPY package*.json /

RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

FROM node:24.14.1-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package*.json ./

COPY --from=builder /app/dist ./dist

RUN npm ci --omit-dev --legacy-peer-deps

USER node

EXPOSE 3000

CMD ["node", "dist/app.js"]