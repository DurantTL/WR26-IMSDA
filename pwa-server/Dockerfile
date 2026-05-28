FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3001

# Run as non-root for least-privilege container security.
RUN addgroup -S imsda && adduser -S -G imsda imsda && chown -R imsda:imsda /app
USER imsda

CMD ["node", "server.js"]
