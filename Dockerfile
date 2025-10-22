# Use official Node LTS image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

# Expose server port
EXPOSE 3000

# Run server
CMD ["npm", "start"]

