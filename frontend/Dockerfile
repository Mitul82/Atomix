FROM node:24.14.1-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --legacy-peer-deps

COPY . .

ARG VITE_EDGE_URL
ENV VITE_EDGE_URL=${VITE_EDGE_URL}

ARG VITE_LEDGER_URL
ENV VITE_LEDGER_URL=${VITE_LEDGER_URL}

RUN npm run build

FROM nginx:alpine AS production

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]