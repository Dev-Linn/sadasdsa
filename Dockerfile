FROM node:18-slim

# Instala as dependências necessárias
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxss1 \
    libgtk-3-0 \
    libxshmfence1 \
    libglu1 \
    && rm -rf /var/lib/apt/lists/*

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos do projeto
COPY . .

# Instala as dependências do Node.js
RUN npm install
RUN PUPPETEER_SKIP_DOWNLOAD=false npm install puppeteer@22.8.2

# Expõe a porta
EXPOSE 8080

# Define o comando de inicialização
CMD ["npm", "start"] 