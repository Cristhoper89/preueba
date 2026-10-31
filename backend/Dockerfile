FROM node:20-alpine

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/customer-auth.js backend/marketing.js backend/request-origin.js backend/schema.sql backend/server.js ./
COPY backend/scripts ./scripts

ENV NODE_ENV=production
ENV SERVE_FRONTEND=false
ENV CORS_ALLOWED_ORIGINS="http://oowwgfyjnl5pnzscgekwkjdy.2.24.87.5.sslip.io,http://z3gy63fnzwpdzjx5aazxg7zm.2.24.87.5.sslip.io"
EXPOSE 3000

CMD ["npm", "start"]
