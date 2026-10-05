FROM node:22-slim AS build
WORKDIR /app
COPY client/package*.json client/
RUN npm ci --prefix client
COPY server/package*.json server/
RUN npm ci --prefix server
COPY client client
COPY server server
RUN npm run build --prefix client && npm run build --prefix server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json server/
RUN npm ci --prefix server --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
CMD ["node", "server/dist/index.js"]
