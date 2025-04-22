function startBot(client, storageService) {
    client.on('message', async msg => {
        // Ignora mensagens de grupos
        if (msg.isGroup) return;

        const contact = await msg.getContact();
        const number = contact.number;
        const name = contact.name || contact.pushname || 'Desconhecido';
        const message = msg.body;

        try {
            // Verifica se é a mensagem do formulário que você enviou
            if (message.includes('Nome:') && 
                message.includes('CPF:') && 
                message.includes('Email:') && 
                message.includes('Telefone:') && 
                message.includes('Endereço:') && 
                message.includes('CEP:')) {
                
                let leads = await storageService.getAllLeads();
                if (!leads[number]) {
                    await storageService.addLead(number, name, message);
                }
                
                // Define o status como em_andamento quando você envia o formulário
                leads = await storageService.getAllLeads();
                if (leads[number]) {
                    leads[number].formStatus = 'em_andamento';
                    await storageService.saveLeads(leads);
                }
                return;
            }

            // Processamento normal de mensagens
            let leads = await storageService.getAllLeads();
            if (!leads[number]) {
                await storageService.addLead(number, name, message);
                console.log(`Novo lead capturado: ${name} (${number})`);
            } else {
                // Se o lead está em_andamento, muda para completo quando recebe qualquer mensagem
                if (leads[number].formStatus === 'em_andamento') {
                    leads[number].formStatus = 'completo';
                    await storageService.saveLeads(leads);
                }
                
                await storageService.updateLeadInteractions(number, message);
                console.log(`Mensagem recebida de: ${name} (${number})`);
            }
        } catch (error) {
            console.error('Erro ao processar lead:', error);
        }
    });
}

function extractFormData(message) {
    // Converte a mensagem para minúsculas para facilitar a busca
    const msgLower = message.toLowerCase();
    
    // Verifica se a mensagem contém todos os campos necessários
    if (!msgLower.includes('nome:') || !msgLower.includes('cpf:') || 
        !msgLower.includes('email:') || !msgLower.includes('telefone:') || 
        !msgLower.includes('endereço:') || !msgLower.includes('cep:')) {
        return null;
    }

    // Extrai os dados usando expressões regulares
    const nome = extractValue(message, 'nome:');
    const cpf = extractValue(message, 'cpf:');
    const email = extractValue(message, 'email:');
    const telefone = extractValue(message, 'telefone:');
    const endereco = extractValue(message, 'endereço:');
    const cep = extractValue(message, 'cep:');

    // Verifica se todos os campos foram encontrados
    if (nome && cpf && email && telefone && endereco && cep) {
        return {
            nome: nome.trim(),
            cpf: cpf.trim(),
            email: email.trim(),
            telefone: telefone.trim(),
            endereco: endereco.trim(),
            cep: cep.trim()
        };
    }

    return null;
}

function extractValue(message, field) {
    const regex = new RegExp(`${field}\\s*([^\\n]+)`, 'i');
    const match = message.match(regex);
    return match ? match[1] : null;
}

async function getContactTags(client, contact) {
    try {
        console.log('🔍 Tentando obter tags do contato:', contact);
        const contactObj = await client.getContactById(contact);
        console.log('📱 Objeto do contato:', contactObj);
        
        if (contactObj) {
            let tags = [];
            
            // Tenta diferentes métodos de obter as tags
            try {
                if (contactObj.tags) {
                    console.log('🏷️ Tags encontradas em contactObj.tags');
                    tags = contactObj.tags;
                } else if (contactObj.labels) {
                    console.log('🏷️ Tags encontradas em contactObj.labels');
                    tags = contactObj.labels;
                } else if (contactObj.groups) {
                    console.log('🏷️ Tags encontradas em contactObj.groups');
                    tags = contactObj.groups.map(g => g.name);
                }
                
                // Tenta obter as tags diretamente do WhatsApp
                if (tags.length === 0) {
                    console.log('🔍 Tentando obter tags diretamente do WhatsApp...');
                    const chat = await client.getChatById(contact);
                    if (chat && chat.labels) {
                        console.log('🏷️ Tags encontradas no chat');
                        tags = chat.labels;
                    }
                }
            } catch (tagError) {
                console.error('❌ Erro ao obter tags:', tagError);
            }
            
            console.log('🏷️ Tags finais:', tags);
            return tags;
        }
        return [];
    } catch (error) {
        console.error('❌ Erro ao obter tags do contato:', error);
        return [];
    }
}

async function handleMessage(client, message) {
    try {
        const contact = message.from;
        console.log('📨 Nova mensagem recebida de:', contact);
        
        const contactObj = await client.getContactById(contact);
        console.log('👤 Dados do contato:', contactObj);
        
        const name = contactObj.pushname || contactObj.name || 'Desconhecido';
        const tags = await getContactTags(client, contact);
        console.log('🏷️ Tags capturadas:', tags);
        
        // Adiciona o lead com as tags
        const lead = await storageService.addLead(contact, name, message.body, tags);
        console.log('✅ Lead atualizado com tags:', lead);
        
    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error);
    }
}

module.exports = startBot; 