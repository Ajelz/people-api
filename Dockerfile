FROM node:22.18.0-alpine
WORKDIR /app
RUN apk add --no-cache postgresql-client
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
