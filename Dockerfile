# Base Image with Node.js and system tools
FROM node:18-bullseye

# Install System Dependencies
# - autodock-vina: The docking engine
# - python3: For AI models (ProteinMPNN) if used
# - openbabel: Useful for chemical file conversion
RUN apt-get update && apt-get install -y \
    autodock-vina \
    python3 \
    python3-pip \
    openbabel \
    && rm -rf /var/lib/apt/lists/*

# Create App Directory
WORKDIR /app

# Install Backend Dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install

# Install Frontend Dependencies & Build
COPY frontend/package*.json ../frontend/
WORKDIR /app/frontend
RUN npm install
COPY frontend/ ./
RUN npm run build

# Copy Backend Source
WORKDIR /app/backend
COPY backend/ ./

# Create bin directory for manually added binaries (FoldX)
RUN mkdir -p /app/bin

# Environment Variables
ENV NODE_ENV=production
ENV REFINERY_MODE=SIMULATION

# Expose Ports (Frontend handled by separate server in real prod, but for all-in-one:)
# We might need a small script to serve the frontend build from the backend or just run backend
EXPOSE 3001

# Start Backend (which hosts API + Websocket)
# Note: In a real deploy, you'd serve the frontend static files via Nginx or Express
CMD ["npm", "start"]
