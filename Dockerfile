FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

CMD ["npm", "start"]
