FROM nginx:alpine

# Copy our server config
COPY conf.d/default.conf /etc/nginx/conf.d/default.conf

# Remove default nginx config that listens on port 80
RUN rm -f /etc/nginx/conf.d/default.conf.bak

# Create directories for certbot and logs
RUN mkdir -p /var/www/certbot /var/log/nginx

EXPOSE 80 443
