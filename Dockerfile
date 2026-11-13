FROM node:22-bookworm-slim

# Install system dependencies: ffmpeg, python3, and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pre-download standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /tmp/yt-dlp_linux \
    && chmod +x /tmp/yt-dlp_linux

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV DEFAULT_APP_PORT=3000

CMD ["npm", "start"]
