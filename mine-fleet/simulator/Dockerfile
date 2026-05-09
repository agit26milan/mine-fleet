# Pinned major line; bump intentionally when upgrading Node.
FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 9090

CMD ["npm", "run", "dev"]
