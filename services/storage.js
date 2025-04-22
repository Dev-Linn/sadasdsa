const fs = require('fs').promises;
const path = require('path');

const LEADS_FILE = path.join(__dirname, '../leads.json');
const PRODUCTS_FILE = path.join(__dirname, '../config/products.json');

async function getAllLeads() {
    try {
        const data = await fs.readFile(LEADS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(LEADS_FILE, '{}');
            return {};
        }
        throw error;
    }
}

async function getProducts() {
    try {
        const data = await fs.readFile(PRODUCTS_FILE, 'utf8');
        return JSON.parse(data).products;
    } catch (error) {
        console.error('Erro ao carregar produtos:', error);
        return [];
    }
}

async function saveLeads(leads) {
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
}

function detectProducts(message, products) {
    const detectedProducts = [];
    const messageLower = message.toLowerCase();
    
    products.forEach(product => {
        // Verifica palavras-chave do nome do produto
        const keywords = product.name.toLowerCase().split(' - ')[1]?.split(' ').filter(word => word.length > 3) || [];
        
        // Verifica se alguma palavra-chave está na mensagem
        const hasKeyword = keywords.some(keyword => messageLower.includes(keyword.toLowerCase()));
        
        // Verifica variações do produto
        const hasVariation = product.variations.some(variation => 
            messageLower.includes(variation.toLowerCase())
        );
        
        if (hasKeyword || hasVariation) {
            detectedProducts.push(product.name);
        }
    });
    
    return detectedProducts;
}

async function addLead(number, name, message, tags = []) {
    const leads = await getAllLeads();
    const products = await getProducts();
    const detectedProducts = detectProducts(message, products);
    
    if (!leads[number]) {
        leads[number] = {
            name,
            timestamp: new Date().toISOString(),
            interactions: 1,
            messages: [message],
            products: detectedProducts,
            status: 'Novo',
            tags: tags,
            formData: {
                nome: '',
                cpf: '',
                email: '',
                telefone: '',
                endereco: '',
                cep: ''
            },
            formStatus: 'pendente'
        };
    } else {
        leads[number].interactions++;
        leads[number].messages = leads[number].messages || [];
        leads[number].messages.push(message);
        
        // Atualiza produtos mencionados
        leads[number].products = [...new Set([
            ...(leads[number].products || []),
            ...detectedProducts
        ])];

        // Atualiza tags
        leads[number].tags = [...new Set([
            ...(leads[number].tags || []),
            ...tags
        ])];
    }

    await saveLeads(leads);
    return leads[number];
}

async function updateLeadInteractions(number, message, tags = []) {
    const leads = await getAllLeads();
    const products = await getProducts();
    const detectedProducts = detectProducts(message, products);
    
    if (leads[number]) {
        leads[number].interactions++;
        leads[number].messages = leads[number].messages || [];
        leads[number].messages.push(message);
        
        // Atualiza produtos mencionados
        leads[number].products = [...new Set([
            ...(leads[number].products || []),
            ...detectedProducts
        ])];
        
        // Atualiza tags
        if (tags && tags.length > 0) {
            leads[number].tags = [...new Set([
                ...(leads[number].tags || []),
                ...tags
            ])];
        }
        
        await saveLeads(leads);
    }
    
    return leads[number];
}

async function updateFormData(number, field, value) {
    const leads = await getAllLeads();
    
    if (leads[number]) {
        if (!leads[number].formData) {
            leads[number].formData = {
                nome: '',
                cpf: '',
                email: '',
                telefone: '',
                endereco: '',
                cep: ''
            };
        }
        
        leads[number].formData[field] = value;
        
        // Verifica se todos os campos foram preenchidos
        const allFieldsFilled = Object.values(leads[number].formData).every(value => value.trim() !== '');
        leads[number].formStatus = allFieldsFilled ? 'completo' : 'em_andamento';
        
        await saveLeads(leads);
    }
    
    return leads[number];
}

module.exports = {
    getAllLeads,
    addLead,
    updateLeadInteractions,
    updateFormData
}; 