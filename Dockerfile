FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies using npm to avoid pnpm strict build constraints in Docker
COPY package.json ./
RUN npm install

# Copy source
COPY . .

# Build TS
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 9002

CMD ["npm", "start"]
