# WhatsApp Leads Tracker

Sistema de captura e visualização de leads do WhatsApp, desenvolvido em Node.js com WhatsApp-Web.js e Express.

## Funcionalidades

- Captura automática de leads a partir de mensagens recebidas no WhatsApp
- Armazenamento local dos dados em formato JSON
- Interface web com visualização de leads e métricas
- Gráficos de evolução diária e distribuição por hora
- Filtros por DDD e intervalo de datas

## Requisitos

- Node.js 14.x ou superior
- NPM ou Yarn
- Navegador moderno (Chrome, Firefox, Edge)

## Instalação

1. Clone o repositório:
```bash
git clone [url-do-repositorio]
cd whatsapp-leads-tracker
```

2. Instale as dependências:
```bash
npm install
```

3. Inicie o servidor:
```bash
npm start
```

4. Acesse a interface web em `http://localhost:3000`

## Primeiro Uso

Na primeira execução, será necessário escanear o QR Code do WhatsApp Web que aparecerá no terminal. Após isso, a sessão será mantida automaticamente.

## Estrutura do Projeto

- `index.js` - Arquivo principal que inicializa o servidor e o bot
- `services/storage.js` - Serviço de armazenamento de leads
- `services/whatsappBot.js` - Lógica do bot do WhatsApp
- `views/index.ejs` - Interface do usuário
- `leads.json` - Arquivo de armazenamento dos leads (criado automaticamente)

## Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou enviar pull requests.

## Licença

Este projeto está licenciado sob a licença MIT. 