FROM node:20-alpine

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/customer-auth.js backend/marketing.js backend/schema.sql backend/server.js ./
COPY backend/scripts ./scripts
COPY control-marketing /app/control-marketing
COPY lading-page/public /app/lading-page/public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
