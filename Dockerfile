# multi-stage: better-sqlite3 가 native 빌드를 요구하므로 build stage 분리
FROM node:24-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p data && chown -R node:node /app
USER node
CMD ["node", "src/index.js"]
