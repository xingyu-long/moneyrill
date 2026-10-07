# Build stage: all dependencies, type-check and build the UI.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: production dependencies, the server sources and the built UI, running as the unprivileged "node" user.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY tsconfig.json ./
COPY server ./server
ARG COMMIT_SHA=dev
ARG BUILT_AT=
ENV COMMIT_SHA=$COMMIT_SHA BUILT_AT=$BUILT_AT
USER node
EXPOSE 3002
CMD ["npm","start"]
