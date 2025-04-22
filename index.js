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

console.log('=== Iniciando configuração do WhatsApp ===');
console.log('Ambiente:', process.env.NODE_ENV || 'desenvolvimento');
console.log('Porta:', port);

// Configuração do diretório de autenticação
const authPath = process.env.NODE_ENV === 'production' 
    ? path.join('/tmp', '.wwebjs_auth')
    : path.join(__dirname, '.wwebjs_auth');

// Garante que o diretório existe
if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
}

// Inicialização do cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
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
        ],
        executablePath: process.env.NODE_ENV === 'production' ? '/usr/bin/chromium-browser' : undefined
    },
    qrMaxRetries: 3,
    authTimeoutMs: 60000,
    qrTimeoutMs: 40000,
    restartOnAuthFail: true,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000,
    markOnlineOnConnect: true,
    syncFullHistory: true,
    fetchGroupMetadata: true,
    fetchGroupParticipants: true,
    fetchGroupAdmins: true,
    fetchGroupInviteLinks: true,
    fetchGroupSettings: true,
    fetchGroupMembers: true,
    fetchGroupMessages: true,
    fetchGroupMedia: true,
    fetchGroupContacts: true,
    fetchGroupTags: true
});

console.log('=== Configuração do Puppeteer ===');
console.log('Headless:', client.puppeteer.headless);
console.log('Args:', client.puppeteer.args);
console.log('ExecutablePath:', client.puppeteer.executablePath);

// Variável para armazenar o QR Code atual
let currentQR = null;

// Eventos do WhatsApp
client.on('qr', (qr) => {
    console.log('\n=== Novo QR Code gerado ===');
    qrcode.generate(qr, { small: true });
    console.log('QR Code gerado com sucesso');
    currentQR = qr;
});

client.on('ready', () => {
    console.log('\n=== Cliente WhatsApp pronto ===');
    console.log(`📅 Data/Hora: ${new Date().toLocaleString()}`);
    console.log('=== Fim da inicialização ===\n');
    currentQR = null;
});

client.on('auth_failure', msg => {
    console.error('\n=== Falha na autenticação ===');
    console.error('Mensagem:', msg);
});

client.on('disconnected', (reason) => {
    console.log('\n=== Cliente desconectado ===');
    console.log('Motivo:', reason);
});

// Rota para verificar status do WhatsApp
app.get('/api/whatsapp-status', (req, res) => {
    res.json({
        isReady: client.info ? true : false,
        qr: currentQR
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
                    console.log(`🔍 Procurando label ${labelId} em todos os labels:`, label);
                    if (label && label.name) {
                        tags.push(label.name);
                        console.log(`✅ Label adicionado: ${label.name}`);
                    }
                }
            } else {
                console.log('⚠️ Contato não possui labels');
            }
        } catch (labelError) {
            console.error('❌ Erro ao obter labels:', labelError);
        }
        
        // Método 2: Labels do chat (backup)
        if (tags.length === 0) {
            try {
                console.log('🔄 Tentando obter labels do chat como backup...');
                const chat = await client.getChatById(contact.id._serialized);
                console.log('💬 Chat encontrado:', {
                    id: chat.id._serialized,
                    name: chat.name,
                    isGroup: chat.isGroup,
                    labels: chat.labels
                });
                
                if (chat && chat.labels) {
                    console.log('🏷️ Labels encontrados no chat:', chat.labels);
                    tags.push(...chat.labels);
                    console.log('✅ Labels do chat adicionados');
                } else {
                    console.log('⚠️ Chat não possui labels');
                }
            } catch (chatError) {
                console.error('❌ Erro ao obter labels do chat:', chatError);
            }
        }
        
        // Remove duplicatas e valores vazios
        const finalTags = [...new Set(tags.filter(tag => tag))];
        console.log('📊 Labels finais após processamento:', finalTags);
        console.log('✅ FIM DA OBTENÇÃO DE TAGS');
        return finalTags;
    } catch (error) {
        console.error('❌ ERRO GERAL ao obter labels:', error);
        return [];
    }
}

// Rota para atualizar tags manualmente
app.post('/api/leads/:number/update-tags', async (req, res) => {
    try {
        const { number } = req.params;
        console.log('🔄 Atualização manual de tags para:', number);
        
        // Formata o número para o formato do WhatsApp
        const formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
        
        // Obtém o contato do WhatsApp
        const contact = await client.getContactById(formattedNumber);
        if (!contact) {
            return res.status(404).json({ 
                success: false, 
                error: 'Contato não encontrado',
                details: 'Não foi possível encontrar o contato no WhatsApp'
            });
        }

        // Obtém as tags usando a função auxiliar
        const tags = await getContactTags(contact);
        console.log('🏷️ Tags obtidas:', tags);

        // Lê o arquivo de leads
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);

        // Atualiza as tags do lead
        if (leads[number]) {
            // Mantém as tags existentes e adiciona as novas
            const existingTags = leads[number].tags || [];
            const updatedTags = [...new Set([...existingTags, ...tags])];
            
            leads[number].tags = updatedTags;
            fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
            
            res.json({ 
                success: true, 
                tags: updatedTags,
                message: 'Tags atualizadas com sucesso'
            });
        } else {
            res.status(404).json({ 
                success: false, 
                error: 'Lead não encontrado',
                details: 'Não foi possível encontrar o lead no arquivo'
            });
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar tags:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao atualizar tags',
            details: error.message
        });
    }
});

// Inicialização do bot
startBot(client, storageService);

// Inicialização do servidor
client.initialize().then(() => {
    app.listen(port, () => {
        console.log('\n=== Servidor iniciado ===');
        console.log(`🌐 URL: http://localhost:${port}`);
        console.log(`📅 Data/Hora: ${new Date().toLocaleString()}`);
        console.log('=== Fim da inicialização do servidor ===\n');
    });
}).catch(err => {
    console.error('\n=== Erro na inicialização ===');
    console.error('Erro:', err);
    console.error('Stack:', err.stack);
});

// Função auxiliar para calcular métricas
function calculateMetrics(leads) {
    const totalLeads = Object.keys(leads).length;
    const leadsByDay = {};
    const leadsByHour = new Array(24).fill(0);

    Object.values(leads).forEach(lead => {
        const date = new Date(lead.timestamp);
        const day = date.toISOString().split('T')[0];
        const hour = date.getHours();

        leadsByDay[day] = (leadsByDay[day] || 0) + 1;
        leadsByHour[hour]++;
    });

    return {
        totalLeads,
        leadsByDay,
        leadsByHour,
        peakHour: leadsByHour.indexOf(Math.max(...leadsByHour))
    };
}

// Rota para a página de analytics
app.get('/analytics', (req, res) => {
    res.render('analytics');
});

// Rota para obter dados do GA4
app.get('/api/ga4-analytics', (req, res) => {
    // Dados mockados do GA4
    const data = {
        activeUsers: 1500,
        newUsers: 250,
        engagementRate: 65,
        totalEvents: 4500,
        devices: {
            'Mobile': 800,
            'Desktop': 600,
            'Tablet': 100
        },
        events: {
            'page_view': 2000,
            'click': 1500,
            'scroll': 700,
            'form_submit': 300
        },
        timeline: generateTimelineData()
    };
    res.json(data);
});

// Função auxiliar para gerar dados da timeline
function generateTimelineData() {
    const timeline = {};
    const today = new Date();
    
    // Gera dados dos últimos 30 dias
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        timeline[dateStr] = {
            activeUsers: Math.floor(Math.random() * 100) + 100,
            newUsers: Math.floor(Math.random() * 30) + 10
        };
    }
    
    return timeline;
}

// Categoria: Melhorias Avançadas
// Rota para a página de produtos
app.get('/products', (req, res) => {
    if (!client.info) {
        res.redirect('/login');
    } else {
        res.render('products');
    }
});

// Rota para a página de campanhas
app.get('/campaigns', (req, res) => {
    if (!client.info) {
        res.redirect('/login');
    } else {
        res.render('campaigns');
    }
});

// Rota para a página de configurações
app.get('/settings', (req, res) => {
    if (!client.info) {
        res.redirect('/login');
    } else {
        res.render('settings');
    }
});

// Rota para obter um lead específico
app.get('/api/leads/:number', (req, res) => {
    try {
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        const lead = leads[req.params.number];
        
        if (lead) {
            res.json(lead);
        } else {
            res.status(404).json({ error: 'Lead não encontrado' });
        }
    } catch (error) {
        console.error('❌ Erro ao ler lead:', error);
        res.status(500).json({ error: 'Erro ao ler lead' });
    }
});

// Rota para atualizar um lead
app.put('/api/leads/:number', (req, res) => {
    try {
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        const number = req.params.number;
        
        if (leads[number]) {
            leads[number] = {
                ...leads[number],
                name: req.body.name || leads[number].name,
                status: req.body.status || leads[number].status,
                tags: leads[number].tags || [],
                formData: {
                    ...leads[number].formData,
                    ...req.body.formData
                }
            };
            
            fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
            res.json(leads[number]);
        } else {
            res.status(404).json({ error: 'Lead não encontrado' });
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar lead:', error);
        res.status(500).json({ error: 'Erro ao atualizar lead' });
    }
});

// Rota para excluir um lead
app.delete('/api/leads/:number', (req, res) => {
    try {
        const number = req.params.number;
        console.log('🔍 Iniciando processo de exclusão');
        console.log('📝 Número recebido:', number);
        
        // Lê o arquivo
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        
        console.log('📋 Leads encontrados:', Object.keys(leads).length);
        
        if (leads[number]) {
            console.log('✅ Lead encontrado, procedendo com a exclusão');
            
            // Remove o lead
            delete leads[number];
            
            // Salva o arquivo
            fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
            console.log('💾 Arquivo salvo com sucesso');
            
            res.status(204).send();
        } else {
            console.log('❌ Lead não encontrado');
            res.status(404).json({ 
                error: 'Lead não encontrado',
                searchedNumber: number,
                availableNumbers: Object.keys(leads)
            });
        }
    } catch (error) {
        console.error('❌ Erro ao excluir lead:', error);
        res.status(500).json({ 
            error: 'Erro ao excluir lead',
            details: error.message
        });
    }
});

// Middleware de erro para rotas não encontradas
app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// Middleware de erro geral
app.use((err, req, res, next) => {
    console.error('❌ Erro na aplicação:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: err.message
    });
}); 