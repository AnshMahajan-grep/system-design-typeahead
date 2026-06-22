# Backend image: small Node 22 Alpine base.
FROM node:22-alpine

WORKDIR /app

# Install deps first so Docker can cache this layer when only source changes.
COPY package.json ./
RUN npm install --omit=dev

# Copy the rest of the source.
COPY . .

EXPOSE 8080

# On boot we (1) create tables, (2) seed the dataset if the table is empty,
# then (3) start the API. `seed.js` is idempotent — it skips seeding if data
# already exists, so restarts are fast.
CMD ["sh", "-c", "node scripts/seed.js && node src/index.js"]
