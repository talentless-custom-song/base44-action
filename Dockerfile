# Development image for BuildHub.
# Application source is bind-mounted at /app by docker-compose.base44.yml, so
# nothing here bakes application code into the image.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Vite dev server (5173 -> published on 3000) and the build API.
EXPOSE 3000 5173 8000

CMD ["node", "--version"]
