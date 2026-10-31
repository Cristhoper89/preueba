FROM nginx:alpine

COPY control-marketing/nginx.conf /etc/nginx/conf.d/default.conf
COPY control-marketing/index.html control-marketing/app.js control-marketing/styles.css /usr/share/nginx/html/

EXPOSE 80
