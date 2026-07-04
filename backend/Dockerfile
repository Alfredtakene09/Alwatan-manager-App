FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl netcat-openbsd

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY tsconfig.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY src ./src

RUN npx prisma generate

EXPOSE 4000

ENTRYPOINT ["docker-entrypoint.sh"]
