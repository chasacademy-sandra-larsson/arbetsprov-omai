# API-containern för molndeploy. Kör tsx direkt (som lokalt) — enkelheten
# väger tyngre än en byggd dist för det här projektet.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "src/api/server.ts"]
