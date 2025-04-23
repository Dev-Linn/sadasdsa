const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const storageService = require('./services/storage');
const startBot = require('./services/whatsappBot');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configuração do Express
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

console.log('Iniciando servidor WhatsApp...');
console.log(`Porta: ${port}`);

// Configuração do Puppeteer
const puppeteerConfig = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
    ]
};

// Verifica se está em ambiente de produção (Railway)
if (process.env.NODE_ENV === 'production') {
    puppeteerConfig.executablePath = '/snap/bin/chromium';
}

// Inicialização do cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig
});

// Eventos do WhatsApp
client.on('qr', (qr) => {
    console.log('QR Code gerado. Por favor, escaneie com o WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Cliente WhatsApp conectado e pronto!');
});

client.on('auth_failure', msg => {
    console.error('Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
});

// Inicialização do servidor
client.initialize().then(() => {
    app.listen(port, () => {
        console.log(`Servidor rodando em http://localhost:${port}`);
    });
}).catch(err => {
    console.error('Erro na inicialização:', err);
});

// Rota para verificar status do WhatsApp
app.get('/api/whatsapp-status', (req, res) => {
    res.json({
        isReady: client.info ? true : false,
        qr: client.info ? client.info.qr : null
    });
});

// Rotas da API
app.get('/api/leads', (req, res) => {
    try {
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        res.json(leads);
    } catch (error) {
        console.error('❌ Erro ao ler leads:', error);
        res.status(500).json({ error: 'Erro ao ler leads' });
    }
});

app.get('/api/metrics', async (req, res) => {
    const leads = await storageService.getAllLeads();
    const metrics = calculateMetrics(leads);
    res.json(metrics);
});

// Rota para obter estatísticas dos produtos
app.get('/api/products/stats', (req, res) => {
    try {
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        
        // Carrega produtos do arquivo de configuração
        const productsConfig = JSON.parse(fs.readFileSync('config/products.json', 'utf8'));
        const products = productsConfig.products;

        // Calcula o total de menções para normalização
        let totalMentions = 0;
        const productMentions = {};

        // Primeiro, calcula o total de menções
        Object.values(leads).forEach(lead => {
            if (lead.messages) {
                lead.messages.forEach(message => {
                    const messageLower = message.toLowerCase();
                    
                    // Verifica cada produto
                    products.forEach(product => {
                        // Verifica o nome do produto
                        const productName = product.name.toLowerCase();
                        if (messageLower.includes(productName)) {
                            productMentions[product.name] = (productMentions[product.name] || 0) + 1;
                            totalMentions++;
                            return;
                        }
                        
                        // Verifica as variações
                        const hasMention = product.variations.some(variation => 
                            messageLower.includes(variation.toLowerCase())
                        );
                        
                        if (hasMention) {
                            productMentions[product.name] = (productMentions[product.name] || 0) + 1;
                            totalMentions++;
                        }
                    });
                });
            }
        });

        // Calcula estatísticas para cada produto
        const stats = products.map(product => {
            const mentions = productMentions[product.name] || 0;
            let lastMention = null;
            
            // Encontra a última menção
            Object.values(leads).forEach(lead => {
                if (lead.messages) {
                    lead.messages.forEach(message => {
                        const messageLower = message.toLowerCase();
                        const productName = product.name.toLowerCase();
                        
                        // Verifica o nome do produto
                        if (messageLower.includes(productName)) {
                            const messageTime = new Date(lead.timestamp).getTime();
                            if (!lastMention || messageTime > lastMention) {
                                lastMention = messageTime;
                            }
                            return;
                        }
                        
                        // Verifica as variações
                        const hasMention = product.variations.some(variation => 
                            messageLower.includes(variation.toLowerCase())
                        );
                        
                        if (hasMention) {
                            const messageTime = new Date(lead.timestamp).getTime();
                            if (!lastMention || messageTime > lastMention) {
                                lastMention = messageTime;
                            }
                        }
                    });
                }
            });

            // Calcula a tendência baseada no número absoluto de menções
            let trend;
            if (mentions >= 5) {
                trend = 100; // Alta
            } else if (mentions >= 3) {
                trend = 75; // Média-Alta
            } else if (mentions >= 1) {
                trend = 50; // Média
            } else {
                trend = 0; // Sem menções
            }

            return {
                name: product.name,
                stats: {
                    mentions,
                    lastMention: lastMention ? new Date(lastMention).toISOString() : null,
                    trend
                }
            };
        });

        // Ordena os produtos por número de menções (decrescente)
        stats.sort((a, b) => b.stats.mentions - a.stats.mentions);

        res.json(stats);
    } catch (error) {
        console.error('❌ Erro ao calcular estatísticas:', error);
        res.json([]);
    }
});

// Rota principal
app.get('/', (req, res) => {
    if (!client.info) {
        res.redirect('/login');
    } else {
        res.render('index');
    }
});

// Rota de login
app.get('/login', (req, res) => {
    if (client.info) {
        res.redirect('/');
    } else {
        res.render('login');
    }
});

// Evento de mensagem recebida
client.on('message', async msg => {
    const contact = await msg.getContact();
    const senderName = contact.name || contact.number;
    
    console.log('\n📱 MENSAGEM RECEBIDA');
    console.log(`👤 De: ${senderName} (${contact.number})`);
    console.log(`💬 Mensagem: ${msg.body}`);
    console.log(`⏰ Data/Hora: ${new Date().toLocaleString()}`);
    console.log('====================\n');

    // Atualiza as tags automaticamente
    await updateContactTags(contact);
});

// Evento de contato atualizado
client.on('contact_changed', async (message) => {
    try {
        const contact = await message.getContact();
        console.log('👤 Contato atualizado:', contact.number);
        await updateContactTags(contact);
    } catch (error) {
        console.error('❌ Erro ao processar contato atualizado:', error);
    }
});

// Evento de grupo atualizado
client.on('group_update', async (notification) => {
    try {
        const group = notification.chatId;
        const participants = await client.getGroupParticipants(group);
        
        for (const participant of participants) {
            const contact = await client.getContactById(participant);
            if (contact) {
                await updateContactTags(contact);
            }
        }
    } catch (error) {
        console.error('❌ Erro ao processar atualização de grupo:', error);
    }
});

// Função auxiliar para atualizar tags de um contato
async function updateContactTags(contact) {
    try {
        const number = contact.number.replace('@c.us', '');
        console.log('\n🔄 INÍCIO DA ATUALIZAÇÃO DE TAGS');
        console.log('📱 Número do contato:', number);
        console.log('👤 Dados do contato:', {
            id: contact.id._serialized,
            name: contact.name,
            pushname: contact.pushname,
            isWAContact: contact.isWAContact
        });
        
        // Obtém as tags do contato
        console.log('🔍 Chamando getContactTags...');
        const tags = await getContactTags(contact);
        console.log('📊 Tags obtidas:', tags);
        
        // Lê o arquivo de leads
        console.log('📂 Lendo arquivo leads.json...');
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        console.log('✅ Arquivo leads.json lido com sucesso');

        // Atualiza as tags do lead
        if (leads[number]) {
            console.log('👥 Lead encontrado, atualizando tags...');
            // Mantém as tags existentes e adiciona as novas
            const existingTags = leads[number].tags || [];
            console.log('🏷️ Tags existentes:', existingTags);
            
            const updatedTags = [...new Set([...existingTags, ...tags])];
            console.log('📊 Tags atualizadas:', updatedTags);
            
            leads[number].tags = updatedTags;
            console.log('💾 Salvando alterações no arquivo...');
            fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
            console.log('✅ Tags atualizadas com sucesso');
        } else {
            console.log('⚠️ Lead não encontrado, criando novo...');
            // Se o lead não existe, cria um novo
            leads[number] = {
                name: contact.name || contact.number,
                number: number,
                timestamp: new Date().toISOString(),
                tags: tags,
                formStatus: 'pendente',
                formData: {}
            };
            console.log('💾 Salvando novo lead...');
            fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
            console.log('✅ Novo lead criado com sucesso');
        }
        console.log('✅ FIM DA ATUALIZAÇÃO DE TAGS\n');
    } catch (error) {
        console.error('❌ ERRO ao atualizar tags:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Função auxiliar para obter tags do contato
async function getContactTags(contact) {
    try {
        console.log('🔍 INÍCIO DA OBTENÇÃO DE TAGS');
        console.log('📱 Contato:', {
            id: contact.id._serialized,
            number: contact.number,
            name: contact.name,
            pushname: contact.pushname,
            isMe: contact.isMe,
            isGroup: contact.isGroup,
            isWAContact: contact.isWAContact,
            isMyContact: contact.isMyContact
        });

        const tags = [];
        
        // Método 1: Labels do WhatsApp Business
        try {
            console.log('🔄 Tentando obter labels do WhatsApp Business...');
            const allLabels = await client.getLabels();
            console.log('📊 Todos os labels do WhatsApp:', allLabels);
            
            if (contact.labels && Array.isArray(contact.labels)) {
                console.log('✅ Array de labels do contato válido:', contact.labels);
                for (const labelId of contact.labels) {
                    const label = allLabels.find(l => l.id === labelId);
                    console.log(`🏷️ Label: ${label ? label.name : 'Não encontrado'}`);
                    tags.push(label ? label.name : 'Não encontrado');
                }
            }
        } catch (error) {
            console.error('❌ Erro ao obter labels do WhatsApp Business:', error);
        }

        return tags;
    } catch (error) {
        console.error('❌ ERRO ao obter tags:', error);
        return [];
    }
}