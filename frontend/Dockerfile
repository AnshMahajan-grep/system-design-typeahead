# Frontend image: runs the Vite dev server (simple + good enough for the demo;
# it also gives us the /api proxy to the backend for free).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
