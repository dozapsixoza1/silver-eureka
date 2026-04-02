require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ===== IN-MEMORY STORAGE =====
const phoneToTg   = {};   // phone -> telegram chatId
const pendingCodes = {};  // phone -> { code, expires }
const sessions     = {};  // token -> phone
const users        = {};  // phone -> { userId, phone, name, username, avatar, createdAt }
const wsClients    = {};  // userId -> WebSocket
const conversations = {}; // convKey -> messages[]

// ===== COUNTRIES =====
const COUNTRIES = [
  { code: '+7',    len: 10, name: '🇷🇺 Россия'         },
  { code: '+380',  len: 9,  name: '🇺🇦 Украина'        },
  { code: '+375',  len: 9,  name: '🇧🇾 Беларусь'       },
  { code: '+7',    len: 10, name: '🇰🇿 Казахстан'      },
  { code: '+1',    len: 10, name: '🇺🇸 США'            },
  { code: '+44',   len: 10, name: '🇬🇧 Великобритания' },
  { code: '+49',   len: 10, name: '🇩🇪 Германия'       },
  { code: '+33',   len: 9,  name: '🇫🇷 Франция'        },
  { code: '+39',   len: 10, name: '🇮🇹 Италия'         },
  { code: '+34',   len: 9,  name: '🇪🇸 Испания'        },
  { code: '+81',   len: 10, name: '🇯🇵 Япония'         },
  { code: '+86',   len: 11, name: '🇨🇳 Китай'          },
  { code: '+91',   len: 10, name: '🇮🇳 Индия'          },
  { code: '+55',   len: 11, name: '🇧🇷 Бразилия'       },
  { code: '+90',   len: 10, name: '🇹🇷 Турция'         },
  { code: '+48',   len: 9,  name: '🇵🇱 Польша'         },
  { code: '+31',   len: 9,  name: '🇳🇱 Нидерланды'     },
  { code: '+46',   len: 9,  name: '🇸🇪 Швеция'         },
  { code: '+47',   len: 8,  name: '🇳🇴 Норвегия'       },
  { code: '+82',   len: 10, name: '🇰🇷 Южная Корея'    },
];

function generatePhone(countryCode = null) {
  const pool = countryCode ? COUNTRIES.filter(c => c.code === countryCode) : COUNTRIES;
  const country = pool[Math.floor(Math.random() * pool.length)] || COUNTRIES[0];
  let num = '';
  for (let i = 0; i < country.len; i++) {
    num += i === 0
      ? String(Math.floor(Math.random() * 9) + 1)
      : String(Math.floor(Math.random() * 10));
  }
  return country.code + num;
}

// ===== TELEGRAM BOT =====
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set in .env!');
  process.exit(1);
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'друг';
  bot.sendMessage(chatId,
    `👋 Привет, ${firstName}!\n\n💬 *Tiegram* — современный мессенджер.\n\nДля регистрации или входа получите виртуальный номер телефона, затем введите его на сайте.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Получить случайный номер', callback_data: 'get_number_random' }],
          [{ text: '🌍 Выбрать страну', callback_data: 'choose_country' }],
        ]
      }
    }
  );
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === 'get_number_random') {
    await bot.answerCallbackQuery(query.id);
    const phone = generatePhone();
    phoneToTg[phone] = chatId;
    bot.sendMessage(chatId,
      `✅ *Ваш виртуальный номер:*\n\n\`${phone}\`\n\n📋 Скопируйте и вставьте на сайте Tiegram.\n⏱ Действует 30 минут.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔄 Новый номер', callback_data: 'get_number_random' }]]
        }
      }
    );
  }

  if (query.data === 'choose_country') {
    await bot.answerCallbackQuery(query.id);
    const unique = [...new Map(COUNTRIES.map(c => [c.code, c])).values()];
    const rows = [];
    for (let i = 0; i < unique.length; i += 2) {
      const row = [{ text: unique[i].name, callback_data: `country_${unique[i].code}` }];
      if (unique[i + 1]) row.push({ text: unique[i + 1].name, callback_data: `country_${unique[i + 1].code}` });
      rows.push(row);
    }
    bot.sendMessage(chatId, '🌍 Выберите страну:', { reply_markup: { inline_keyboard: rows } });
  }

  if (query.data.startsWith('country_')) {
    await bot.answerCallbackQuery(query.id);
    const code = query.data.slice('country_'.length);
    const phone = generatePhone(code);
    phoneToTg[phone] = chatId;
    const country = COUNTRIES.find(c => c.code === code);
    bot.sendMessage(chatId,
      `✅ *${country ? country.name : 'Номер'} для регистрации:*\n\n\`${phone}\`\n\n📋 Скопируйте и вставьте на сайте Tiegram.\n⏱ Действует 30 минут.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔄 Другой номер', callback_data: `country_${code}` }]]
        }
      }
    );
  }
});

bot.on('polling_error', (err) => console.error('Bot polling error:', err.message));

// ===== REST API =====

// Проверка сессии
app.get('/api/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const phone = sessions[token];
  if (!phone || !users[phone]) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: users[phone] });
});

// Запрос кода
app.post('/api/request-code', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Номер обязателен' });

  const tgChatId = phoneToTg[phone];
  if (!tgChatId) return res.status(404).json({ error: 'Номер не найден. Сначала получите его в боте.' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  pendingCodes[phone] = { code, expires: Date.now() + 5 * 60 * 1000 };

  const isNew = !users[phone];
  bot.sendMessage(tgChatId,
    `🔐 *${isNew ? 'Регистрация' : 'Вход'} в Tiegram*\n\nНомер: \`${phone}\`\nКод: \`${code}\`\n\n⏱ Действует 5 минут\n⚠️ Никому не сообщайте этот код!`,
    { parse_mode: 'Markdown' }
  );

  res.json({ success: true });
});

// Проверка кода
app.post('/api/verify-code', (req, res) => {
  const { phone, code } = req.body;

  const pending = pendingCodes[phone];
  if (!pending) return res.status(400).json({ error: 'Код не запрошен или истёк' });
  if (Date.now() > pending.expires) {
    delete pendingCodes[phone];
    return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
  }
  if (pending.code !== String(code)) return res.status(400).json({ error: 'Неверный код' });

  delete pendingCodes[phone];

  const isNew = !users[phone];
  if (isNew) {
    users[phone] = { userId: uuidv4(), phone, name: null, username: null, createdAt: Date.now() };
  }

  const token = uuidv4();
  sessions[token] = phone;

  res.json({ success: true, session: token, user: users[phone], isNew });
});

// Настройка профиля
app.post('/api/setup-profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const phone = sessions[token];
  if (!phone) return res.status(401).json({ error: 'Unauthorized' });

  const { name, username } = req.body;
  if (!name || !username) return res.status(400).json({ error: 'Заполните все поля' });

  users[phone] = { ...users[phone], name: name.trim(), username: username.trim().replace(/^@/, '') };
  broadcastUserList();
  res.json({ user: users[phone] });
});

// Список чатов/контактов
app.get('/api/chats', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const phone = sessions[token];
  if (!phone) return res.status(401).json({ error: 'Unauthorized' });

  const me = users[phone];
  const contacts = Object.values(users).filter(u => u.userId !== me.userId && u.name);
  res.json({ contacts, chats: [] });
});

// ===== WEBSOCKET =====
function convKey(a, b) { return [a, b].sort().join('__'); }

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'auth') {
      const phone = sessions[msg.token];
      if (!phone) return ws.close();
      userId = users[phone]?.userId;
      if (!userId) return ws.close();
      wsClients[userId] = ws;
      sendUserList(ws, userId);
      console.log(`✅ WS auth: ${users[phone].name || users[phone].phone}`);
    }

    if (msg.type === 'message' && userId) {
      const recipient = Object.values(users).find(u => u.userId === msg.to);
      if (!recipient) return;

      const message = {
        type: 'message',
        id: uuidv4(),
        from: userId,
        to: msg.to,
        text: msg.text,
        ts: Date.now()
      };

      const key = convKey(userId, msg.to);
      if (!conversations[key]) conversations[key] = [];
      conversations[key].push(message);

      // Доставить получателю
      const recipWs = wsClients[msg.to];
      if (recipWs && recipWs.readyState === WebSocket.OPEN) {
        recipWs.send(JSON.stringify(message));
      }

      // Эхо отправителю
      ws.send(JSON.stringify({ ...message, sent: true }));
    }

    if (msg.type === 'get-history' && userId) {
      const key = convKey(userId, msg.with);
      ws.send(JSON.stringify({
        type: 'history',
        chatId: msg.with,
        messages: conversations[key] || []
      }));
    }
  });

  ws.on('close', () => {
    if (userId) {
      delete wsClients[userId];
      console.log(`👋 WS disconnected: ${userId}`);
    }
  });
});

function sendUserList(ws, excludeId) {
  const list = Object.values(users).filter(u => u.name && u.userId !== excludeId);
  ws.send(JSON.stringify({ type: 'users', users: list }));
}

function broadcastUserList() {
  const allUsers = Object.values(users).filter(u => u.name);
  Object.entries(wsClients).forEach(([uid, ws]) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'users', users: allUsers.filter(u => u.userId !== uid) }));
    }
  });
}

// ===== START =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Tiegram запущен: http://localhost:${PORT}`);
  console.log(`🤖 Telegram бот активен (polling)...\n`);
});
