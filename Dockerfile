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

# Instala as dependências do Node.js incluindo o Puppeteer
RUN PUPPETEER_SKIP_DOWNLOAD=false npm install puppeteer@22.8.2

# Configura variáveis de ambiente para o Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Expõe a porta 8080
EXPOSE 8080

# Define o comando de inicialização com flags adicionais para o Node
CMD ["node", "--max-old-space-size=512", "--trace-warnings", "index.js"] 