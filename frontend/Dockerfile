# ── Stage 1: Vite build ───────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Vite bakes env vars into the static bundle at build time.
# Pass them via --build-arg in docker-compose or docker build.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ARG VITE_API_PROXY_TARGET

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_PROXY_TARGET=$VITE_API_PROXY_TARGET

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build the Vite app — outputs to /app/dist
RUN npm run build

# ── Stage 2: Nginx serve ──────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

# Copy the built static files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Run as a non-root unprivileged user
# Note: nginx master must run as root to bind port 80, but worker processes
# run as the nginx user by default. We set the worker user explicitly.
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
