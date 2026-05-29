FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Match the server's default port to the exposed/published port so the image
# listens on 3001 even when PORT is not supplied at runtime.
ENV PORT=3001
EXPOSE 3001

# Run as non-root for least-privilege container security.
RUN addgroup -S imsda && adduser -S -G imsda imsda && chown -R imsda:imsda /app
USER imsda

CMD ["node", "server.js"]
