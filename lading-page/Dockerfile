FROM nginx:alpine

RUN apk add --no-cache ca-certificates

COPY lading-page/nginx.conf /etc/nginx/conf.d/default.conf
COPY lading-page/public/ /usr/share/nginx/html/

EXPOSE 80
