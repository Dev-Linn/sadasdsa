const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const storageService = require('./services/storage');
const startBot = require('./services/whatsappBot');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

// Status global do WhatsApp
let whatsappStatus = {
    ready: false,
    qrCode: null,
    lastError: null,
    connecting: false
};

// Variável para armazenar o cliente
let client = null;

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
        '--disable-gpu',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--disable-features=site-per-process',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials'
    ]
};

// Verifica se está em ambiente de produção (Docker)
if (process.env.NODE_ENV === 'production') {
    puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
    console.log('Usando Chromium em:', puppeteerConfig.executablePath);
}

// Wrapper seguro para funções do WhatsApp
function safeWhatsAppOperation(operation, fallbackValue = null) {
    return async function(...args) {
        if (!client) {
            console.log('Cliente não disponível para operação');
            return fallbackValue;
        }
        
        try {
            // Verifica se o cliente está em um estado válido
            if (!client.info && operation !== 'initialize') {
                console.log('Cliente não está inicializado para operação');
                return fallbackValue;
            }
            
            // Executa a operação solicitada
            return await operation.apply(this, args);
        } catch (error) {
            // Detecta erros de protocolo específicos
            if (error.message && error.message.includes('Protocol error') && 
                error.message.includes('Target closed')) {
                console.error('Erro de protocolo detectado, agendando recriação do cliente...');
                
                // Agenda recriação do cliente para este tipo específico de erro
                setTimeout(() => {
                    console.log('Recriando cliente após erro de protocolo...');
                    recreateAndInitializeClient();
                }, 3000);
                
                return fallbackValue;
            }
            
            // Registra o erro e retorna o valor padrão
            console.error(`Erro na operação ${operation.name}:`, error);
            return fallbackValue;
        }
    };
}

// Função para criar um novo cliente WhatsApp
function createClient() {
    try {
        // Se já existe um cliente, tenta destruí-lo corretamente
        if (client) {
            try {
                // Remove todos os listeners para evitar vazamentos de memória
                client.removeAllListeners();
                // Tenta fechar a sessão se possível
                if (client.pupPage && !client.pupPage.isClosed()) {
                    client.pupPage.close().catch(() => {});
                }
                client.destroy().catch(() => {});
                client = null;
                console.log('Cliente anterior destruído');
            } catch (error) {
                console.error('Erro ao destruir cliente antigo:', error);
            }
        }

        // Cria um novo cliente
        console.log('Criando novo cliente WhatsApp...');
        client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'whatsapp-tracker'
            }),
            puppeteer: puppeteerConfig,
            restartOnAuthFail: true
        });

        // Configura os event listeners
        setupClientListeners();
        
        return client;
    } catch (error) {
        console.error('Erro ao criar cliente:', error);
        return null;
    }
}

// Configura os listeners para o cliente
function setupClientListeners() {
    if (!client) return;

    client.on('qr', (qr) => {
        console.log('QR Code gerado. Por favor, escaneie com o WhatsApp:');
        qrcode.generate(qr, { small: true });
        whatsappStatus.qrCode = qr;
        whatsappStatus.connecting = true;
        whatsappStatus.lastError = null;
    });

    client.on('ready', () => {
        console.log('Cliente WhatsApp conectado e pronto!');
        whatsappStatus.ready = true;
        whatsappStatus.connecting = false;
        whatsappStatus.qrCode = null;
        whatsappStatus.lastError = null;
    });

    client.on('auth_failure', msg => {
        console.error('Falha na autenticação:', msg);
        whatsappStatus.lastError = 'Falha na autenticação: ' + msg;
        whatsappStatus.ready = false;
        whatsappStatus.connecting = false;
        
        // Tenta reinicializar o cliente após falha de autenticação
        setTimeout(() => {
            console.log('Tentando reconectar após falha de autenticação...');
            recreateAndInitializeClient();
        }, 5000);
    });

    client.on('disconnected', (reason) => {
        console.log('Cliente desconectado:', reason);
        whatsappStatus.ready = false;
        whatsappStatus.connecting = false;
        whatsappStatus.lastError = 'Desconectado: ' + reason;
        
        // Tenta reconectar após desconexão
        setTimeout(() => {
            console.log('Tentando reconectar após desconexão...');
            recreateAndInitializeClient();
        }, 5000);
    });

    // Adicionado para capturar erros do Puppeteer
    client.on('error', (error) => {
        console.error('Erro no cliente:', error);
        whatsappStatus.ready = false;
        whatsappStatus.connecting = false;
        whatsappStatus.lastError = 'Erro no cliente: ' + error.message;
        
        setTimeout(() => {
            console.log('Tentando reconectar após erro...');
            recreateAndInitializeClient();
        }, 8000);
    });

    // Adiciona um handler para mensagens
    client.on('message', async (msg) => {
        try {
            // Usa wrapper seguro para getContact
            const getContactSafely = safeWhatsAppOperation(async function() {
                return await msg.getContact();
            });
            
            const contact = await getContactSafely();
            if (!contact) {
                console.log('Não foi possível obter contato da mensagem');
                return;
            }
            
            const senderName = contact.name || contact.number;
            
            console.log('\n📱 MENSAGEM RECEBIDA');
            console.log(`👤 De: ${senderName} (${contact.number})`);
            console.log(`💬 Mensagem: ${msg.body}`);
            console.log(`⏰ Data/Hora: ${new Date().toLocaleString()}`);
            console.log('====================\n');

            // Atualiza as tags com wrapper seguro
            const updateTagsSafely = safeWhatsAppOperation(updateContactTags);
            await updateTagsSafely(contact);
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            
            // Se for um erro de protocolo, agenda recriação
            if (error.message && error.message.includes('Protocol error') && 
                error.message.includes('Target closed')) {
                setTimeout(recreateAndInitializeClient, 5000);
            }
        }
    });
}

// Função para recriar e inicializar o cliente
function recreateAndInitializeClient() {
    console.log('Recriando e inicializando cliente...');
    whatsappStatus.connecting = true;
    
    try {
        createClient();
        initializeClientWithErrorHandling();
    } catch (error) {
        console.error('Erro ao recriar cliente:', error);
        whatsappStatus.lastError = 'Erro ao recriar cliente: ' + error.message;
        whatsappStatus.connecting = false;
        
        // Tenta novamente após um tempo
        setTimeout(recreateAndInitializeClient, 10000);
    }
}

// Função para inicializar o cliente com tratamento de erros
function initializeClientWithErrorHandling() {
    if (!client) {
        console.error('Cliente não está disponível para inicializar');
        return;
    }
    
    try {
        client.initialize().catch(err => {
            console.error('Erro ao reconectar:', err);
            whatsappStatus.lastError = 'Erro ao reconectar: ' + err.message;
            whatsappStatus.connecting = false;
            
            // Agenda nova tentativa com recriação completa do cliente
            setTimeout(() => {
                console.log('Agendando nova tentativa de reconexão com recriação do cliente...');
                recreateAndInitializeClient();
            }, 10000);
        });
    } catch (err) {
        console.error('Erro ao iniciar reconexão:', err);
        whatsappStatus.lastError = 'Erro ao iniciar reconexão: ' + err.message;
        whatsappStatus.connecting = false;
        
        // Agenda nova tentativa
        setTimeout(() => {
            console.log('Agendando nova tentativa após exceção...');
            recreateAndInitializeClient();
        }, 15000);
    }
}

// IMPORTANTE: Inicialize o servidor Express ANTES de iniciar o cliente WhatsApp
// Isso garante que o servidor esteja disponível mesmo se o WhatsApp falhar
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
    
    // Inicia o cliente WhatsApp em uma Promise separada
    console.log('Iniciando cliente WhatsApp...');
    
    // Cria e inicia o cliente em um processo separado
    startWhatsAppClientAsync().catch(err => {
        console.error('Erro ao iniciar cliente WhatsApp (processo principal não afetado):', err);
    });
});

// Função para iniciar o cliente WhatsApp de forma assíncrona
async function startWhatsAppClientAsync() {
    try {
        // Marca como em processo de conexão
        whatsappStatus.connecting = true;
        
        // Cria o cliente inicial
        createClient();
        
        // Inicia o cliente e espera até 60 segundos pelo resultado
        const initPromise = new Promise((resolve, reject) => {
            // Configura um timeout para evitar que fique preso indefinidamente
            const timeoutId = setTimeout(() => {
                whatsappStatus.lastError = 'Timeout ao inicializar cliente';
                whatsappStatus.connecting = false;
                reject(new Error('Timeout ao inicializar cliente WhatsApp'));
            }, 60000);
            
            // Tenta inicializar o cliente
            initializeClientWithErrorHandling()
                .then(() => {
                    clearTimeout(timeoutId);
                    resolve();
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    reject(err);
                });
        });
        
        // Aguarda a inicialização, mas não bloqueia o servidor principal
        await initPromise;
        console.log('Cliente WhatsApp iniciado com sucesso no processo separado');
    } catch (error) {
        console.error('Erro ao iniciar cliente WhatsApp:', error);
        whatsappStatus.lastError = 'Erro ao iniciar: ' + error.message;
        whatsappStatus.connecting = false;
        
        // Agenda uma nova tentativa após um tempo
        setTimeout(() => {
            console.log('Agendando nova tentativa automática de inicialização...');
            startWhatsAppClientAsync().catch(() => {
                // Ignora erros na nova tentativa para não criar um loop infinito de logs
            });
        }, 30000);
    }
}

// Middleware de tratamento de erros - DEVE vir APÓS as rotas
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).send('Erro interno do servidor. Por favor, tente novamente mais tarde.');
});

// Health check endpoint (importante para Railway)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Rota para forçar a recriação completa do cliente WhatsApp
app.post('/api/whatsapp-recreate', (req, res) => {
    console.log('🔄 Solicitação de recriação completa do cliente recebida');
    
    if (whatsappStatus.connecting) {
        return res.json({ 
            success: false, 
            error: 'Já existe uma tentativa de conexão em andamento' 
        });
    }
    
    try {
        // Marca como em processo de conexão
        whatsappStatus.connecting = true;
        whatsappStatus.ready = false;
        whatsappStatus.qrCode = null;
        whatsappStatus.lastError = null;
        
        console.log('🔄 Recriando completamente o cliente WhatsApp');
        recreateAndInitializeClient();
        
        res.json({ 
            success: true, 
            message: 'Recriação do cliente iniciada' 
        });
    } catch (error) {
        console.error('❌ Erro ao recriar cliente:', error);
        whatsappStatus.lastError = 'Erro ao recriar cliente: ' + error.message;
        whatsappStatus.connecting = false;
        
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao recriar cliente: ' + error.message 
        });
    }
});

// Rota para reconectar manualmente o WhatsApp
app.post('/api/whatsapp-reconnect', (req, res) => {
    console.log('🔄 Solicitação de reconexão manual recebida');
    
    if (whatsappStatus.connecting) {
        return res.json({ 
            success: false, 
            error: 'Já existe uma tentativa de conexão em andamento' 
        });
    }
    
    try {
        // Inicia a reconexão
        whatsappStatus.connecting = true;
        console.log('🔄 Iniciando reconexão manual');
        
        // Se o cliente parece estar em um estado ruim, recria completamente
        if (whatsappStatus.lastError && whatsappStatus.lastError.includes('Protocol error')) {
            console.log('Detectado erro de protocolo, recriando cliente...');
            recreateAndInitializeClient();
        } else {
            // Caso contrário, tenta apenas reconectar
            initializeClientWithErrorHandling();
        }
        
        res.json({ 
            success: true, 
            message: 'Tentativa de reconexão iniciada' 
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar reconexão manual:', error);
        whatsappStatus.lastError = 'Erro ao iniciar reconexão: ' + error.message;
        whatsappStatus.connecting = false;
        
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao iniciar reconexão: ' + error.message 
        });
    }
});

// Rota para verificar status do WhatsApp
app.get('/api/whatsapp-status', (req, res) => {
    // Adiciona uma verificação para detectar cliente em estado ruim
    if (client && !whatsappStatus.connecting && !whatsappStatus.ready) {
        // Cliente existe mas não está pronto nem conectando
        // Pode estar em um estado ruim
        whatsappStatus.lastError = 'Cliente em estado instável. Tente reconectar.';
    }
    
    res.json(whatsappStatus);
});

// Rota principal
app.get('/', (req, res) => {
    if (whatsappStatus.ready) {
        res.render('index');
    } else if (whatsappStatus.qrCode) {
        res.render('login');
    } else {
        res.render('login', { error: whatsappStatus.lastError });
    }
});

// Rota de login
app.get('/login', (req, res) => {
    if (whatsappStatus.ready) {
        res.redirect('/');
    } else {
        res.render('login', { error: whatsappStatus.lastError });
    }
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

// Rota para obter um lead específico pelo número
app.get('/api/leads/:number', (req, res) => {
    try {
        const number = req.params.number;
        console.log(`🔍 Buscando lead: ${number}`);
        
        // Lê o arquivo de leads
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        
        // Verifica se o lead existe
        if (!leads[number]) {
            console.log(`❌ Lead não encontrado: ${number}`);
            return res.status(404).json({ error: `Lead não encontrado: ${number}` });
        }
        
        // Retorna o lead encontrado
        console.log(`✅ Lead encontrado: ${number}`);
        res.json(leads[number]);
    } catch (error) {
        console.error(`❌ Erro ao buscar lead:`, error);
        res.status(500).json({ error: 'Erro ao buscar lead' });
    }
});

// Rota para excluir um lead pelo número
app.delete('/api/leads/:number', (req, res) => {
    try {
        const number = req.params.number;
        console.log(`🗑️ Solicitação para excluir lead: ${number}`);
        
        // Lê o arquivo de leads
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        
        // Verifica se o lead existe
        if (!leads[number]) {
            console.log(`❌ Lead não encontrado: ${number}`);
            return res.status(404).json({ error: `Lead não encontrado: ${number}` });
        }
        
        // Exclui o lead
        delete leads[number];
        
        // Salva o arquivo atualizado
        fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
        console.log(`✅ Lead excluído com sucesso: ${number}`);
        
        // Retorna resposta de sucesso
        res.json({ success: true, message: `Lead ${number} excluído com sucesso` });
    } catch (error) {
        console.error(`❌ Erro ao excluir lead:`, error);
        res.status(500).json({ error: 'Erro ao excluir lead' });
    }
});

// Rota para atualizar as tags de um lead
app.post('/api/leads/:number/update-tags', async (req, res) => {
    try {
        const number = req.params.number;
        console.log(`🔄 Atualizando tags para o lead: ${number}`);
        
        // Lê o arquivo de leads
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        
        // Verifica se o lead existe
        if (!leads[number]) {
            console.log(`❌ Lead não encontrado: ${number}`);
            return res.status(404).json({ error: `Lead não encontrado: ${number}` });
        }
        
        // Atualiza as tags do lead
        try {
            // Verifica se o cliente está pronto
            if (!client || !client.info) {
                return res.status(503).json({ 
                    error: 'Cliente WhatsApp não está pronto', 
                    whatsappStatus: whatsappStatus 
                });
            }
            
            // Usa o wrapper seguro para getContactById
            const getContactSafely = safeWhatsAppOperation(async function(contactId) {
                return await client.getContactById(contactId);
            });
            
            const contact = await getContactSafely(`${number}@c.us`);
            if (!contact) {
                return res.status(404).json({ error: 'Contato não encontrado no WhatsApp' });
            }
            
            // Obtém as tags do contato (usando wrapper seguro)
            const getTagsSafely = safeWhatsAppOperation(getContactTags, []);
            const tags = await getTagsSafely(contact);
            console.log(`📊 Tags obtidas:`, tags);
            
            // Atualiza as tags do lead
            leads[number].tags = tags;
            
            // Salva o arquivo atualizado
            fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
            console.log(`✅ Tags atualizadas com sucesso para: ${number}`);
            
            // Retorna resposta de sucesso
            res.json({ 
                success: true, 
                message: `Tags atualizadas com sucesso para ${number}`,
                tags: tags
            });
        } catch (error) {
            console.error(`❌ Erro ao atualizar tags:`, error);
            res.status(500).json({ 
                error: 'Erro ao atualizar tags', 
                details: error.message 
            });
        }
    } catch (error) {
        console.error(`❌ Erro geral ao processar requisição:`, error);
        res.status(500).json({ error: 'Erro ao processar requisição' });
    }
});

// Rota para atualizar os dados de um lead
app.put('/api/leads/:number', (req, res) => {
    try {
        const number = req.params.number;
        const updateData = req.body;
        console.log(`📝 Atualizando dados do lead: ${number}`);
        
        // Lê o arquivo de leads
        const leadsData = fs.readFileSync('leads.json', 'utf8');
        const leads = JSON.parse(leadsData);
        
        // Verifica se o lead existe
        if (!leads[number]) {
            console.log(`❌ Lead não encontrado: ${number}`);
            return res.status(404).json({ error: `Lead não encontrado: ${number}` });
        }
        
        // Atualiza os dados do lead preservando alguns campos importantes
        const updatedLead = {
            ...leads[number],
            ...updateData
        };
        
        // Preserva as tags e o timestamp original
        updatedLead.tags = leads[number].tags || [];
        updatedLead.timestamp = leads[number].timestamp;
        
        // Atualiza o lead no objeto de leads
        leads[number] = updatedLead;
        
        // Salva o arquivo atualizado
        fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2));
        console.log(`✅ Lead atualizado com sucesso: ${number}`);
        
        // Retorna resposta de sucesso
        res.json({ success: true, lead: updatedLead });
    } catch (error) {
        console.error(`❌ Erro ao atualizar lead:`, error);
        res.status(500).json({ error: 'Erro ao atualizar lead' });
    }
});

app.get('/api/metrics', async (req, res) => {
    const leads = await storageService.getAllLeads();
    const metrics = calculateMetrics(leads);
    res.json(metrics);
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
        if (!contact || !contact.number) {
            console.log('❌ Contato inválido para atualização de tags');
            return;
        }

        const number = contact.number.replace('@c.us', '');
        console.log('\n🔄 INÍCIO DA ATUALIZAÇÃO DE TAGS');
        console.log('📱 Número do contato:', number);
        console.log('👤 Dados do contato:', {
            id: contact.id._serialized,
            name: contact.name,
            pushname: contact.pushname,
            isWAContact: contact.isWAContact
        });
        
        // Obtém as tags do contato com wrapper seguro
        console.log('🔍 Chamando getContactTags...');
        const getTagsSafely = safeWhatsAppOperation(getContactTags, []);
        const tags = await getTagsSafely(contact);
        console.log('📊 Tags obtidas:', tags);
        
        // Lê o arquivo de leads de forma segura
        try {
            console.log('📂 Lendo arquivo leads.json...');
            if (!fs.existsSync('leads.json')) {
                console.log('📄 Arquivo leads.json não existe, criando novo arquivo...');
                fs.writeFileSync('leads.json', JSON.stringify({}, null, 2));
            }
            
            const leadsData = fs.readFileSync('leads.json', 'utf8');
            let leads = {};
            
            try {
                leads = JSON.parse(leadsData);
                console.log('✅ Arquivo leads.json lido com sucesso');
            } catch (e) {
                console.error('❌ Erro ao parsear JSON do arquivo leads.json:', e);
                console.log('🔄 Criando novo arquivo leads.json...');
                leads = {};
            }

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
        } catch (fsError) {
            console.error('❌ ERRO ao acessar arquivo leads.json:', fsError);
            console.error('Stack trace:', fsError.stack);
        }
    } catch (error) {
        console.error('❌ ERRO ao atualizar tags:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Função auxiliar para obter tags do contato
async function getContactTags(contact) {
    try {
        console.log('🔍 INÍCIO DA OBTENÇÃO DE TAGS');
        
        if (!contact || !contact.id) {
            console.log('❌ Contato inválido para obtenção de tags');
            return [];
        }
        
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
        
        // Método 1: Labels do WhatsApp Business (com tratamento de erro)
        try {
            console.log('🔄 Tentando obter labels do WhatsApp Business...');
            
            // Usa o wrapper seguro para getLabels
            const getLabelsSafely = safeWhatsAppOperation(async function() {
                if (client && client.getLabels) {
                    return await client.getLabels();
                }
                return [];
            }, []);
            
            const allLabels = await getLabelsSafely();
            console.log('📊 Todos os labels do WhatsApp:', allLabels);
            
            if (contact.labels && Array.isArray(contact.labels)) {
                console.log('✅ Array de labels do contato válido:', contact.labels);
                for (const labelId of contact.labels) {
                    const label = allLabels.find(l => l && l.id === labelId);
                    console.log(`🏷️ Label: ${label ? label.name : 'Não encontrado'}`);
                    if (label && label.name) {
                        tags.push(label.name);
                    }
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

// No início do arquivo, após os requires
process.on('uncaughtException', (error) => {
    console.error('⚠️ ERRO NÃO TRATADO CAPTURADO:', error);
    console.error('Stack trace:', error.stack);
    
    // Verifica se é um erro de protocolo do Puppeteer
    if (error.message && error.message.includes('Protocol error') && 
        error.message.includes('Target closed')) {
        console.log('🔄 Erro de protocolo fatal detectado. Agendando recriação do cliente...');
        
        // Desativa o cliente atual
        if (client) {
            whatsappStatus.ready = false;
            whatsappStatus.connecting = false;
            whatsappStatus.qrCode = null;
            whatsappStatus.lastError = 'Erro fatal de protocolo: ' + error.message;
            
            // Agenda uma recriação do cliente
            setTimeout(() => {
                console.log('Recriando cliente após erro fatal...');
                recreateAndInitializeClient();
            }, 5000);
        }
    }
    
    // Não finaliza o processo para manter o servidor online
    // O erro já foi registrado e tentativas de recuperação foram iniciadas
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ PROMESSA REJEITADA NÃO TRATADA:', reason);
    
    // Verifica se é um erro de protocolo do Puppeteer
    if (reason && reason.message && reason.message.includes('Protocol error') && 
        reason.message.includes('Target closed')) {
        console.log('🔄 Erro de protocolo em promessa detectado. Verificando estado do cliente...');
        
        // Verifica o estado atual do cliente
        if (client && !whatsappStatus.connecting) {
            console.log('Cliente em estado possivelmente inconsistente. Agendando verificação...');
            
            // Agenda uma verificação de saúde do cliente
            setTimeout(() => {
                if (!whatsappStatus.ready && !whatsappStatus.connecting) {
                    console.log('Cliente confirmado em estado inconsistente. Recriando...');
                    recreateAndInitializeClient();
                }
            }, 10000);
        }
    }
});